package com.signage.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlarmManager
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.text.InputType
import android.webkit.JavascriptInterface
import android.graphics.Color
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
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import java.security.MessageDigest
import java.util.Calendar

/**
 * Full-screen kiosk wrapper around the web player (player.html).
 * - starts on boot, keeps the screen on, hides system bars
 * - autoplays video (with sound), recovers from WebView crashes & network errors
 * - Back ×5 or Menu opens the PIN-protected screen menu (in the web player);
 *   a native PIN prompt is the fallback if the player page isn't loaded
 * - reopens itself N minutes after someone leaves it (admin setting)
 */
class MainActivity : Activity() {

    private lateinit var root: FrameLayout
    private var web: WebView? = null
    private val handler = Handler(Looper.getMainLooper())
    private var backPresses = 0
    private var lastBack = 0L
    private var lastFullReload = SystemClock.elapsedRealtime()

    private val prefs by lazy { getSharedPreferences("signage", Context.MODE_PRIVATE) }
    private val playerUrl: String get() = prefs.getString("player_url", null) ?: BuildConfig.PLAYER_URL
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
        @JavascriptInterface fun changeAddress() = runOnUiThread { openSettings() }
        @JavascriptInterface fun canReopen(): Boolean = canStartFromBackground()
        @JavascriptInterface fun openOverlayPermission() = runOnUiThread {
            try {
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            } catch (_: Exception) {
                Toast.makeText(this@MainActivity, "This TV doesn't offer that setting. The player will still reopen when the TV restarts.", Toast.LENGTH_LONG).show()
            }
        }
        @JavascriptInterface fun appVersion(): String = BuildConfig.VERSION_NAME
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
        w.setLayerType(View.LAYER_TYPE_HARDWARE, null)
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

    private fun showOffline() {
        val html = """
            <html><body style="margin:0;background:#000;color:#fff;font-family:sans-serif;display:flex;
            align-items:center;justify-content:center;height:100vh;text-align:center">
            <div><h1 style="font-size:5vh;margin:0 0 2vh">Waiting for network…</h1>
            <p style="font-size:2.6vh;color:#aaa">Retrying automatically. Player address:<br>${playerUrl}</p></div>
            </body></html>""".trimIndent()
        web?.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
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

    private fun openSettings() {
        val input = EditText(this).apply {
            setText(playerUrl)
            setSelectAllOnFocus(true)
            setSingleLine(true)
        }
        AlertDialog.Builder(this)
            .setTitle("Player address")
            .setMessage("Address of player.html on your signage site")
            .setView(input)
            .setPositiveButton("Save") { _, _ ->
                val v = input.text.toString().trim()
                if (v.startsWith("https://") || v.startsWith("http://")) {
                    prefs.edit().putString("player_url", v).apply()
                    load()
                } else Toast.makeText(this, "Enter a full https:// address", Toast.LENGTH_LONG).show()
            }
            .setNeutralButton("Reset") { _, _ -> prefs.edit().remove("player_url").apply(); load() }
            .setNegativeButton("Cancel", null)
            .show()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_SETTINGS) {
            if (event.action == KeyEvent.ACTION_UP) {
                if (code == KeyEvent.KEYCODE_BACK) {
                    // If the screen menu is open, Back steps back / closes it.
                    web?.evaluateJavascript("(window.signageRemote && window.signageRemote.back()) || false") { handled ->
                        if (handled != "true") countBack()
                    }
                } else openScreenMenu()
            }
            return true   // kiosk: Back/Menu never close the player
        }
        return super.dispatchKeyEvent(event)
    }

    private fun countBack() {
        val now = SystemClock.elapsedRealtime()
        backPresses = if (now - lastBack < 1500) backPresses + 1 else 1
        lastBack = now
        if (backPresses >= 5) { backPresses = 0; openScreenMenu() }
    }

    /** Opens the PIN-protected web menu, or a native PIN prompt if the player isn't loaded. */
    private fun openScreenMenu() {
        web?.evaluateJavascript("window.signageRemote ? (window.signageRemote.open(), true) : false") { ok ->
            if (ok != "true") askPin { openSettings() }
        } ?: askPin { openSettings() }
    }

    private fun sha256(text: String) =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

    private fun askPin(onOk: () -> Unit) {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            hint = "PIN"
        }
        AlertDialog.Builder(this)
            .setTitle("Enter PIN")
            .setView(input)
            .setPositiveButton("OK") { _, _ ->
                val expected = prefs.getString("pin_hash", null)?.takeIf { it.isNotBlank() } ?: sha256("proview-pin:1234")
                if (sha256("proview-pin:" + input.text.toString()) == expected) onOk()
                else Toast.makeText(this, "Wrong PIN", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // ------------------------------------------------------------ leave & auto-return
    private fun goHome(minutes: Int) {
        nextReturnMinutes = minutes
        startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
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
