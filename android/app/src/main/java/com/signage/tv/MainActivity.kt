package com.signage.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlarmManager
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.util.Base64
import android.view.PixelCopy
import java.io.ByteArrayOutputStream
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.provider.Settings
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import java.security.MessageDigest
import java.util.Calendar

/**
 * Full-screen kiosk wrapper around the web player (player.html).
 * - starts on boot, keeps the screen on, hides system bars
 * - autoplays video (with sound), recovers from WebView crashes & network errors
 * - Back or Menu opens the screen menu (in the web player); the native
 *   address dialog is the fallback if the player page isn't loaded
 * - reopens itself N minutes after someone leaves it (admin setting)
 */
class MainActivity : Activity() {

    private lateinit var root: FrameLayout
    private var web: WebView? = null
    private val handler = Handler(Looper.getMainLooper())
    private var lastFullReload = SystemClock.elapsedRealtime()

    private val prefs by lazy { getSharedPreferences("signage", Context.MODE_PRIVATE) }
    // Fixed address (no longer changeable on the TV).
    private val playerUrl: String get() = BuildConfig.PLAYER_URL
    /** Minutes to wait before reopening after the next time we leave; null = use admin setting. */
    private var nextReturnMinutes: Int? = null

    /** Called from the web player (window.SignageNative). */
    inner class Bridge {
        @JavascriptInterface fun setConfig(json: String) {
            try {
                val o = org.json.JSONObject(json)
                prefs.edit()
                    .putString("pin_hash", o.optString("pin_hash", ""))
                    .putInt("return_minutes", o.optInt("return_minutes", 5))
                    .apply()
            } catch (_: Exception) {}
        }
        @JavascriptInterface fun exitToHome(minutes: Int) = runOnUiThread { goHome(minutes) }
        @JavascriptInterface fun canReopen(): Boolean = canStartFromBackground()
        @JavascriptInterface fun openOverlayPermission() = runOnUiThread { openOverlaySetting() }
        @JavascriptInterface fun appVersion(): String = BuildConfig.VERSION_NAME
        @JavascriptInterface fun openWifi(minutes: Int) = runOnUiThread { openWifiSettings(minutes) }
        @JavascriptInterface fun networkType(): String = currentNetworkType()
        @JavascriptInterface fun captureScreen() { runOnUiThread { this@MainActivity.captureScreenNow() } }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_FULLSCREEN or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        )
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        setContentView(root)
        createWebView()
        load()
        scheduleNightlyReload()
        handler.postDelayed({ askForOverlayIfNeeded() }, 4000)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        web?.let { root.removeView(it); it.destroy() }
        val w = WebView(this)
        w.setBackgroundColor(Color.BLACK)
        w.isFocusable = true
        w.isFocusableInTouchMode = true
        with(w.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            loadWithOverviewMode = true
            useWideViewPort = true
            userAgentString = "$userAgentString ProviewSignageTV/${BuildConfig.VERSION_NAME}"
        }
        w.addJavascriptInterface(Bridge(), "SignageNative")
        w.webChromeClient = object : WebChromeClient() {
            // Avoid the grey "play" placeholder before videos start
            override fun getDefaultVideoPoster() = android.graphics.Bitmap.createBitmap(1, 1, android.graphics.Bitmap.Config.ARGB_8888)
        }
        w.webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showOffline()
            }

            @Deprecated("pre-API 23")
            override fun onReceivedError(view: WebView, errorCode: Int, description: String?, failingUrl: String?) {
                if (failingUrl == null || failingUrl.startsWith(playerUrl.substringBefore('?'))) showOffline()
            }

            @Deprecated("pre-API 24")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                Uri.parse(url).host != Uri.parse(playerUrl).host

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // WebView renderer crashed or was killed for memory: rebuild it.
                handler.post { createWebView(); load() }
                return true
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Stay inside the player; ignore navigation away
                return request.url.host != Uri.parse(playerUrl).host
            }
        }
        root.addView(w, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        w.requestFocus()
        web = w
    }

    private fun load() {
        offline = false
        val uri = Uri.parse(playerUrl).buildUpon()
            .appendQueryParameter("app", BuildConfig.VERSION_NAME)
            .appendQueryParameter("model", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            .appendQueryParameter("hw", hardwareId())
            .build()
        web?.loadUrl(uri.toString())
    }

    /**
     * Stable per-device ID that survives app reinstalls (not factory resets).
     * Android's ANDROID_ID, hashed so the raw ID never leaves the device.
     * Requires the APK to always be signed with the same release key.
     */
    @SuppressLint("HardwareIds")
    private fun hardwareId(): String {
        val raw = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: return ""
        if (raw.isBlank() || raw == "9774d56d682e549c") return ""   // known bogus emulator/legacy value
        val digest = MessageDigest.getInstance("SHA-256").digest("proview-signage:$raw".toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }

    private var offline = false

    private fun showOffline() {
        offline = true
        val html = """
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
            <body style="margin:0;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;
            height:100vh;text-align:center;background:radial-gradient(ellipse at 30% 20%,#1f2638,#0b0c12 70%)">
            <div>
              <img src="logo.png" style="height:11vh;width:auto">
              <div style="font-size:2.6vh;letter-spacing:.18em;margin:1.4vh 0 4vh"><b>PROVIEW</b>
                <span style="background:linear-gradient(90deg,#62b0ec,#8b88dc);-webkit-background-clip:text;background-clip:text;color:transparent">SIGNAGE</span></div>
              <h1 style="font-size:5vh;margin:0 0 2vh">Waiting for network…</h1>
              <p style="font-size:2.6vh;color:#aab;margin:0 0 4vh">Retrying automatically.</p>
              <div style="display:inline-block;padding:1.8vh 4vh;border-radius:1.4vh;font-size:2.6vh;font-weight:700;
                background:linear-gradient(135deg,#2f84d4,#5a5fbb)">Press OK to open Wi-Fi settings</div>
              <p style="font-size:1.8vh;color:#667;margin-top:5vh">Player address: ${playerUrl}</p>
            </div></body></html>""".trimIndent()
        web?.loadDataWithBaseURL("file:///android_asset/", html, "text/html", "utf-8", null)
        handler.removeCallbacks(retry)
        handler.postDelayed(retry, 15_000)
    }

    private val retry = Runnable { load() }

    /** Reload once a day around 04:00 to keep long-running WebViews healthy. */
    private fun scheduleNightlyReload() {
        handler.postDelayed(object : Runnable {
            override fun run() {
                val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
                val sinceLast = SystemClock.elapsedRealtime() - lastFullReload
                if (hour == 4 && sinceLast > 20 * 60 * 60 * 1000L) {
                    lastFullReload = SystemClock.elapsedRealtime()
                    createWebView(); load()
                }
                handler.postDelayed(this, 10 * 60 * 1000L)
            }
        }, 10 * 60 * 1000L)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        if (offline && (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER)) {
            if (event.action == KeyEvent.ACTION_UP) openWifiSettings(prefs.getInt("return_minutes", 5))
            return true
        }
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_SETTINGS) {
            if (event.action == KeyEvent.ACTION_UP) {
                if (code == KeyEvent.KEYCODE_BACK) {
                    // If the screen menu is open, Back steps back / closes it.
                    // Otherwise it takes 3 Back presses (within 3 seconds) to open the menu.
                    web?.evaluateJavascript("(window.signageRemote && window.signageRemote.back()) || false") { handled ->
                        if (handled != "true") countBackPress()
                    }
                } else openScreenMenu()
            }
            return true   // kiosk: Back/Menu never close the player
        }
        return super.dispatchKeyEvent(event)
    }

    private var backPresses = 0
    private var firstBackAt = 0L
    private var backToast: Toast? = null
    private fun countBackPress() {
        val now = SystemClock.elapsedRealtime()
        if (now - firstBackAt > 3000) { backPresses = 0; firstBackAt = now }
        backPresses++
        backToast?.cancel()
        if (backPresses >= 3) { backPresses = 0; firstBackAt = 0; openScreenMenu(); return }
        val left = 3 - backPresses
        backToast = Toast.makeText(this, "Press Back $left more time${if (left == 1) "" else "s"} for the menu", Toast.LENGTH_SHORT).also { it.show() }
    }

    /** Opens the web screen menu; if the player page isn't loaded (no network), opens Wi-Fi settings instead. */
    private fun openScreenMenu() {
        web?.evaluateJavascript("window.signageRemote ? (window.signageRemote.open(), true) : false") { ok ->
            if (ok != "true") openWifiSettings(prefs.getInt("return_minutes", 5))
        } ?: openWifiSettings(prefs.getInt("return_minutes", 5))
    }

    // ------------------------------------------------------------ screenshots
    /** Captures what's on screen (incl. video on Android 8+) and hands a JPEG data URL to the web player. */
    private fun captureScreenNow() {
        val w = web ?: return
        val width = w.width.coerceAtLeast(1)
        val height = w.height.coerceAtLeast(1)
        val scale = minOf(1f, 1280f / width)
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val deliver = { b: Bitmap?, err: String? ->
            if (b == null) {
                w.evaluateJavascript("window.__onScreenshot && window.__onScreenshot(null, ${org.json.JSONObject.quote(err ?: "Capture failed")})", null)
            } else {
                Thread {
                    val small = if (scale < 1f) Bitmap.createScaledBitmap(b, (width * scale).toInt(), (height * scale).toInt(), true) else b
                    val out = ByteArrayOutputStream()
                    small.compress(Bitmap.CompressFormat.JPEG, 72, out)
                    val data = "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                    runOnUiThread { w.evaluateJavascript("window.__onScreenshot && window.__onScreenshot('$data')", null) }
                }.start()
            }
        }
        if (Build.VERSION.SDK_INT >= 26) {
            val loc = IntArray(2)
            w.getLocationInWindow(loc)
            try {
                PixelCopy.request(window, android.graphics.Rect(loc[0], loc[1], loc[0] + width, loc[1] + height), bmp, { result ->
                    if (result == PixelCopy.SUCCESS) deliver(bmp, null) else drawCapture(w, bmp, deliver)
                }, handler)
                return
            } catch (_: Exception) { /* fall back */ }
        }
        drawCapture(w, bmp, deliver)
    }

    private fun drawCapture(w: WebView, bmp: Bitmap, deliver: (Bitmap?, String?) -> Unit) {
        try { w.draw(Canvas(bmp)); deliver(bmp, null) } catch (e: Exception) { deliver(null, e.message) }
    }

    // ------------------------------------------------------------ leave & auto-return
    private fun goHome(minutes: Int) {
        nextReturnMinutes = minutes
        startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Open the TV's Wi-Fi / network settings (falls back to general settings on TVs without a Wi-Fi page). */
    private fun openWifiSettings(minutes: Int) {
        val tries = listOf(
            Intent(Settings.ACTION_WIFI_SETTINGS),
            Intent().setClassName("com.android.tv.settings", "com.android.tv.settings.connectivity.NetworkActivity"),
            Intent().setClassName("com.amazon.tv.settings.v2", "com.amazon.tv.settings.v2.tv.network.NetworkActivity"),
            Intent(Settings.ACTION_WIRELESS_SETTINGS),
            Intent(Settings.ACTION_SETTINGS),
        )
        for (i in tries) {
            try {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                nextReturnMinutes = minutes
                startActivity(i)
                return
            } catch (e: Exception) { nextReturnMinutes = null }
        }
        Toast.makeText(this, "This TV doesn't let apps open its network settings. Use Exit to home screen, then open Settings.", Toast.LENGTH_LONG).show()
    }

    private fun currentNetworkType(): String = try {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        if (Build.VERSION.SDK_INT >= 23) {
            val caps = cm.getNetworkCapabilities(cm.activeNetwork)
            when {
                caps == null -> "Not connected"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet (cable)"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
                else -> "Connected"
            }
        } else {
            @Suppress("DEPRECATION") val ni = cm.activeNetworkInfo
            @Suppress("DEPRECATION") when { ni == null || !ni.isConnected -> "Not connected"; ni.type == android.net.ConnectivityManager.TYPE_ETHERNET -> "Ethernet (cable)"; ni.type == android.net.ConnectivityManager.TYPE_WIFI -> "Wi-Fi"; else -> "Connected" }
        }
    } catch (e: Exception) { "" }

    /**
     * Android doesn't let an app switch on "Display over other apps" by itself, so on start-up
     * (until it's on) we explain why and open the right settings page; the installer just flips the switch.
     * Asked at most once a day. Installers can also grant it over ADB:
     *   adb shell appops set com.signage.tv SYSTEM_ALERT_WINDOW allow
     */
    private fun askForOverlayIfNeeded() {
        if (canStartFromBackground() || isFinishing) return
        val last = prefs.getLong("overlay_asked_at", 0L)
        if (System.currentTimeMillis() - last < 24 * 3600_000L) return
        prefs.edit().putLong("overlay_asked_at", System.currentTimeMillis()).apply()
        try {
            AlertDialog.Builder(this)
                .setTitle("Let PROVIEW SIGNAGE reopen itself")
                .setMessage("So the player comes back on its own after someone leaves it, turn ON \"Display over other apps\" (sometimes called \"Appear on top\") for PROVIEW SIGNAGE on the next screen, then press Back.")
                .setPositiveButton("Open setting") { _, _ -> openOverlaySetting() }
                .setNegativeButton("Not now", null)
                .show()
        } catch (_: Exception) {}
    }

    private fun openOverlaySetting() {
        val pkg = Uri.parse("package:$packageName")
        val tries = listOf(
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg),
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION),
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg),
        )
        for (i in tries) {
            try { nextReturnMinutes = prefs.getInt("return_minutes", 5); startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return } catch (_: Exception) { nextReturnMinutes = null }
        }
        Toast.makeText(this, "This TV doesn't offer that setting. The player will still reopen when the TV restarts.", Toast.LENGTH_LONG).show()
    }

    /** Android 10+ only lets apps reopen from the background with "Display over other apps". */
    private fun canStartFromBackground(): Boolean =
        Build.VERSION.SDK_INT < 29 || Settings.canDrawOverlays(this)

    private fun returnIntent(): PendingIntent {
        val i = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
        return PendingIntent.getActivity(this, 42, i, flags)
    }

    private fun scheduleReturn(minutes: Int) {
        if (minutes <= 0) return
        val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + minutes * 60_000L, returnIntent())
    }

    private fun cancelReturn() {
        (getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(returnIntent())
    }

    override fun onStart() { super.onStart(); cancelReturn(); nextReturnMinutes = null }

    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations && !isFinishing) {
            scheduleReturn(nextReturnMinutes ?: prefs.getInt("return_minutes", 5))
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemUi() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
    }

    override fun onResume() { super.onResume(); web?.onResume(); web?.resumeTimers(); hideSystemUi() }
    override fun onPause() { web?.onPause(); super.onPause() }
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); web?.destroy(); super.onDestroy() }
}
