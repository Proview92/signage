package com.signage.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
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
import java.util.Calendar

/**
 * Full-screen kiosk wrapper around the web player (player.html).
 * - starts on boot, keeps the screen on, hides system bars
 * - autoplays video (with sound), recovers from WebView crashes & network errors
 * - press Back 5 times (or Menu) to change the player address
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
            .build()
        web?.loadUrl(uri.toString())
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
        if (event.action == KeyEvent.ACTION_UP) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_BACK -> {
                    val now = SystemClock.elapsedRealtime()
                    backPresses = if (now - lastBack < 1500) backPresses + 1 else 1
                    lastBack = now
                    if (backPresses >= 5) { backPresses = 0; openSettings() }
                    return true            // kiosk: Back never closes the player
                }
                KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS -> { openSettings(); return true }
            }
        }
        if (event.keyCode == KeyEvent.KEYCODE_BACK) return true
        return super.dispatchKeyEvent(event)
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
