import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../catalog/catalog_repository.dart';
import '../catalog/models.dart' show BookingModeJson;
import '../chat/chat_screen.dart';
import '../payments/card_payment_screen.dart';
import '../payments/fawry_reference_screen.dart';
import '../payments/instapay_reference_screen.dart';
import '../payments/payments_repository.dart';
import '../ratings/google_review_prompt.dart';
import '../ratings/rating_dialog.dart';
import '../ratings/ratings_repository.dart';
import '../support/file_complaint_screen.dart';
import '../support/support_contact_screen.dart';
import '../technicians/models.dart' show ScheduleSlot;
import '../technicians/technician_profile_screen.dart';
import '../technicians/technician_selection_screen.dart';
import '../technicians/technicians_repository.dart';
import '../tracking/tracking_client.dart';
import '../tracking/tracking_screen.dart';
import 'models.dart';
import 'orders_repository.dart';
import '../installments/installment_section.dart';

// نفس PAYABLE_ORDER_STATUSES في payments.service.ts بالظبط.
// pending_payment (docs/08 §19 بند 1) — دفع قبل التوزيع (ADR-0013): لو محاولة الدفع الأولى وقت
// إنشاء الطلب (CreateOrderScreen._startPrepayment) فشلت أو العميل رجع من غير ما يكمّل، الطلب
// بيفضل هنا يقدر يدفع منه تاني (نفس الأزرار) بدل ما يوصل شاشة بلا أي فعل ممكن — الباك-إند
// (assertPayable) أصلاً بيسمح بالتحصيل للحالة دي.
const Set<String> _payableOrderStatuses = {'work_completed', 'awaiting_payment', 'pending_payment'};

// نفس ACTIVE_TRACKING_STATUSES في order-tracking.gateway.ts بالظبط.
const Set<String> _activeTrackingStatuses = {'accepted', 'technician_on_way', 'technician_arrived', 'in_progress'};

class OrderDetailScreen extends StatefulWidget {
  final String orderId;

