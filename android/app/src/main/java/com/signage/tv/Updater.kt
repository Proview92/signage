package com.signage.tv

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Keeps the TV app up to date.
 * Each release publishes version.json next to the APK. When a newer version is out, the app downloads it
 * and hands it to Android's installer, which shows the "Update this app?" screen (one press of OK).
 * On Android 12+ TVs, updates after the first one install by themselves without asking.
 */
object Updater {
    private const val TAG = "SignageUpdater"
    private const val VERSION_URL = "https://github.com/Proview92/signage/releases/latest/download/version.json"
    private const val DEFAULT_APK = "https://github.com/Proview92/signage/releases/latest/download/signage-tv.apk"
    @Volatile private var busy = false

    /** manual = someone asked for it (remote menu / dashboard): show progress messages on the TV. */
    fun check(activity: Activity, manual: Boolean) {
        if (busy) { if (manual) toast(activity, "Already checking for an update…"); return }
        busy = true
        Thread {
            try { run(activity, manual) }
            catch (e: Exception) { Log.w(TAG, "update failed", e); if (manual) toast(activity, "Update failed: ${e.message ?: "network error"}") }
            finally { busy = false }
        }.start()
    }

    private fun run(activity: Activity, manual: Boolean) {
        val info = JSONObject(get(VERSION_URL).toString(Charsets.UTF_8))
        val code = info.optInt("versionCode", 0)
        val name = info.optString("versionName", "")
        if (code <= BuildConfig.VERSION_CODE) {
            if (manual) toast(activity, "The app is up to date (version ${BuildConfig.VERSION_NAME})")
            return
        }
        // Android 8+: the app needs "Install unknown apps" once. Open that page so someone can switch it on.
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            val prefs = activity.getSharedPreferences("signage", Context.MODE_PRIVATE)
            val last = prefs.getLong("unknown_sources_asked", 0)
            if (manual || System.currentTimeMillis() - last > 24 * 3600_000L) {
                prefs.edit().putLong("unknown_sources_asked", System.currentTimeMillis()).apply()
                activity.runOnUiThread {
                    Toast.makeText(activity, "Version $name is ready. Turn on PROVIEW SIGNAGE here to allow updates, then press Back.", Toast.LENGTH_LONG).show()
                    try {
                        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                    } catch (_: Exception) {}
                }
            }
            return
        }
        if (manual) toast(activity, "Downloading version $name…")
        val file = File(activity.cacheDir, "update.apk")
        file.writeBytes(get(info.optString("apk", DEFAULT_APK)))
        // Make sure it really is a newer build of this app before installing.
        val pkg = activity.packageManager.getPackageArchiveInfo(file.absolutePath, 0)
            ?: throw IllegalStateException("download was not a valid app")
        @Suppress("DEPRECATION")
        val dlCode = if (Build.VERSION.SDK_INT >= 28) pkg.longVersionCode.toInt() else pkg.versionCode
        if (pkg.packageName != activity.packageName || dlCode <= BuildConfig.VERSION_CODE) {
            if (manual) toast(activity, "The app is up to date (version ${BuildConfig.VERSION_NAME})")
            return
        }
        install(activity, file)
    }

    private fun install(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        installer.openSession(id).use { s ->
            s.openWrite("base.apk", 0, apk.length()).use { out -> apk.inputStream().use { it.copyTo(out) }; s.fsync(out) }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val pi = PendingIntent.getBroadcast(ctx, id, Intent(ctx, InstallReceiver::class.java), flags)
            s.commit(pi.intentSender)
        }
    }

    private fun get(url: String, redirects: Int = 6): ByteArray {
        var u = URL(url)
        repeat(redirects) {
            val c = (u.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 15000; readTimeout = 60000
                setRequestProperty("User-Agent", "ProviewSignageTV/${BuildConfig.VERSION_NAME}")
            }
            try {
                when (val code = c.responseCode) {
                    in 300..399 -> { u = URL(u, c.getHeaderField("Location")); return@repeat }
                    200 -> return c.inputStream.use { it.readBytes() }
                    else -> throw IllegalStateException("server said $code")
                }
            } finally { c.disconnect() }
        }
        throw IllegalStateException("too many redirects")
    }

    private fun toast(a: Activity, msg: String) = a.runOnUiThread { Toast.makeText(a, msg, Toast.LENGTH_LONG).show() }
}

/** Gets the installer's answer; shows Android's "Update this app?" screen when it needs a press of OK. */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                              else intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                confirm?.let { it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); try { context.startActivity(it) } catch (_: Exception) {} }
            }
            PackageInstaller.STATUS_SUCCESS -> Unit   // BootReceiver (MY_PACKAGE_REPLACED) reopens the app
            else -> {
                val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "cancelled"
                Toast.makeText(context, "Update not installed: $msg", Toast.LENGTH_LONG).show()
            }
        }
    }
}
