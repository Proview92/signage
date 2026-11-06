package com.signage.tv

import android.app.admin.DeviceAdminReceiver

/** Lets the app switch the TV off for sleep hours (granted once on the TV: menu → Allow switching the TV off). */
class AdminReceiver : DeviceAdminReceiver()
