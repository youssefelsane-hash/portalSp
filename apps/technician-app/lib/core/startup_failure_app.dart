import 'package:flutter/material.dart';

/// **شاشة فشل الإقلاع** — بديل صريح للـsplash المتجمّد.
///
/// ### البَقّة اللي اتعملت عشانها (1.0.7+8 على Google Play، 2026-09-28)
///
/// أي استثناء قبل `runApp` كان معناه إن Flutter **عمره ما يرسم أول frame**. وFlutter على
/// أندرويد بيمنع شبّاك النشاط يترسم لحد أول frame (`delayFirstAndroidViewDraw`)، فالـsplash
/// بتاع النظام بيفضل ثابت، وأول لمسة بتعدّي ٥ ثواني من غير رد → أندرويد يطلّع «التطبيق لا
/// يستجيب» (ANR). **صفر** معلومة عن السبب: لا على الشاشة ولا في Play Console.
///
/// ده اللي حصل بالظبط لما التطبيقين اتبنوا من غير `--dart-define=API_BASE_URL`:
/// `assertProductionApiConfig()` رمى `StateError` زي ما هو مصمّم — بس في مكان مايبانش فيه.
///
/// ### القاعدة
///
/// **التطبيق لازم يرسم حاجة دايمًا.** لو الإقلاع فشل، الشاشة دي بتترسم مكان التطبيق بسبب مكتوب.
///
/// ### مابتتخطّاش الحارس
///
/// الشاشة دي **مابتشغّلش التطبيق** — بتقفل عليه برسالة. يعني حارس «مفيش إصدار بعنوان تطوير»
/// لسه شغّال بنفس الصرامة؛ الفرق الوحيد إن فشله بقى **مرئي** بدل ما يبقى ANR غامض.
///
/// مابتعتمدش على أي حاجة من التطبيق (ثيم، providers، أصول، خطوط): الإقلاع فشل، فأي اعتماد إضافي
/// ممكن يكون هو نفسه اللي فشل.
class StartupFailureApp extends StatelessWidget {
  final Object error;

  const StartupFailureApp({super.key, required this.error});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          backgroundColor: const Color(0xFFF7F4EF),
          body: SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline, size: 56, color: Color(0xFFB54724)),
                    const SizedBox(height: 16),
                    const Text(
                      'التطبيق مش قادر يشتغل دلوقتي',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFF1F2933)),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'فيه مشكلة في إعداد النسخة دي. حدّث التطبيق من المتجر، ولو المشكلة فضلت كلّمنا.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 15, height: 1.6, color: Color(0xFF52606D)),
                    ),
                    const SizedBox(height: 20),
                    // السبب الفعلي بخط صغير: ده اللي بيخلّي أي حد بيختبر النسخة يعرف المشكلة من
                    // لقطة شاشة واحدة بدل ساعات تخمين. نص الاستثناء مكتوب عندنا ومافيهوش أسرار.
                    Text(
                      '$error',
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 11, height: 1.5, color: Color(0xFF9AA5B1)),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
