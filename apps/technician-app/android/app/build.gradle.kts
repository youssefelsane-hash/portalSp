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
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

// **وجود الملف مش كفاية** (تصليب 2026-09-10): حد ينسخ `key.properties.example` لـ`key.properties`
// من غير ما يملاه — فالحارس تحت بيشوف "توقيع موجود" ويعدّي، والبناء بيقع بعدين برسالة Gradle
// غامضة عن `file("")`. الأسوأ إن ناتج المتجر بيعدّي بوابة كانت موضوعة مخصوص عشان توقفه.
// القيم الأربعة لازم تكون موجودة وغير فاضية، **وملف الـkeystore نفسه لازم يكون على القرص فعلاً**.
val hasReleaseSigning = run {
    val required = listOf("keyAlias", "keyPassword", "storeFile", "storePassword")
    if (required.any { (keystoreProperties[it] as String?).isNullOrBlank() }) {
        false
    } else {
        // `file(...)` هنا = نفس الأساس اللي `signingConfigs` تحت بيحل بيه المسار
        // (مجلد `android/app/`) — أي أساس تاني معناه فحص بيقول "موجود" وتوقيع بيقول "مش لاقيه".
        file(keystoreProperties["storeFile"] as String).exists()
    }
}

// بوابة P0-3 في docs/23 — «إصدار المتجر يجب أن **يفشل** بدل أن ينتج نسخة Debug بصمت».
//
// الرجوع لتوقيع debug مقبول تمامًا لـ`flutter run --release` المحلي (assembleRelease)، لكنه
// كارثة لو حصل على ناتج المتجر: نسخة موقّعة بمفتاح debug مرفوضة من Google Play، والأسوأ إن
// الفشل ده مكانش بيبان غير وقت الرفع نفسه. الحارس ده بيفصل الحالتين بالظبط: بناء الـAAB
// (`bundleRelease` = ناتج المتجر الوحيد) بيفشل فورًا وبرسالة واضحة، وباقي البناءات زي ما هي.
gradle.taskGraph.whenReady {
    val buildingStoreBundle = allTasks.any {
        it.name.startsWith("bundle") && it.name.contains("Release")
    }
    if (buildingStoreBundle && !hasReleaseSigning) {
        throw GradleException(
            "مينفعش تبني App Bundle للمتجر بلا توقيع إصدار حقيقي. " +
                "لازم android/key.properties يكون موجود **وقيمه الأربعة مليانة** (keyAlias/keyPassword/storeFile/storePassword) وملف الـkeystore نفسه موجود على القرص. " +
                "التفاصيل في docs/03-external-integrations.md § توقيع Android.",
        )
    }
}

android {
    namespace = "com.ostahome.technician"
    // بَقّة CI حقيقية اتلقطت واتصلحت (2026-08-15): flutter.compileSdkVersion (36 حاليًا مع Flutter
    // 3.44.9) أقل من اللي flutter_secure_storage محتاجه (37) — build فاشل بـ"CheckAarMetadata".
    // 37 صريح هنا بدل الاعتماد على قيمة Flutter الافتراضية لحد ما SDK نفسه يترقّى.
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // flutter_local_notifications محتاج desugaring لمكتبات java.time على أجهزة API قديمة.
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        // معرّف تطبيق Osta الرسمي على Google Play (هجرة 2026-09-10 من `com.baytak.technician_app`).
        // **مايتغيّرش بعد أول رفع للمتجر** — Google Play بيعامل أي تغيير فيه كتطبيق جديد تمامًا.
        applicationId = "com.ostahome.technician"
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
            // debug عشان `flutter run --release` يفضل شغال من غير keystore حقيقي. ناتج المتجر
            // (AAB) بيفشل صراحةً في الحالة دي — راجع حارس gradle.taskGraph فوق.
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

dependencies {
    // مكتبة desugaring نفسها — مطلوبة عشان isCoreLibraryDesugaringEnabled فوق (flutter_local_notifications).
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
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
