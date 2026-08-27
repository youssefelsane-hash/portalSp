import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../features/auth/login_screen.dart';
import 'auth_repository.dart';

/// بوابة التسجيل للزائر (docs/08 §77-B1).
///
/// **طلب المالك بالحرف**: «المفروض أول ما الكاستمر يفتح الأبليكيشن يفتح معاه عادي، مش لازم
/// يعمل لوج إن… بس أول ما ييجي قبل ما يطلع له أي سعر أو أول ما يدوس على خدمة محددة، يطلع له
/// واجهة وسيطة تقول له سجل نفسك… وأول ما يسجل تروح جاي الصفحة أوتوماتيك مرجعة اللي هو كان
/// بيعمله على طول».
///
/// **المبدأ**: الدالة دي `Future<bool>` — بترجّع `true` يعني «كمّل»، و`false` يعني «العميل
/// اختار يفضل يتفرّج». المستدعي بيكتب سطر واحد:
/// ```dart
/// if (!await ensureSignedIn(context, reason: '…')) return;
/// ```
/// ده مقصود: البوابة **مش** بتنقل العميل لحتة تانية وتسيبه — هي بتوقف الرحلة مؤقتًا وترجّعها
/// من نفس النقطة بالظبط. أي تصميم تاني (توجيه لشاشة دخول جذرية) معناه إن العميل بيرجع
/// للرئيسية بعد التسجيل ويبدأ من الأول — وده اللي المالك طلب تجنّبه صراحةً.
///
/// **مكان الاستدعاء الوحيد المهم**: `navigateToServiceBooking()` — نقطة الالتقاء الوحيدة لكل
/// مسارات اكتشاف الخدمة (فئات/بحث/رئيسية). الحقن هناك معناه إنه **مستحيل** يفضل مسار حجز بلا
/// بوابة، حتى لو اتضاف مسار اكتشاف جديد بكرة.
Future<bool> ensureSignedIn(
  BuildContext context, {
  required String reason,
  String? headline,
}) async {
  final auth = context.read<AuthRepository>();
  if (auth.isAuthenticated) return true;

  final wantsToSignIn = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _SignInInvitationSheet(reason: reason),
  );
  if (wantsToSignIn != true || !context.mounted) return false;

  final signedIn = await Navigator.of(context).push<bool>(
    MaterialPageRoute(builder: (_) => LoginScreen(isModal: true, headline: headline)),
  );
  // مش بنعتمد على القيمة المرجّعة لوحدها: العميل ممكن يكون سجّل ورجع بالزرار الخلفي للنظام،
  // فالمصدر الوحيد للحقيقة هو حالة المستودع نفسه.
  return signedIn == true || auth.isAuthenticated;
}

/// الواجهة الوسيطة اللي المالك طلبها — **دعوة مش حاجز**.
///
/// الفرق مش تجميلي: حاجز بيقول «ممنوع»، والدعوة بتقول «إحنا محتاجين نعرفك عشان نوصلك».
/// النص هنا بيشرح **ليه** بالظبط — العنوان والتواصل ومتابعة الطلب — لأن دي أسباب حقيقية
/// وبيّنة، مش شرط إداري.
class _SignInInvitationSheet extends StatelessWidget {
  const _SignInInvitationSheet({required this.reason});

  final String reason;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          24,
          4,
          24,
          24 + MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: theme.colorScheme.primaryContainer,
                ),
                child: Icon(
                  Icons.handshake_outlined,
                  size: 32,
                  color: theme.colorScheme.onPrimaryContainer,
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'خطوة واحدة وتكمّل',
              textAlign: TextAlign.center,
              style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              reason,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 18),
            const _Reason(icon: Icons.location_on_outlined, text: 'عشان نعرف نوصلك فين بالظبط'),
            const SizedBox(height: 10),
            const _Reason(icon: Icons.support_agent_outlined, text: 'عشان الفني يقدر يتواصل معاك'),
            const SizedBox(height: 10),
            const _Reason(icon: Icons.receipt_long_outlined, text: 'عشان تتابع طلبك وضمانه بعدين'),
            const SizedBox(height: 22),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
              child: const Text('سجّل برقم موبايلك — ثانية واحدة'),
            ),
            const SizedBox(height: 4),
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('لسه بتتفرّج؟ كمّل تصفّح'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Reason extends StatelessWidget {
  const _Reason({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Icon(icon, size: 20, color: theme.colorScheme.primary),
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: theme.textTheme.bodyMedium)),
      ],
    );
  }
}
