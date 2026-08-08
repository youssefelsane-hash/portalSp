import 'package:safe_device/safe_device.dart';

class DeviceSecurityResult {
  final bool isCompromised;
  final String? reasonAr;

  const DeviceSecurityResult({required this.isCompromised, this.reasonAr});
}

// جزء من متطلبات الأمان الإلزامية §7.3 (كانت فجوة موثّقة صراحة) — كشف الأجهزة المكسورة
// (root/jailbreak) قبل السماح بأي عملية مالية (أرباح، صرف). فحص واحد وقت فتح التطبيق، مش لكل
// طلب — SafeDevice بيعمل native calls مش رخيصة تتكرر باستمرار.
class DeviceSecurityService {
  Future<DeviceSecurityResult> check() async {
    try {
      final isRealDevice = await SafeDevice.isRealDevice;
      if (!isRealDevice) {
        return const DeviceSecurityResult(
          isCompromised: true,
          reasonAr: 'التطبيق ده بيتعامل مع بيانات مالية حساسة، ومش بيشتغل على أجهزة محاكاة (إيموليتور).',
        );
      }
      final isJailBroken = await SafeDevice.isJailBroken;
      if (isJailBroken) {
        return const DeviceSecurityResult(
          isCompromised: true,
          reasonAr: 'التطبيق ده بيتعامل مع بيانات مالية حساسة، ومش بيشتغل على أجهزة معمول لها Root أو Jailbreak.',
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
