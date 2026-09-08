import 'package:flutter/foundation.dart';
import 'package:safe_device/safe_device.dart';

class DeviceSecurityResult {
  final bool isCompromised;
  final String? reasonAr;

  const DeviceSecurityResult({required this.isCompromised, this.reasonAr});
}

/// **تجاوز فحص الإيموليتور — للتطوير المحلي بس** (`--dart-define=ALLOW_EMULATOR=true`).
///
/// السبب: تشغيل التطبيقين مع بعض على جهاز أندرويد واحد مش عملي، والتجربة الحقيقية بتحتاج
/// نسخة أندرويد (مش macOS desktop) عشان تكون مطابقة لللي بيتشحن فعلاً.
///
/// **مقفول على `kDebugMode` عمدًا**: في `flutter run --release` أو أي build إنتاجي القيمة دي
/// **بتتجاهَل تمامًا** — يعني مفيش أي طريقة إن التجاوز ده يوصل لفني حقيقي، حتى لو الفلاج
/// اتبعت بالغلط في أمر البناء. الجاي-بريك/الروت بيفضل مرفوض في كل الحالات بلا استثناء:
/// التجاوز ده على **الإيموليتور** بس.
const bool _allowEmulatorInDebug = bool.fromEnvironment('ALLOW_EMULATOR');

// جزء من متطلبات الأمان الإلزامية §7.3 (كانت فجوة موثّقة صراحة) — كشف الأجهزة المكسورة
// (root/jailbreak) قبل السماح بأي عملية مالية (أرباح، صرف). فحص واحد وقت فتح التطبيق، مش لكل
// طلب — SafeDevice بيعمل native calls مش رخيصة تتكرر باستمرار.
class DeviceSecurityService {
  Future<DeviceSecurityResult> check() async {
    // safe_device is a mobile root/jailbreak detector. A native desktop build is neither an
    // emulator nor a rooted phone, so it must not be rejected while testing on a laptop.
    if (kIsWeb ||
        (defaultTargetPlatform != TargetPlatform.android &&
            defaultTargetPlatform != TargetPlatform.iOS)) {
      return const DeviceSecurityResult(isCompromised: false);
    }
    try {
      final isRealDevice = await SafeDevice.isRealDevice;
      if (!isRealDevice && !(kDebugMode && _allowEmulatorInDebug)) {
        return const DeviceSecurityResult(
          isCompromised: true,
          reasonAr:
              'التطبيق ده بيتعامل مع بيانات مالية حساسة، ومش بيشتغل على أجهزة محاكاة (إيموليتور).',
        );
      }
      final isJailBroken = await SafeDevice.isJailBroken;
      if (isJailBroken) {
        return const DeviceSecurityResult(
          isCompromised: true,
          reasonAr:
              'التطبيق ده بيتعامل مع بيانات مالية حساسة، ومش بيشتغل على أجهزة معمول لها Root أو Jailbreak.',
        );
      }
      return const DeviceSecurityResult(isCompromised: false);
    } catch (_) {
      // فشل الفحص نفسه (خطأ في الـ plugin على منصة معيّنة مثلاً) مش نفس اكتشاف جهاز مخترق
      // فعلاً — بنفتح بدل ما نقفل فني حقيقي برة الشغل بسبب خطأ تقني في فحص أمان ثانوي.
      return const DeviceSecurityResult(isCompromised: false);
    }
  }
}
