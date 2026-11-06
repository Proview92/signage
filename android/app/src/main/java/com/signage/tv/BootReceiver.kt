package com.signage.tv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.UserManager

/**
 * Opens the player automatically when the TV / stick powers on.
 *
 * Speed: BOOT_COMPLETED reaches apps one at a time and can arrive late on TVs, so we also
 * listen for LOCKED_BOOT_COMPLETED (sent earlier, Android 7+), ask to be near the front of the
 * queue (priority in the manifest), and open as soon as the TV's storage is unlocked.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == "android.intent.action.LOCKED_BOOT_COMPLETED" && Build.VERSION.SDK_INT >= 24) {
            // The player can only open once the user is unlocked (instant on TVs without a PIN).
            val pending = goAsync()
            val handler = Handler(Looper.getMainLooper())
            val um = context.getSystemService(UserManager::class.java)
            val started = System.currentTimeMillis()
            handler.post(object : Runnable {
                override fun run() {
                    if (um?.isUserUnlocked == true) { open(context); pending.finish(); return }
                    if (System.currentTimeMillis() - started > 8500) { pending.finish(); return }   // BOOT_COMPLETED will do it
                    handler.postDelayed(this, 250)
                }
            })
            return
        }
        open(context)
    }

    private fun open(context: Context) {
        if (MainActivity.running) return
        val launch = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        try {
            context.startActivity(launch)
        } catch (_: Exception) {
            // Some Android TV builds block background starts unless
            // "Display over other apps" is allowed for this app.
        }
    }
}
