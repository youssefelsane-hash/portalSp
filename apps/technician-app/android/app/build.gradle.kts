import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// توقيع نسخة الإصدار (release) — نفس الفلسفة بالحرف زي apps/customer-app (راجع تعليقاته
// وdocs/03-external-integrations.md § توقيع Android). لو android/key.properties (مش متتبّع في
// git) موجود، بيتفعّل توقيع حقيقي؛ من غيره، fallback لتوقيع debug زي الأول.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties()
val hasReleaseSigning = keystorePropertiesFile.exists()
if (hasReleaseSigning) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    namespace = "com.baytak.technician_app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.baytak.technician_app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            // لو key.properties موجود بيستخدم توقيع الإصدار الحقيقي، من غيره بيرجع لتوقيع
            // debug عشان `flutter run --release` يفضل شغال من غير keystore حقيقي.
            signingConfig = if (hasReleaseSigning) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

// بلجن Firebase بيفشّل الـ build بصمت غريب لو اتفعّل من غير الملف ده موجود — شرطي عشان أي حد
// يقدر يعمل `flutter build`/`flutter run` عادي من غير مشروع Firebase حقيقي لسه. لما تحط
// google-services.json حقيقي هنا (راجع docs/03-external-integrations.md §4.1)، هيتفعّل تلقائي
// من غير أي تعديل تاني.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}
