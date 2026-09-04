import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api_exception.dart';
import '../../core/work_scope_label.dart';
import '../../core/auth_repository.dart';
import '../../core/media_url.dart';
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
import '../technicians/technician_profile_screen.dart';
import '../technicians/technician_selection_screen.dart';
import '../tracking/tracking_client.dart';
import '../tracking/tracking_screen.dart';
import 'models.dart';
import 'orders_repository.dart';
import '../installments/installment_section.dart';
import '../../design/order_number_title.dart';

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
  List<OrderMedia> _media = [];
  List<OrderRescheduleRequest> _rescheduleRequests = [];
  bool _decidingRescheduleRequest = false;
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
      if (order.technicianId != null) await _loadRescheduleRequests();
      await _loadMedia();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _loadRescheduleRequests() async {
    try {
      final requests = await _repository.listRescheduleRequests(widget.orderId);
      if (mounted) setState(() => _rescheduleRequests = requests);
    } on ApiException {
      // الطلب نفسه يظل قابلًا للاستخدام لو تحميل سجل التأجيل فشل مؤقتًا.
    }
  }

  Future<void> _decideRescheduleRequest(OrderRescheduleRequest request, bool approve) async {
    setState(() => _decidingRescheduleRequest = true);
    try {
      final result = await _repository.decideRescheduleRequest(widget.orderId, request.id, approve);
      if (mounted) {
        setState(() => _order = result.order);
        await _loadRescheduleRequests();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(approve ? 'تم اعتماد الموعد الجديد وإبلاغ الفني' : 'تم الرفض وسيظل الموعد الحالي كما هو')),
          );
        }
      }
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _decidingRescheduleRequest = false);
    }
  }

  String _formatRescheduleDate(DateTime value) {
    final local = value.toLocal();
    return '${local.day}/${local.month}/${local.year} — ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  }

  Future<void> _loadMedia() async {
    try {
      final media = await _repository.fetchMedia(widget.orderId);
      if (mounted) {
        setState(() => _media = media.where((item) => item.mediaType != 'video').toList());
      }
    } on ApiException {
      // الصور مصدر ثانوي؛ فشلها لا يمنع عرض الطلب أو تنفيذ أفعاله.
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

  String _formatRescheduleOptionDate(String value) {
    final date = DateTime.tryParse(value);
    if (date == null) return value;
    const weekdays = ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
    return '${weekdays[date.weekday - 1]} ${date.day}/${date.month}/${date.year}';
  }

  Future<void> _showRescheduleSupport(String message) async {
    final openSupport = await showDialog<bool>(
      context: context,
      builder: (context) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('جدولة الموعد عبر الإدارة'),
          content: Text('$message\n\nيمكنك الاتصال بالإدارة أو إرسال رسالة وسيتم ترتيب الموعد مع الطرفين.'),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('لاحقًا')),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).pop(true),
              icon: const Icon(Icons.support_agent_outlined),
              label: const Text('تواصل مع الإدارة'),
            ),
          ],
        ),
      ),
    );
    if (openSupport == true && mounted) {
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SupportContactScreen()));
    }
  }

  // نفس مصدر الأيام المتاحة الذي تستخدمه لوحة الإدارة. غياب slot صريح لا يعني أن الفني مشغول؛
  // نموذج الجدول الحالي opt-out، لذلك الاختيار يتم باليوم ويُفحص مركزيًا في الـAPI.
  Future<void> _rescheduleOrder() async {
    final order = _order;
    if (order == null || order.technicianId == null) return;

    List<RescheduleDateOption> options;
    try {
      final all = await _repository.listRescheduleOptions(order.id);
      options = all.where((option) => option.available).toList();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
      return;
    }
    if (!mounted) return;
    if (options.isEmpty) {
      await _showRescheduleSupport('لا توجد أيام متاحة للفني خلال الفترة القادمة.');
      return;
    }

    final chosen = await showDialog<RescheduleDateOption>(
      context: context,
      builder: (context) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('اختار ميعاد جديد'),
          content: SizedBox(
            width: 400,
            height: 300,
            child: ListView.builder(
              itemCount: options.length,
              itemBuilder: (context, i) {
                final option = options[i];
                return ListTile(
                  leading: const Icon(Icons.calendar_today_outlined),
                  title: Text(_formatRescheduleOptionDate(option.date)),
                  subtitle: const Text('الفني متاح في هذا اليوم'),
                  onTap: () => Navigator.of(context).pop(option),
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
      final updated = await _repository.reschedule(order.id, chosen.date);
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

  Future<void> _approveInitialQuote() async {
    setState(() => _decidingQuote = true);
    try {
      final order = await _repository.approveInitialQuote(widget.orderId);
      if (mounted) {
        setState(() => _order = order);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              order.orderStatus == 'searching_technician'
                  ? 'وافقت على السعر — بدأنا اختيار الفني المناسب'
                  : 'وافقت على السعر — الفني يقدر يكمل الشغل',
            ),
          ),
        );
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
                    RadioGroup<String>(
                      groupValue: selectedReasonId,
                      onChanged: (v) => setDialogState(() => selectedReasonId = v),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: reasons
                            .map(
                              (r) => RadioListTile<String>(
                                value: r.id,
                                title: Text(r.reasonAr),
                                subtitle: r.chargesFee
                                    ? Text('ممكن يترتب عليه رسوم ${r.feePercentage.toStringAsFixed(0)}%')
                                    : null,
                                dense: true,
                              ),
                            )
                            .toList(),
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
                onPressed: () {
                  // راجع docs/08 §108-C — شيل الفوكس من حقل النص الحر قبل الإقفال
                  // عشان نتجنب Flutter assertion '_dependents.isEmpty' (شاشة حمرا).
                  FocusScope.of(dialogContext).unfocus();
                  Navigator.of(dialogContext).pop();
                },
                child: const Text('تراجع'),
              ),
              // السبب إجباري طول ما فيه قايمة (docs/08 §112) — الباك-إند بيرفض بدونه، والزرار
              // هنا بيتقفل عشان الرفض ما يوصلش للعميل كرسالة خطأ بعد ما يضغط.
              FilledButton(
                onPressed: reasons.isNotEmpty && selectedReasonId == null
                    ? null
                    : () {
                        FocusScope.of(dialogContext).unfocus();
                        Navigator.of(dialogContext).pop(
                          _CancelChoice(reasonId: selectedReasonId, freeText: freeTextController.text),
                        );
                      },
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
          content: const Text(
            'هيتبعت طلب مجاني بالكامل لنفس الفني اللي نفّذ الشغل. الفني هيتواصل معاك، '
            'والزيارة هتكون خلال 3 أيام إلى أسبوع علشان يتنسق الموعد بشكل مناسب.',
          ),
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
            .showSnackBar(const SnackBar(content: Text('اتبعت إعادة الزيارة — الفني هيتواصل معاك والزيارة خلال 3 أيام إلى أسبوع')));
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
          title: OrderNumberTitle(orderNumber: order?.orderNumber),
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
                      if (order.orderStatus != 'awaiting_admin_quote' &&
                          order.orderStatus != 'awaiting_initial_quote_approval') ...[
                        InstallmentSection(
                          key: ValueKey('inst_${order.id}'),
                          auth: context.read<AuthRepository>(),
                          orderId: order.id,
                          serviceId: order.serviceId,
                        ),
                        const SizedBox(height: 8),
                      ],
                      // طمأنة أثناء الانتظار (docs/08 §77-B3، طلب مالك صريح) — فوق كل حاجة
                      // عشان دي أول سؤال في دماغ العميل وهو مستني.
                      if (_kAwaitingTechnicianStatuses.contains(order.orderStatus)) ...[
                        const _AwaitingTechnicianCard(),
                        const SizedBox(height: 8),
                      ],
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
                              Text(
                                order.orderStatus == 'awaiting_admin_quote'
                                    ? 'السعر: الإدارة بتراجعه'
                                    : order.orderStatus == 'awaiting_initial_quote_approval'
                                        ? 'السعر المقترح: ${_formatEgp(order.estimatedPriceCents ?? 0)}'
                                        : 'السعر الإجمالي: ${_formatEgp(order.totalAmountCents)}',
                              ),
                              // الخصم بيظهر بس لو فيه خصم فعلي (ممنوع «الخصم 0 ج»). كان
                              // بيتعرض في المعاينة قبل التأكيد وبس، وبعد الحجز يختفي —
                              // فالعميل اللي دخّل كود خصم مكانش يقدر يتأكد إنه اتطبّق.
                              if (order.discountAmountCents > 0)
                                Text(
                                  'الخصم المطبّق: -${_formatEgp(order.discountAmountCents)}',
                                  style: TextStyle(color: Theme.of(context).colorScheme.tertiary),
                                ),
                              // docs/08 §60.3 (طلب مالك صريح) — لما السعر يزيد عشان الفني اللي
                              // اتعيّن مستواه أعلى، الزيادة لازم تبان بسببها مكتوب، مش رقم
                              // بيتغيّر من غير تفسير. والسطر التاني تحتها مطمئن ومقصود يكون
                              // خفيف: العميل يعرف إن له اختيار تاني من غير ما نحسسه إن حد
                              // زوّد عليه.
                              if (order.levelPremiumCents > 0) ...[
                                const SizedBox(height: 4),
                                // docs/08 §65.1 — كانت Icons.verified هنا كمان. علامة الصح
                                // محجوزة حصريًا لتوثيق الأدمن (ADR-0039)، فاستخدامها لفرق
                                // السعر كان بيدّي العميل علامتين صح بمعنيين مختلفين.
                                Row(
                                  children: [
                                    Icon(Icons.diamond_outlined,
                                        size: 14, color: Theme.of(context).colorScheme.tertiary),
                                    const SizedBox(width: 4),
                                    // docs/08 §108-H — Text وحيدة في Row بلا Expanded كانت
                                    // بتفيض أفقيًا على شاشة ضيقة/خط كبير بدل ما تلف لسطر تاني.
                                    Expanded(
                                      child: Text(
                                        'منها ${_formatEgp(order.levelPremiumCents)} — فني Premium',
                                        style: TextStyle(
                                          color: Theme.of(context).colorScheme.tertiary,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                Text(
                                  'اتعيّن لك فني تقييمه ومستواه أعلى. لو تحب تختار بنفسك المرة الجاية، تقدر من "اختار الفني".',
                                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                        color: Theme.of(context).hintColor,
                                      ),
                                ),
                              ],
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
                              // نفس صياغة شاشة الحجز بالحرف (`core/work_scope_label.dart`) —
                              // الشاشتين كانوا بيكتبوا المدة بطريقتين مختلفتين، والاتنين
                              // بيقولوا «يوم» حتى لشغلانة ساعتين. وكلمة «صنايعي» اتشالت لأن
                              // المنصة فيها خدمات مش حرفية (جليسة أطفال، تنظيف، رعاية).
                              if (formatWorkDuration(minutes: order.durationMinutes, days: order.estimatedDurationDays) != null) ...[
                                const SizedBox(height: 8),
                                Text(
                                  'المدة المتوقعة: ${formatWorkDuration(minutes: order.durationMinutes, days: order.estimatedDurationDays)}'
                                  '${formatWorkforce(technicians: order.requiredTechnicians, assistants: order.requiredAssistants) != null ? ' — ${formatWorkforce(technicians: order.requiredTechnicians, assistants: order.requiredAssistants)}' : ''}',
                                ),
                              ],
                              // رسايل الإدارة (ADR-0071، بلاغ مالك 2026-09-04) — النص اللي
                              // الأدمن كتبه كان بيوصل في الإشعار وبس، والعميل يفتح الطلب
                              // يلاقيه فاضي من أي تفاصيل. دلوقتي بيتقرا مع الطلب نفسه.
                              for (final notice in order.customerNotices) ...[
                                const SizedBox(height: 10),
                                _AdminNoticeCard(notice: notice),
                              ],
                              if (order.originalOrderId != null) ...[
                                const SizedBox(height: 8),
                                Text(
                                  'إعادة زيارة لطلب سابق — مجانية بالكامل. الفني هيتواصل معاك والزيارة خلال 3 أيام إلى أسبوع.',
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
                      if (_rescheduleRequests.any((request) => request.isPending)) ...[
                        const SizedBox(height: 16),
                        Builder(builder: (context) {
                          final request = _rescheduleRequests.firstWhere((item) => item.isPending);
                          return Card(
                            color: Theme.of(context).colorScheme.tertiaryContainer,
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Row(children: [
                                    const Icon(Icons.event_repeat_outlined),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Text('الفني يقترح تغيير الموعد', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                                    ),
                                  ]),
                                  const SizedBox(height: 10),
                                  Text('الموعد المقترح: ${_formatRescheduleDate(request.proposedAt)}'),
                                  const SizedBox(height: 6),
                                  Text('السبب: ${request.reason}'),
                                  const SizedBox(height: 14),
                                  Row(children: [
                                    Expanded(
                                      child: FilledButton.icon(
                                        onPressed: _decidingRescheduleRequest ? null : () => _decideRescheduleRequest(request, true),
                                        icon: const Icon(Icons.check),
                                        label: const Text('موافق'),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: OutlinedButton.icon(
                                        onPressed: _decidingRescheduleRequest ? null : () => _decideRescheduleRequest(request, false),
                                        icon: const Icon(Icons.close),
                                        label: const Text('احتفظ بالموعد'),
                                      ),
                                    ),
                                  ]),
                                ],
                              ),
                            ),
                          );
                        }),
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
                        // طلب مالك صريح (docs/08 §93): العميل مش عارف إن الشات مفيد قبل الزيارة —
                        // سطر بسيط بيوضّح إنه يقدر يشرح المشكلة ويبعت صور، عشان الفني يجهّز
                        // العدة الصح ويجي جاهز بدل ما يكتشف على الطبيعة إنه ناقصه حاجة.
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(Icons.lightbulb_outline, size: 18, color: Theme.of(context).colorScheme.primary),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'اشرح مشكلتك للفني وابعتله صور قبل الزيارة — كده هيعرف يجيب العدة المناسبة معاه.',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
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
                                        Expanded(child: Text(member.fullName, overflow: TextOverflow.ellipsis)),
                                        const SizedBox(width: 6),
                                        // docs/08 §108-H — roleLabel نص حر من الأدمن (لحد 100 حرف،
                                        // apps/admin's crew_role_label input) — مش تسمية قصيرة
                                        // ثابتة. Flexible بيخليه ينكمش بـ"..." بدل ما يفيض.
                                        Flexible(
                                          child: Text(
                                            member.roleLabel,
                                            overflow: TextOverflow.ellipsis,
                                            style: Theme.of(context).textTheme.bodySmall,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ],
                      if (_media.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('صور الطلب', style: Theme.of(context).textTheme.titleMedium),
                                const SizedBox(height: 10),
                                SizedBox(
                                  height: 104,
                                  child: ListView.separated(
                                    scrollDirection: Axis.horizontal,
                                    itemCount: _media.length,
                                    separatorBuilder: (_, _) => const SizedBox(width: 8),
                                    itemBuilder: (context, index) {
                                      final item = _media[index];
                                      return SizedBox(
                                        width: 104,
                                        child: Column(
                                          children: [
                                            ClipRRect(
                                              borderRadius: BorderRadius.circular(8),
                                              child: Image.network(
                                                resolveMediaUrl(item.fileUrl),
                                                width: 104,
                                                height: 76,
                                                fit: BoxFit.cover,
                                                errorBuilder: (_, _, _) => Container(
                                                  width: 104,
                                                  height: 76,
                                                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                                                  child: const Icon(Icons.broken_image_outlined),
                                                ),
                                              ),
                                            ),
                                            const SizedBox(height: 4),
                                            Text(
                                              item.mediaType == 'before_photo'
                                                  ? 'قبل الشغل'
                                                  : item.mediaType == 'after_photo'
                                                      ? 'بعد الشغل'
                                                      : 'صورة الطلب',
                                              style: Theme.of(context).textTheme.labelSmall,
                                            ),
                                          ],
                                        ),
                                      );
                                    },
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
                      if (order.orderStatus == 'awaiting_admin_quote') ...[
                        const SizedBox(height: 16),
                        Card(
                          color: Theme.of(context).colorScheme.surfaceContainerHighest,
                          child: const ListTile(
                            leading: Icon(Icons.manage_search_outlined),
                            title: Text('الإدارة بتراجع الصور'),
                            subtitle: Text(
                              'هنبعتلك السعر هنا وفي الإشعارات. مفيش فني هيتحرك قبل موافقتك.',
                            ),
                          ),
                        ),
                      ],
                      if (order.orderStatus == 'awaiting_initial_quote_approval') ...[
                        const SizedBox(height: 16),
                        Card(
                          color: Theme.of(context).colorScheme.secondaryContainer,
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text('عرض السعر جاهز', style: Theme.of(context).textTheme.titleMedium),
                                const SizedBox(height: 6),
                                Text(
                                  _formatEgp(order.estimatedPriceCents ?? 0),
                                  style: Theme.of(context)
                                      .textTheme
                                      .headlineSmall
                                      ?.copyWith(fontWeight: FontWeight.bold),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  order.initialQuoteSource == 'admin_remote'
                                      ? 'السعر اتحدد من الصور. بعد الموافقة هنبدأ اختيار الفني.'
                                      : 'السعر اتحدد بعد المعاينة، راجعه قبل استمرار الشغل.',
                                ),
                                if (order.initialQuoteNote != null && order.initialQuoteNote!.trim().isNotEmpty) ...[
                                  const SizedBox(height: 8),
                                  Text(order.initialQuoteNote!),
                                ],
                                const SizedBox(height: 12),
                                Row(
                                  children: [
                                    Expanded(
                                      child: OutlinedButton(
                                        onPressed: _decidingQuote || _cancelling ? null : _cancel,
                                        child: const Text('رفض وإلغاء الطلب'),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: FilledButton(
                                        onPressed: _decidingQuote ? null : _approveInitialQuote,
                                        child: _decidingQuote
                                            ? const SizedBox(
                                                width: 20,
                                                height: 20,
                                                child: CircularProgressIndicator(strokeWidth: 2),
                                              )
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

/// الحالات اللي العميل فيها **مستني قرار فني** (docs/08 §77-B3).
///
/// `searching_technician` = الطلب اتبعت لفنيين ولسه محدش قبل.
/// `technician_assigned` = فني بعينه استلمه ولسه ما ردّش (شغل قريب/طوارئ، ADR-0035).
///
/// الاتنين من وجهة نظر العميل نفس الإحساس: «عملت الطلب ومحصلش حاجة» — وده بالظبط اللي
/// الكارت تحت بيعالجه.
const _kAwaitingTechnicianStatuses = {'searching_technician', 'technician_assigned'};

/// كارت الطمأنة أثناء انتظار قبول الفني (docs/08 §77-B3).
///
/// **نص المالك**: «عايز يضيف رسالة بسيطة تشرح للـcustomer إن الفني هيقبل الطلب أو مستنيين فني
/// يقبل، وفي خلال الساعات القادمة هنتواصل معاك… تبقى جملة واحدة بتقول الحاجتين مع بعض، إن
/// الطلب ممكن يكون مستعجل فبيحتاج إن الصنايعي يوافق عليه بنفسه، أو إن مفيش دلوقتي صنايعية
/// فاضية فإحنا مستنيين الإتاحة».
///
/// **السببان دول مش صياغة تسويقية — هما الحقيقة الحرفية**: ADR-0035 بيحدد إن الشغل القريب
/// والطوارئ محتاجين قبول صريح من الفني (مش تعيين تلقائي)، والحالة التانية هي عدم توفر فني
/// متاح في اليوم المطلوب. مفيش سبب تالت يخلّي طلب يستنى. فالكارت بيشرح النظام زي ما هو.
///
/// **ليه أيقونتَي التليفون والرسالة؟** طلب المالك: «تطمنه إنه ما يقلقش خالص إن خلاص طلبه بقى
/// معانا وهيتعمل». معرفة إن فيه قناتين للتواصل بتشيل قلق «هل حد أصلاً شايف طلبي؟».
class _AwaitingTechnicianCard extends StatelessWidget {
  const _AwaitingTechnicianCard();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      color: theme.colorScheme.secondaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: theme.colorScheme.onSecondaryContainer,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'طلبك معانا وبندوّرلك على فني',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: theme.colorScheme.onSecondaryContainer,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'الطلب ده محتاج الفني يوافق عليه بنفسه — يا إما لأنه قريب/مستعجل، يا إما لأن '
              'الفنيين المتاحين مشغولين دلوقتي وإحنا مستنيين أول واحد يفضى. أول ما حد يقبل '
              'هيوصلك إشعار فورًا، وفي كل الأحوال هنتواصل معاك خلال الساعات الجاية.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSecondaryContainer,
                height: 1.55,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Icon(Icons.phone_in_talk_outlined,
                    size: 18, color: theme.colorScheme.onSecondaryContainer),
                const SizedBox(width: 6),
                Icon(Icons.chat_bubble_outline_rounded,
                    size: 18, color: theme.colorScheme.onSecondaryContainer),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'هنكلّمك أو نبعتلك رسالة — مش محتاج تعمل أي حاجة دلوقتي.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSecondaryContainer,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// كارت رسالة الإدارة داخل تفاصيل الطلب (ADR-0071).
///
/// اللون **إعلامي مش تحذيري** عمدًا: دي معلومة العميل محتاج يقراها ويتصرّف عليها، مش خطأ حصل.
class _AdminNoticeCard extends StatelessWidget {
  const _AdminNoticeCard({required this.notice});

  final OrderCustomerNotice notice;

  static const _titles = {
    'info_requested': 'الإدارة طلبت تفاصيل إضافية',
    'routed_to_onsite_assessment': 'الطلب اتحوّل لمعاينة في الموقع',
  };

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.primaryContainer.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.primary.withValues(alpha: 0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                notice.noticeType == 'routed_to_onsite_assessment'
                    ? Icons.engineering_outlined
                    : Icons.info_outline,
                size: 18,
                color: scheme.primary,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  _titles[notice.noticeType] ?? 'رسالة من الإدارة',
                  style: TextStyle(fontWeight: FontWeight.w600, color: scheme.primary),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(notice.message, style: const TextStyle(height: 1.45)),
        ],
      ),
    );
  }
}