  const OrderDetailScreen({super.key, required this.orderId});

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  late final OrdersRepository _repository;
  late final RatingsRepository _ratingsRepository;
  late final PaymentsRepository _paymentsRepository;
  Order? _order;
  String? _error;
  bool _cancelling = false;
  bool _rated = false;
  bool _paying = false;
  bool _requestingRevisit = false;
  // Idempotency-Key (docs/01 §1.4، migration 0139، Script 7 Phase 9) — بيتولّد أول مرة بس
  // (`??=`) ويفضل نفسه لأي محاولة تانية على نفس شاشة الطلب ده — لو أول نداء نجح فعليًا بس الرد
  // اتفقد (network blip بعد الالتزام)، إعادة المحاولة بنفس المفتاح بترجّع نفس طلب إعادة الزيارة
  // الأصلي بدل ما تنشئ نسخة تانية مجانية.
  String? _revisitIdempotencyKey;
  bool _requestingRematch = false;
  bool _confirmingCashHandover = false;
  List<OrderItem> _quoteItems = [];
  bool _decidingQuote = false;
  List<TeamMember> _teamMembers = [];
  // مفتاح مستقر لكل طريقة دفع (يتولّد مرة واحدة بس، يفضل زي ما هو خلال أي retry لنفس المحاولة) —
  // راجع التعليق الكامل في payments_repository.dart's generateIdempotencyKey().
  String? _walletIdempotencyKey;
  String? _cardIdempotencyKey;
  String? _fawryIdempotencyKey;
  String? _instapayIdempotencyKey;
  // §24 — الشاشة كانت بتفضل عارضة الحالة القديمة لحد ما العميل يخرج ويرجع يدوي أو يعمل
  // pull-to-refresh، رغم إن الفني/الأدمن ممكن يغيّروا حالة الطلب وهي مفتوحة (on-way/arrived/
  // in-progress/completed/إلغاء أدمن). نفس آلية technician-app بالظبط — انضمام لغرفة الطلب
  // (namespace /tracking) واستقبال order:status_changed، مفيش بنية تحتية إضافية.
  final _trackingClient = OrderTrackingClient();

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthRepository>();
    _repository = OrdersRepository(auth);
    _ratingsRepository = RatingsRepository(auth);
    _paymentsRepository = PaymentsRepository(auth);
    _load();
    final accessToken = auth.accessToken;
    if (accessToken != null) {
      _trackingClient.connect(
        accessToken: accessToken,
        orderId: widget.orderId,
        onLocationUpdate: (_) {}, // الشاشة دي مالهاش خريطة — التتبع اللحظي بالموقع في TrackingScreen المنفصلة
        onOrderStatusChanged: (previousStatus, newStatus) {
          if (mounted) _load();
        },
      );
    }
  }

  @override
  void dispose() {
    _trackingClient.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final order = await _repository.getOne(widget.orderId);
      if (mounted) setState(() => _order = order);
      if (order.orderStatus == 'awaiting_quote_approval') {
        await _loadQuoteItems();
      }
      if (order.bookingMode == 'team' && order.technicianId != null) {
        final members = await _repository.fetchTeamMembers(widget.orderId);
        if (mounted) setState(() => _teamMembers = members);
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _loadQuoteItems() async {
    try {
      final items = await _repository.listQuoteItems(widget.orderId);
      if (mounted) setState(() => _quoteItems = items.where((i) => !i.isCustomerApproved).toList());
    } on ApiException {
      // فشل تحميل البنود مش لازم يمنع عرض باقي تفاصيل الطلب — العميل لسه يقدر يلغي الطلب كله
    }
  }

  // docs/08 §22 بند 1 — رقم تليفون الفني بيوصلنا بس بعد ما الباك-إند يتأكد إن الحجز اتأكد فعليًا،
  // فمفيش داعي لأي فحص إضافي هنا غير فتح تطبيق الاتصال.
  Future<void> _callTechnician(String phone) async {
    final uri = Uri(scheme: 'tel', path: phone);
    if (!await launchUrl(uri)) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تعذّر فتح تطبيق الاتصال')));
    }
  }

  // إعادة جدولة (docs/08 §22 بند 9-12) — بس قبل ما الفني يبدأ يتحرّك، لسلوت تاني لنفس الفني.
  Future<void> _rescheduleOrder() async {
    final order = _order;
    if (order == null || order.technicianId == null) return;

    List<ScheduleSlot> slots;
    try {
      final all = await TechniciansRepository(context.read<AuthRepository>()).fetchSchedule(order.technicianId!);
      slots = all.where((s) => s.isAvailable).toList();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
      return;
    }
    if (!mounted) return;
    if (slots.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('مفيش مواعيد تانية متاحة للفني ده دلوقتي')));
      return;
    }

    final chosen = await showDialog<ScheduleSlot>(
      context: context,
      builder: (context) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('اختار ميعاد جديد'),
          content: SizedBox(
            width: 400,
            height: 300,
            child: ListView.builder(
              itemCount: slots.length,
              itemBuilder: (context, i) {
                final s = slots[i];
                return ListTile(
                  title: Text('${s.slotDate} — ${s.startTime.substring(0, 5)}'),
                  onTap: () => Navigator.of(context).pop(s),
                );
              },
            ),
          ),
          actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('تراجع'))],
        ),
      ),
    );
    if (chosen == null) return;

    try {
      final updated = await _repository.reschedule(order.id, chosen.id);
      if (mounted) {
        setState(() => _order = updated);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اتغيّر الميعاد — الفني اتبلّغ')));
      }
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    }
  }

  Future<void> _approveQuote() async {
    // الطلب مدفوع مسبقًا إلكترونيًا — العميل يختار وسيلة دفع الزيادة (docs/08 §22 بند 8): كاش
    // (يتحصّل وقت الاكتمال) أو الدفع الإلكتروني (تحصيل فوري بالوسيلة المحفوظة). لطلب كاش عادي،
    // الاختيار مالوش معنى أصلاً (الباك-إند بيتجاهله)، فمفيش داعي نعرض الاختيار خالص.
    String paymentChoice = 'electronic';
    if (_order?.paymentStatus == 'paid') {
      final choice = await _showPaymentChoiceDialog();
      if (choice == null) return; // العميل قفل الـdialog من غير ما يختار
      paymentChoice = choice;
    }

    setState(() => _decidingQuote = true);
    try {
      final order = await _repository.approveQuote(widget.orderId, paymentChoice: paymentChoice);
      if (mounted) {
        setState(() {
          _order = order;
          _quoteItems = [];
        });
        // النتيجة النهائية بتتأكد لاحقًا (webhook)؛ رسالة بسيطة بس، صفر تفاصيل بوابة/دفع للعميل.
        final message = paymentChoice == 'electronic' && order.paymentStatus == 'paid'
            ? 'تمت الموافقة على الزيادة — جاري تحصيل المبلغ'
            : 'تمت الموافقة — الفني هيكمل الشغل';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
      }
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _decidingQuote = false);
    }
  }

  Future<String?> _showPaymentChoiceDialog() {
    return showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('اختار طريقة الدفع', style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).pop('cash'),
                icon: const Text('💵', style: TextStyle(fontSize: 20)),
                label: const Text('كاش'),
              ),
              const SizedBox(height: 8),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).pop('electronic'),
                icon: const Text('💳', style: TextStyle(fontSize: 20)),
                label: const Text('الدفع الإلكتروني'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _declineQuote() async {
    setState(() => _decidingQuote = true);
    try {
      final order = await _repository.declineQuote(widget.orderId);
      if (mounted) {
        setState(() {
          _order = order;
          _quoteItems = [];
        });
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('تم الرفض — الشغل هيكمل بالنطاق الأساسي بس')));
      }
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _decidingQuote = false);
    }
  }

  Future<void> _cancel() async {
    final result = await _showCancelDialog();
    if (result == null) return; // العميل قفل الـ dialog من غير ما يأكّد

    setState(() => _cancelling = true);
    try {
      final order = await _repository.cancel(
        widget.orderId,
        reason: result.freeText,
        cancellationReasonId: result.reasonId,
      );
      if (mounted) {
        setState(() => _order = order);
        final feeMessage = order.cancellationFeeCents > 0
            ? ' — اترصدت عليك رسوم إلغاء ${_formatEgp(order.cancellationFeeCents)}'
            : '';
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('اتلغى الطلب$feeMessage')));
      }
    } on ApiException catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
      }
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  // كانت فجوة موثّقة: الإلغاء مكانش بياخد سبب خالص من الواجهة رغم إن الباك-إند بيدعمه
  // (GET /cancellation-reasons + احتساب رسوم حسب النافذة الزمنية) — اتقفلت هنا.
  Future<_CancelChoice?> _showCancelDialog() async {
    List<CancellationReason> reasons = [];
    try {
      reasons = await _repository.listCancellationReasons();
    } on ApiException {
      // فشل تحميل الأسباب مش لازم يمنع الإلغاء نفسه — العميل لسه يقدر يلغي بسبب حر
    }

    String? selectedReasonId;
    final freeTextController = TextEditingController();

    if (!mounted) return null;
    return showDialog<_CancelChoice>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: StatefulBuilder(
          builder: (context, setDialogState) => AlertDialog(
            title: const Text('إلغاء الطلب'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (reasons.isNotEmpty) ...[
                    const Text('اختار سبب الإلغاء:'),
                    ...reasons.map(
                      (r) => RadioListTile<String>(
                        value: r.id,
                        groupValue: selectedReasonId,
                        onChanged: (v) => setDialogState(() => selectedReasonId = v),
                        title: Text(r.reasonAr),
                        subtitle: r.chargesFee
                            ? Text('ممكن يترتب عليه رسوم ${r.feePercentage.toStringAsFixed(0)}%')
                            : null,
                        dense: true,
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],
                  TextField(
                    controller: freeTextController,
                    decoration: const InputDecoration(labelText: 'تفاصيل إضافية (اختياري)'),
                    maxLines: 2,
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('تراجع'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(dialogContext).pop(
                  _CancelChoice(reasonId: selectedReasonId, freeText: freeTextController.text),
                ),
                child: const Text('تأكيد الإلغاء'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _rate() async {
    // صور "بعد التنفيذ" (docs/08 §9) — بنجيبها الأول عشان العميل يقدر يربطها بالتقييم لو موجودة.
    // فشل التحميل مش لازم يمنع التقييم نفسه (الدايالوج بيشتغل عادي بقايمة فاضية).
    List<OrderMedia> afterPhotos = [];
    try {
      final media = await _repository.fetchMedia(widget.orderId);
      afterPhotos = media.where((m) => m.mediaType == 'after_photo').toList();
    } on ApiException {
      // تجاهل — راجع التعليق فوق
    }
    if (!mounted) return;
    final result = await showRatingDialog(context, afterPhotos: afterPhotos);
    if (result == null) return;
    try {
      final response = await _ratingsRepository.rate(
        widget.orderId,
        overallRating: result.overallRating,
        punctualityRating: result.punctualityRating,
        qualityRating: result.qualityRating,
        professionalismRating: result.professionalismRating,
        priceFairnessRating: result.priceFairnessRating,
        cleanlinessRating: result.cleanlinessRating,
        comment: result.comment,
        afterPhotoMediaIds: result.afterPhotoMediaIds,
      );
      if (mounted) {
        setState(() => _rated = true);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('شكراً على تقييمك 🙏')));
        final prompt = response['google_review_prompt'] as Map<String, dynamic>?;
        final reviewUrl = prompt?['review_url'] as String?;
        if (prompt?['should_prompt'] == true && reviewUrl != null && mounted) {
          await showGoogleReviewPromptDialog(context, reviewUrl);
        }
      }
    } on ApiException catch (err) {
      // 409 لو اتقيّم قبل كده (مفيش endpoint تحقق مسبق، راجع ratings_repository.dart) —
      // بنعتبرها نفس نتيجة "اتقيّم" من ناحية الواجهة، مش خطأ حقيقي محتاج المستخدم يعيد المحاولة.
      if (mounted) {
        if (err.statusCode == 409) {
          setState(() => _rated = true);
        }
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
      }
    }
  }

  // إعادة الزيارة تحت الضمان (docs/08 §7) — كانت فجوة موثّقة صراحة: الباك-إند بيدعم
  // POST /orders {original_order_id} من زمان (مجاني بالكامل، بيرجع لنفس الفني الأصلي تلقائيًا)
  // بس العميل ماكانش يعرف إن طلبه تحت ضمان أصلاً ولا عنده أي طريقة يطلب إعادة زيارة.
  Future<void> _requestRevisit() async {
    final order = _order;
    if (order == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('طلب إعادة زيارة (ضمان)'),
          content: const Text('هيتبعت طلب مجاني بالكامل لنفس الفني اللي نفّذ الشغل، لو نفس المشكلة رجعت تاني.'),
          actions: [
            TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('تراجع')),
            FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('تأكيد الطلب')),
          ],
        ),
      ),
    );
    if (confirmed != true) return;

    setState(() => _requestingRevisit = true);
    try {
      _revisitIdempotencyKey ??= _paymentsRepository.generateIdempotencyKey();
      final revisitOrder = await _repository.create(
        serviceId: order.serviceId,
        addressId: order.addressId,
        bookingMode: BookingModeJson.fromApiValue(order.bookingMode),
        originalOrderId: order.id,
        idempotencyKey: _revisitIdempotencyKey!,
      );
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: revisitOrder.id)),
        );
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('اتبعت طلب إعادة الزيارة بنجاح ✅')));
      }
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _requestingRevisit = false);
    }
  }

  // سياسة إلغاء الفني (docs/10) — الطلب بيوصل awaiting_technician_reselection لما فني يلغي
  // طلب كان العميل اختاره بنفسه. مساران: مطابقة تلقائية فورية، أو اختيار فني بديل بعينه.
  Future<void> _requestAutoRematch() async {
    setState(() => _requestingRematch = true);
    try {
      await _repository.requestRematch(widget.orderId);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('بندوّرلك على فني بديل دلوقتي')));
      }
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _requestingRematch = false);
    }
  }

  Future<void> _openManualReselection() async {
    final order = _order;
    if (order == null) return;
    try {
      final service = await CatalogRepository().fetchService(order.serviceId);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => TechnicianSelectionScreen(
            service: service,
            excludeTechnicianId: order.requestedTechnicianId,
            onManualSelect: (requestedTechnicianId) async {
              Navigator.of(context).pop();
              setState(() => _requestingRematch = true);
              try {
                await _repository.requestRematch(widget.orderId, requestedTechnicianId: requestedTechnicianId);
                if (mounted) {
                  ScaffoldMessenger.of(context)
                      .showSnackBar(const SnackBar(content: Text('اتبعت طلبك للفني اللي اخترته ✅')));
                }
                await _load();
              } on ApiException catch (err) {
                if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
              } finally {
                if (mounted) setState(() => _requestingRematch = false);
              }
            },
          ),
        ),
      );
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    }
  }

  Future<void> _payWithWallet() async {
    setState(() => _paying = true);
    try {
      _walletIdempotencyKey ??= _paymentsRepository.generateIdempotencyKey();
      await _paymentsRepository.payWithWallet(widget.orderId, _walletIdempotencyKey!);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اتدفع من المحفظة بنجاح ✅')));
      }
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  Future<void> _payWithCard() async {
    setState(() => _paying = true);
    try {
      _cardIdempotencyKey ??= _paymentsRepository.generateIdempotencyKey();
      final redirectUrl = await _paymentsRepository.payWithCard(widget.orderId, _cardIdempotencyKey!);
      if (!mounted) return;
      final confirmedPaid = await Navigator.of(context).push<bool>(
        MaterialPageRoute(builder: (_) => CardPaymentScreen(orderId: widget.orderId, redirectUrl: redirectUrl)),
      );
      if (confirmedPaid == true && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اتدفع بالبطاقة بنجاح ✅')));
      }
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  Future<void> _payWithFawryReference() async {
    setState(() => _paying = true);
    try {
      _fawryIdempotencyKey ??= _paymentsRepository.generateIdempotencyKey();
      final reference = await _paymentsRepository.payWithFawryReference(widget.orderId, _fawryIdempotencyKey!);
      if (!mounted) return;
      final confirmedPaid = await Navigator.of(context).push<bool>(
        MaterialPageRoute(builder: (_) => FawryReferenceScreen(orderId: widget.orderId, reference: reference)),
      );
      if (confirmedPaid == true && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اتدفع بنجاح ✅')));
      }
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  // InstaPay — كانت فجوة UI موثّقة صراحة (docs/08 §19 بند 1): الـendpoint (POST /orders/:id/pay-with-instapay)
  // موجود من ADR-0013 بلا أي شاشة بتنادي عليه خالص، رغم إن باقي الطرق التلاتة (محفظة/كارت/فوري)
  // كانوا متوصّلين. نفس نمط _payWithFawryReference بالحرف.
  Future<void> _payWithInstaPay() async {
    setState(() => _paying = true);
    try {
      _instapayIdempotencyKey ??= _paymentsRepository.generateIdempotencyKey();
      final reference = await _paymentsRepository.payWithInstaPay(widget.orderId, _instapayIdempotencyKey!);
      if (!mounted) return;
      final confirmedPaid = await Navigator.of(context).push<bool>(
        MaterialPageRoute(builder: (_) => InstaPayReferenceScreen(orderId: widget.orderId, reference: reference)),
      );
      if (confirmedPaid == true && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اتدفع بنجاح ✅')));
      }
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  // تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14) — تأكيد بس، الطلب مايتسوّاش من غير ما الفني
  // (أو الأدمن لو حصل نزاع) يأكّد الاستلام الفعلي. زرار idempotent (الباك-إند بيتجاهل التكرار).
  Future<void> _confirmCashHandover() async {
    setState(() => _confirmingCashHandover = true);
    try {
      final order = await _repository.confirmCashHandover(widget.orderId);
      if (mounted) {
        setState(() => _order = order);
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('تمام، سجّلنا إنك سلّمت الفلوس ✅')));
      }
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _confirmingCashHandover = false);
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  @override
  Widget build(BuildContext context) {
    final order = _order;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: Text(order != null ? 'طلب ${order.orderNumber}' : 'تفاصيل الطلب'),
          actions: [
            // إتاحة الدعم أثناء طلب نشط بشكل واضح (docs/08 §22 بند 18) — مش مدفون في قوائم فرعية.
            IconButton(
              icon: const Icon(Icons.support_agent_outlined),
              tooltip: 'تواصل مع الدعم',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const SupportContactScreen()),
              ),
            ),
          ],
        ),
        body: _error != null
            ? Center(child: Text(_error!))
            : order == null
                ? const Center(child: CircularProgressIndicator())
                : ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // "ادفع بالتقسيط" — بيظهر بس لو الخدمة عليها خطط متاحة
                      InstallmentSection(
                        key: ValueKey('inst_${order.id}'),
                        auth: context.read<AuthRepository>(),
                        orderId: order.id,
                        serviceId: order.serviceId,
                      ),
                      const SizedBox(height: 8),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                orderStatusLabelsAr[order.orderStatus] ?? order.orderStatus,
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                              const SizedBox(height: 8),
                              Text('السعر الإجمالي: ${_formatEgp(order.totalAmountCents)}'),
                              const SizedBox(height: 4),
                              // "امتى تحب تنفّذ الشغل؟" (docs/08 §154، مُعدَّلة §32.3) — التاريخ بقى
                              // إجباري لكل الأوضاع غير الطوارئ، فـnull هنا معناها طلب طوارئ (أو
                              // طلب قديم من قبل التصحيح).
                              Text(
                                order.scheduledAt == null
                                    ? 'الموعد: فوري'
                                    : 'الموعد المطلوب: ${DateTime.parse(order.scheduledAt!).toLocal().toString().substring(0, 16)}',
                                style: const TextStyle(color: Colors.grey),
                              ),
                              if (order.problemDescription != null) ...[
                                const SizedBox(height: 8),
                                Text('الوصف: ${order.problemDescription}'),
                              ],
                              // محرك الإنتاجية (docs/06 §3.3-§3.6) — كانت فجوة موثّقة صراحة:
                              // العميل كان بيشوف معاينة المدة قبل الحجز بس، مش القيم اللي
                              // اتسجلت فعليًا على طلبه بعد التأكيد.
                              if (order.estimatedDurationDays != null) ...[
                                const SizedBox(height: 8),
                                Text(
                                  'المدة المتوقعة: ${order.estimatedDurationDays} يوم'
                                  '${order.requiredTechnicians != null ? ' — ${order.requiredTechnicians} صنايعي' : ''}'
                                  '${(order.requiredAssistants ?? 0) > 0 ? ' + ${order.requiredAssistants} مساعد' : ''}',
                                ),
                              ],
                              if (order.originalOrderId != null) ...[
                                const SizedBox(height: 8),
                                Text(
                                  'إعادة زيارة لطلب سابق — مجانية بالكامل',
                                  style: TextStyle(color: Theme.of(context).colorScheme.primary),
                                ),
                              ],
                              if (order.warrantyExpiresAt != null) ...[
                                const SizedBox(height: 8),
                                Text(
                                  order.isUnderWarranty
                                      ? 'تحت الضمان لحد ${DateTime.parse(order.warrantyExpiresAt!).toLocal().toString().substring(0, 10)}'
                                      : 'انتهى الضمان في ${DateTime.parse(order.warrantyExpiresAt!).toLocal().toString().substring(0, 10)}',
                                  style: TextStyle(
                                    color: order.isUnderWarranty
                                        ? Colors.green
                                        : Theme.of(context).colorScheme.outline,
                                  ),
                                ),
                              ],
                              if (order.optionalWarrantyNameAr != null) ...[
                                const SizedBox(height: 8),
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: Theme.of(context).colorScheme.primaryContainer,
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Text(
                                    'الضمان الإضافي: ${order.optionalWarrantyNameAr} '
                                    '(${order.optionalWarrantyCoverageMonths} شهر) — '
                                    'تكلفته ${(order.warrantyPriceCents / 100).toStringAsFixed(0)} ج.م ضمن الإجمالي',
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                      if (order.technicianPhone != null) ...[
                        const SizedBox(height: 16),
                        Card(
                          color: Theme.of(context).colorScheme.primaryContainer,
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                const Text('يفضل الاتصال بالفني لتأكيد تفاصيل الموعد.', textAlign: TextAlign.center),
                                const SizedBox(height: 8),
                                // قاعدة بساطة الواجهة (docs/08 §22 بند 20-30) — زرار ثانوي (اتصال/تواصل)
                                // مش الفعل الأساسي للمرحلة، فمش لازم يتنافس بصريًا مع الفعل الأساسي
                                // (دفع/تقييم/موافقة عرض سعر) اللي بيظهر تحت في نفس الحالة.
                                OutlinedButton.icon(
                                  onPressed: () => _callTechnician(order.technicianPhone!),
                                  icon: const Icon(Icons.call),
                                  label: Text('اتصل بالفني${order.technicianName != null ? ' — ${order.technicianName}' : ''}'),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                      if (order.technicianId != null &&
                          (order.orderStatus == 'technician_assigned' || order.orderStatus == 'accepted')) ...[
                        const SizedBox(height: 16),
                        OutlinedButton.icon(
                          onPressed: _rescheduleOrder,
                          icon: const Icon(Icons.event_repeat_outlined),
                          label: const Text('غيّر ميعاد الزيارة'),
                        ),
                      ],
                      if (order.technicianId != null) ...[
                        const SizedBox(height: 16),
                        OutlinedButton.icon(
                          onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => ChatScreen(orderId: order.id)),
                          ),
                          icon: const Icon(Icons.chat_bubble_outline),
                          label: const Text('الشات مع الفني'),
                        ),
                        const SizedBox(height: 8),
                        OutlinedButton.icon(
                          onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => TechnicianProfileScreen(technicianId: order.technicianId!),
                            ),
                          ),
                          icon: const Icon(Icons.person_outline),
                          label: const Text('بروفايل الفني'),
                        ),
                      ],
                      if (_teamMembers.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('فريق الشغل', style: Theme.of(context).textTheme.titleMedium),
                                const SizedBox(height: 8),
                                for (final member in _teamMembers)
                                  Padding(
                                    padding: const EdgeInsets.symmetric(vertical: 4),
                                    child: Row(
                                      children: [
                                        CircleAvatar(
                                          radius: 16,
                                          backgroundImage:
                                              member.avatarUrl != null ? NetworkImage(member.avatarUrl!) : null,
                                          child: member.avatarUrl == null ? const Icon(Icons.person, size: 16) : null,
                                        ),
                                        const SizedBox(width: 8),
                                        Expanded(child: Text(member.fullName)),
                                        Text(member.roleLabel, style: Theme.of(context).textTheme.bodySmall),
                                      ],
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ],
                      if (_activeTrackingStatuses.contains(order.orderStatus)) ...[
                        const SizedBox(height: 16),
                        OutlinedButton.icon(
                          onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => TrackingScreen(
                                orderId: order.id,
                                orderNumber: order.orderNumber,
                                destination: order.address,
                              ),
                            ),
                          ),
                          icon: const Icon(Icons.location_on_outlined),
                          label: const Text('تتبّع الفني لحظياً'),
                        ),
                      ],
                      if (order.orderStatus == 'awaiting_quote_approval' && _quoteItems.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Card(
                          color: Theme.of(context).colorScheme.secondaryContainer,
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('عرض سعر جديد يستنى موافقتك', style: Theme.of(context).textTheme.titleMedium),
                                const SizedBox(height: 8),
                                for (final item in _quoteItems)
                                  Padding(
                                    padding: const EdgeInsets.symmetric(vertical: 4),
                                    child: Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Expanded(
                                          child: Text(
                                            '${item.nameAr} (${orderItemTypeLabelsAr[item.itemType] ?? item.itemType})',
                                          ),
                                        ),
                                        Text(_formatEgp(item.totalPriceCents)),
                                      ],
                                    ),
                                  ),
                                const Divider(),
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    const Text('إجمالي الإضافي', style: TextStyle(fontWeight: FontWeight.bold)),
                                    Text(
                                      _formatEgp(_quoteItems.fold<int>(0, (sum, i) => sum + i.totalPriceCents)),
                                      style: const TextStyle(fontWeight: FontWeight.bold),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                Row(
                                  children: [
                                    Expanded(
                                      child: OutlinedButton(
                                        onPressed: _decidingQuote ? null : _declineQuote,
                                        child: const Text('رفض'),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: FilledButton(
                                        onPressed: _decidingQuote ? null : _approveQuote,
                                        child: _decidingQuote
                                            ? const SizedBox(
                                                width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                            : const Text('موافقة'),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                      if (_payableOrderStatuses.contains(order.orderStatus) && order.paymentStatus != 'paid') ...[
                        const SizedBox(height: 16),
                        FilledButton.icon(
                          onPressed: _paying ? null : _payWithWallet,
                          icon: const Icon(Icons.account_balance_wallet_outlined),
                          label: _paying
                              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Text('ادفع من المحفظة'),
                        ),
                        const SizedBox(height: 8),
                        OutlinedButton.icon(
                          onPressed: _paying ? null : _payWithCard,
                          icon: const Icon(Icons.credit_card_outlined),
                          label: const Text('ادفع بالبطاقة'),
                        ),
                        const SizedBox(height: 8),
                        OutlinedButton.icon(
                          onPressed: _paying ? null : _payWithFawryReference,
                          icon: const Icon(Icons.storefront_outlined),
                          label: const Text('ادفع في أقرب فوري'),
                        ),
                        const SizedBox(height: 8),
                        OutlinedButton.icon(
                          onPressed: _paying ? null : _payWithInstaPay,
                          icon: const Icon(Icons.send_outlined),
                          label: const Text('ادفع عبر InstaPay'),
                        ),
                        // تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14) — لو العميل هيدفع كاش
                        // في إيد الفني (مش من خلال التطبيق)، بعد ما يسلّم يضغط هنا يأكّد.
                        //
                        // بَقّة حقيقية اتلقطت من صاحب المشروع (2026-08-21): الزرار ده كان بيظهر
                        // حتى لطلب `pending_payment` (قبل التوزيع، صفر فني معيّن بالتصميم — راجع
                        // order-state-machine.ts) — عميل جرّب InstaPay بس ما حوّلش فعليًا، رجع
                        // يختار وسيلة تانية، لقى زرار "دفعت كاش للفني" ودسّ عليه، فسجّل تأكيد
                        // يتيم وظهرله "في انتظار تأكيد الفني" رغم إن مفيش فني أصلاً. تسليم كاش
                        // منطقيًا محتاج فني موجود يستلمه — `technicianId != null` بيضمن كده بدل
                        // ما نكرر أسماء حالات هنا (نفس فلسفة الفحص الجديد في
                        // OrdersService.confirmCashHandover()، دفاع مزدوج).
                        if (order.technicianId != null) ...[
                          const SizedBox(height: 8),
                          if (order.customerCashConfirmedAt == null)
                            OutlinedButton.icon(
                              onPressed: _confirmingCashHandover ? null : _confirmCashHandover,
                              icon: const Icon(Icons.money_outlined),
                              label: _confirmingCashHandover
                                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                  : const Text('دفعت الفلوس كاش للفني'),
                            )
                          else
                            Row(
                              children: const [
                                Icon(Icons.check_circle_outline, color: Colors.green, size: 18),
                                SizedBox(width: 6),
                                Expanded(child: Text('اتسجّل إنك سلّمت الكاش — في انتظار تأكيد الفني')),
                              ],
                            ),
                        ],
                      ],
                      if (customerCancellableStatuses.contains(order.orderStatus)) ...[
                        const SizedBox(height: 16),
                        OutlinedButton(
                          onPressed: _cancelling ? null : _cancel,
                          child: _cancelling
                              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Text('إلغاء الطلب'),
                        ),
                      ],
                      if (order.orderStatus == 'completed' && !_rated) ...[
                        const SizedBox(height: 16),
                        FilledButton.icon(
                          onPressed: _rate,
                          icon: const Icon(Icons.star_outline),
                          label: const Text('قيّم الطلب'),
                        ),
                      ],
                      if (order.orderStatus == 'completed' && order.isUnderWarranty) ...[
                        const SizedBox(height: 8),
                        OutlinedButton.icon(
                          onPressed: _requestingRevisit ? null : _requestRevisit,
                          icon: const Icon(Icons.replay_outlined),
                          label: _requestingRevisit
                              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Text('طلب إعادة زيارة (ضمان)'),
                        ),
                      ],
                      // سياسة إلغاء الفني (docs/10) — الفني اللي اخترته اعتذر، الطلب الأصلي
                      // (خدمة/عنوان/موعد) محفوظ بالكامل، محتاج تختار بديل أو تسيبنا ندوّرلك.
                      if (order.orderStatus == 'awaiting_technician_reselection') ...[
                        const SizedBox(height: 12),
                        Card(
                          color: Colors.orange.shade50,
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'الفني اعتذر عن طلبك. اختار فني بديل بنفسك أو سيبنا ندوّرلك على واحد.',
                                ),
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    Expanded(
                                      child: OutlinedButton(
                                        onPressed: _requestingRematch ? null : _openManualReselection,
                                        child: const Text('اختار فني بديل'),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: FilledButton(
                                        onPressed: _requestingRematch ? null : _requestAutoRematch,
                                        child: _requestingRematch
                                            ? const SizedBox(
                                                width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                            : const Text('دوّرلي تلقائيًا'),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                      // شكاوى الطلب (docs/08 §19 بند 13) — متاح على أي حالة (حتى بعد اكتمال/إلغاء
                      // الطلب — العميل ممكن يشتكي من جودة شغل بعد ما خلص مثلاً)، مش مقيّد بحالة
                      // معيّنة زي باقي الأزرار فوق.
                      const SizedBox(height: 16),
                      OutlinedButton.icon(
                        onPressed: () => Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => FileComplaintScreen(orderId: order.id)),
                        ),
                        icon: const Icon(Icons.report_problem_outlined),
                        label: const Text('قدّم شكوى عن الطلب ده'),
                      ),
                    ],
                  ),
      ),
    );
  }
}

class _CancelChoice {
  final String? reasonId;
  final String freeText;

  _CancelChoice({required this.reasonId, required this.freeText});
}
