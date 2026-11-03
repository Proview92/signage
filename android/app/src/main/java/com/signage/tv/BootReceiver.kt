package com.signage.tv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Opens the player automatically when the TV / stick powers on. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
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
