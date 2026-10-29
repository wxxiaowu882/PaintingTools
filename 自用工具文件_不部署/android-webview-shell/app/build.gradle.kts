import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) {
        keystorePropsFile.inputStream().use { load(it) }
    }
}

android {
    namespace = "com.wuxiaoart.workshop"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.wuxiaoart.workshop"
        minSdk = 24
        targetSdk = 35
        versionCode = 21
        versionName = "1.0.20"
        // 验收期接测试站；发学员群正式包前改回 https://www.wuxiaoart.com/
        buildConfigField("String", "START_URL", "\"https://test.wuxiaoart.com/\"")
        // 相对 START_URL 源站；App 原生能力升级才走此检查（网页内容更新不用换包）
        buildConfigField(
            "String",
            "UPDATE_JSON_PATH",
            "\"/docs/app/android-shell-update.json\""
        )
    }

    signingConfigs {
        // 本机 release：复制 keystore.properties.example → keystore.properties
        create("release") {
            if (keystorePropsFile.exists()) {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            val releaseSigning = signingConfigs.getByName("release")
            if (releaseSigning.storeFile != null && releaseSigning.storeFile!!.exists()) {
                signingConfig = releaseSigning
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("com.google.android.material:material:1.12.0")
}
