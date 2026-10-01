import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/auth_repository.dart';
import 'academy_repository.dart';
import 'academy_screen.dart';
import 'models.dart';

/// بانر «فيه كورس مطلوب منك» (ADR-0117) — بيظهر بس لو فيه حاجة ناقصة فعلاً، وأي فشل في التحميل
/// = مايظهرش خالص (تحسين، مش شرط يعطّل الشاشة اللي هو فيها).
class AcademyOnboardingBanner extends StatefulWidget {
  const AcademyOnboardingBanner({super.key});

  @override
  State<AcademyOnboardingBanner> createState() => _AcademyOnboardingBannerState();
}

class _AcademyOnboardingBannerState extends State<AcademyOnboardingBanner> {
  AcademyOnboardingStatus? _status;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final status = await AcademyRepository(context.read<AuthRepository>()).onboardingStatus();
      if (mounted) setState(() => _status = status);
    } catch (_) {
      // مقصود: البانر إضافة. السيرفر الأقدم أو الشبكة ⇒ الشاشة زي ما كانت.
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;
    if (status == null || !status.needsAction) return const SizedBox.shrink();
    final pending = status.courses.where((c) => !c.passed).map((c) => '«${c.titleAr}»').join('، ');
    final title = status.retrainingRequired ? 'مطلوب منك تعيد كورس قصير' : 'كورس إلزامي قبل ما تبدأ شغل';
    final body = status.retrainingRequired
        ? 'السبب: ${status.retrainingReason ?? 'تقييم أو شكوى على الأسلوب'}. ده مش إيقاف — راجع الدرس وامتحن تاني.'
        : 'خلّص $pending من الأكاديمية — درس قصير و٨ أسئلة.';
    return Card(
      key: const Key('academy-onboarding-banner'),
      color: Theme.of(context).colorScheme.tertiaryContainer,
      child: ListTile(
        leading: const Icon(Icons.school_outlined),
        title: Text(title),
        subtitle: Text(body),
        trailing: const Icon(Icons.chevron_left),
        onTap: () async {
          await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AcademyScreen()));
          await _load();
        },
      ),
    );
  }
}
