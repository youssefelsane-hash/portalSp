import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';

/// بصمة/Face ID كـ"قفل جهاز محلي" فوق الجلسة المحفوظة (docs/08 §17.22) — **مش بديل عن المصادقة
/// الحقيقية**. البصمة نفسها بتتحقق محليًا بالكامل عبر نظام التشغيل (Keychain/Keystore، `local_auth`)
/// — التطبيق مايشوفش ولا يخزّن ولا ينقل أي قالب بيومتري خالص، ده مسؤولية النظام وحده. اللي بيتغيّر
/// فعليًا هنا هو *إمتى* التطبيق يسمح لنفسه يستخدم `refresh_token` المحفوظ أصلاً في
/// `flutter_secure_storage` — بلا بصمة ناجحة (أو المستخدم يختار "استخدم رقم موبايلك" بدلاً)،
/// التطبيق مايكملش لمرحلة استخدام التوكن المحفوظ، حتى لو الجهاز نفسه مفتوح فعليًا.
///
/// **الباك-إند يفضل السلطة النهائية دايمًا** — `AuthRepository._doRefresh()` بينادي
/// `POST /auth/refresh` زي ما هو بالظبط بعد نجاح البصمة، ومفيش أي طريق تاني يوصل لجلسة شغالة.
/// `AuthService.refresh()` (`apps/api`) بيرفض توكن ملغى/منتهي/حساب موقوف فورًا (`AUTH_001`)
/// بغض النظر عن نجاح البصمة محليًا — فشل مغلق حقيقي، مش افتراض.
///
/// **فجوة موثّقة صراحة**: ربط مفتاح تخزين بيومتري (`kSecAccessControlBiometryCurrentSet` على
/// iOS، `setInvalidatedByBiometricEnrollment` على Android) — يعني إبطال تلقائي للتوكن المحفوظ
/// لو بصمة/وجه جديد اتسجّل على الجهاز بعد تفعيل الميزة — محتاج كود native platform channel لكل
/// منصة على حدة، برّه نطاق `local_auth`/`flutter_secure_storage` القياسيين. `IMPLEMENTED —
/// DEVICE TEST PENDING` بيغطي البصمة نفسها/الـfail-closed من الباك-إند بس، مش النقطة دي تحديدًا.
///
/// كود مستقل مكرر عمدًا عن apps/customer-app (نفس نمط push_notification_service.dart —
/// مفيش package Flutter مشترك بين التطبيقين في المونوريبو ده).
class BiometricAuthService {
  static const _enabledKey = 'baytak_biometric_enabled';
  static const _secureStorage = FlutterSecureStorage();
  static final LocalAuthentication _localAuth = LocalAuthentication();

  static bool get _supportsAppBiometrics =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  static Future<bool> isEnabled() async {
    if (!_supportsAppBiometrics) return false;
    final value = await _secureStorage.read(key: _enabledKey);
    return value == 'true';
  }

  static Future<void> setEnabled(bool enabled) async {
    if (!_supportsAppBiometrics) return;
    await _secureStorage.write(
      key: _enabledKey,
      value: enabled ? 'true' : 'false',
    );
  }

  /// الجهاز نفسه فيه هاردوير بصمة/Face ID **ومسجّل عليه بصمة/وجه بالفعل** — لو رجعت false،
  /// مينفعش نعرض خيار "فعّل الدخول بالبصمة" أصلاً (زر معطّل بلا معنى).
  static Future<bool> isAvailable() async {
    if (!_supportsAppBiometrics) return false;
    try {
      final supported = await _localAuth.isDeviceSupported();
      if (!supported) return false;
      final canCheck = await _localAuth.canCheckBiometrics;
      if (!canCheck) return false;
      final enrolled = await _localAuth.getAvailableBiometrics();
      return enrolled.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  /// بيرجّع true بس لو المستخدم أثبت هويته فعليًا بالبصمة/Face ID (مش fallback لباسورد الجهاز
  /// العادي — `biometricOnly: true` — عشان "بصمة" في المتطلب الأصلي تفضل معناها بصمة/وجه حقيقي).
  static Future<bool> authenticate({required String reason}) async {
    if (!_supportsAppBiometrics) return false;
    try {
      return await _localAuth.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(
          biometricOnly: true,
          stickyAuth: true,
        ),
      );
    } on PlatformException {
      // أي فشل تقني (مفيش هاردوير، البصمة اتلغت من إعدادات الجهاز بعد التفعيل، قفل مؤقت بعد
      // محاولات فاشلة كتير، ...) — فشل مغلق: نرجع false، الكولر بيوجّه المستخدم لمسار OTP العادي.
      return false;
    }
  }
}
