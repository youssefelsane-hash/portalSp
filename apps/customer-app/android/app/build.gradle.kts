import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// توقيع نسخة الإصدار (release) — كانت فجوة موثّقة صراحة: "لسه بتستخدم debug signing، قبل
// Play Store لازم release keystore + secrets خارج الـrepo". نفس فلسفة google-services.json
// الشرطية تحت بالحرف: لو android/key.properties (مش متتبّع في git، .gitignore جاهزة له من
// زمان) موجود، بيتقرا ويتفعّل توقيع حقيقي؛ من غيره، البناء يفضل شغال بتوقيع debug زي الأول —
// أي حد يقدر يعمل `flutter build apk` عادي من غير keystore حقيقي لسه. تفاصيل توليد الـkeystore
// وتعبئة القيم: docs/03-external-integrations.md § توقيع Android.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties()
val hasReleaseSigning = keystorePropertiesFile.exists()
if (hasReleaseSigning) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
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
                "لازم android/key.properties يكون موجود (keyAlias/keyPassword/storeFile/storePassword). " +
                "التفاصيل في docs/03-external-integrations.md § توقيع Android.",
        )
    }
}

// مفتاح خرائط Google (بوابة P0-2 في docs/23) — كان **مكتوب صراحةً في AndroidManifest.xml
// ومتتبَّع في git**، يعني ظاهر لأي حد عنده وصول للمستودع أو لأي نسخة من تاريخه. بيتقرا دلوقتي
// من `android/maps.properties` (غير متتبَّع، نفس فلسفة key.properties وgoogle-services.json).
//
// **المفتاح القديم لازم يتدوّر من Google Cloud** — إخفاؤه دلوقتي مايلغيش إنه اتسرّب بالفعل في
// تاريخ git. والمفتاح الجديد لازم يتقيّد بالـpackage ID + بصمة توقيع Play وبـMaps SDK بس.
val mapsPropertiesFile = rootProject.file("maps.properties")
val mapsProperties = Properties()
if (mapsPropertiesFile.exists()) {
    mapsProperties.load(FileInputStream(mapsPropertiesFile))
}
// فاضي = الخريطة مش هتحمّل، وده مقصود: أفضل من مفتاح مسرّب شغّال.
val googleMapsApiKey = (mapsProperties["googleMapsApiKey"] as String?) ?: ""

android {
    namespace = "com.baytak.customer_app"
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
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.baytak.customer_app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["googleMapsApiKey"] = googleMapsApiKey
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
