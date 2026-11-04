plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val playerUrl: String = (project.findProperty("PLAYER_URL") as String?) ?: "https://example.com/player.html"

android {
    namespace = "com.signage.tv"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.signage.tv"
        minSdk = 22          // Fire TV Stick (2nd gen+) and Android TV 5.1+
        targetSdk = 34
        versionCode = 16
        versionName = "2.5"
        buildConfigField("String", "PLAYER_URL", "\"$playerUrl\"")
    }

    signingConfigs {
        create("release") {
            val ks = System.getenv("SIGNING_KEYSTORE")
            if (ks != null && file(ks).exists()) {
                storeFile = file(ks)
                storePassword = System.getenv("SIGNING_STORE_PASSWORD")
                keyAlias = System.getenv("SIGNING_KEY_ALIAS")
                keyPassword = System.getenv("SIGNING_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            val rel = signingConfigs.getByName("release")
            signingConfig = if (rel.storeFile != null) rel else signingConfigs.getByName("debug")
        }
    }
    buildFeatures { buildConfig = true }
    lint { abortOnError = false; checkReleaseBuilds = false }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.11.0")
}
