import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../core/deep_link_router.dart';
import '../orders/models.dart';
import 'google_review_prompt.dart';
import 'rating_dialog.dart';
import 'ratings_repository.dart';

/// يفتح تقييم الطلب المكتمل خارج صفحة الطلب، ويعيد الفحص عند فتح التطبيق أو الرجوع له.
/// الفحص الدوري خفيف ومقصور على التطبيق النشط حتى يظهر التقييم لو اكتمل الطلب أثناء الاستخدام.
class PendingRatingPromptHost extends StatefulWidget {
  const PendingRatingPromptHost({super.key});

  @override
  State<PendingRatingPromptHost> createState() =>
      _PendingRatingPromptHostState();
}

class _PendingRatingPromptHostState extends State<PendingRatingPromptHost>
    with WidgetsBindingObserver {
  static const _refreshInterval = Duration(minutes: 1);

  final Set<String> _promptedThisSession = {};
  Timer? _timer;
  bool _checking = false;
  bool _dialogOpen = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _check());
    _timer = Timer.periodic(_refreshInterval, (_) => _check());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _check();
  }

  Future<void> _check() async {
    if (!mounted || _checking || _dialogOpen) return;
    final auth = context.read<AuthRepository>();
    if (!auth.isAuthenticated || auth.biometricUnlockPending) return;

    _checking = true;
    try {
      final repository = RatingsRepository(auth);
      final pending = await repository.pending();
      final candidates = pending.where(
        (item) => !_promptedThisSession.contains(item.orderId),
      );
      if (candidates.isEmpty || !mounted) return;

      final candidate = candidates.first;
      _promptedThisSession.add(candidate.orderId);
      _dialogOpen = true;

      var afterPhotos = <OrderMedia>[];
      try {
        afterPhotos = await repository.afterPhotos(candidate.orderId);
      } catch (_) {
        // الصور إضافة اختيارية؛ تعطلها لا يمنع العميل من إرسال تقييمه.
      }

      final navigatorContext = rootNavigatorKey.currentContext;
      if (navigatorContext == null || !navigatorContext.mounted) return;
      final result = await showRatingDialog(
        navigatorContext,
        afterPhotos: afterPhotos,
        title: 'ساعدنا نخدمك أحسن',
        subtitle:
            'قيّم ${candidate.serviceNameAr} مع ${candidate.technicianName} '
            '(طلب ${candidate.orderNumber}). رأيك بيوصل للإدارة بكل تفاصيله.',
        dismissLabel: 'بعدها',
      );
      if (result == null) return;

      try {
        final response = await repository.rate(
          candidate.orderId,
          overallRating: result.overallRating,
          punctualityRating: result.punctualityRating,
          qualityRating: result.qualityRating,
          professionalismRating: result.professionalismRating,
          priceFairnessRating: result.priceFairnessRating,
          cleanlinessRating: result.cleanlinessRating,
          comment: result.comment,
          afterPhotoMediaIds: result.afterPhotoMediaIds,
        );
        if (!mounted || !navigatorContext.mounted) return;
        ScaffoldMessenger.maybeOf(navigatorContext)?.showSnackBar(
          const SnackBar(content: Text('شكرًا، تقييمك وصل للإدارة')),
        );
        final prompt =
            response['google_review_prompt'] as Map<String, dynamic>?;
        final reviewUrl = prompt?['review_url'] as String?;
        if (prompt?['should_prompt'] == true &&
            reviewUrl != null &&
            navigatorContext.mounted) {
          await showGoogleReviewPromptDialog(navigatorContext, reviewUrl);
        }
      } catch (error) {
        final apiError = ApiException.from(error);
        if (apiError.statusCode != 409 && navigatorContext.mounted) {
          ScaffoldMessenger.maybeOf(
            navigatorContext,
          )?.showSnackBar(SnackBar(content: Text(apiError.displayMessage)));
        }
      }
    } catch (_) {
      // فشل الشبكة هنا لا يعطل فتح التطبيق؛ الفحص التالي أو دخول صفحة الطلب يعيد المحاولة.
    } finally {
      _checking = false;
      _dialogOpen = false;
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
