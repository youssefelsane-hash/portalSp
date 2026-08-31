import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:safe_device/safe_device.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../chat/chat_screen.dart';
import '../media/media_repository.dart' show MediaRepository, OrderMediaItem;
import '../../core/media_url.dart';
import '../ratings/rating_dialog.dart';
import '../ratings/ratings_repository.dart';
import '../support/file_complaint_screen.dart';
import '../support/support_contact_screen.dart';
import '../tracking/tracking_client.dart';
import '../schedule/models.dart' show ScheduleSlot;
import '../schedule/schedule_repository.dart';
import 'models.dart';
import 'order.dart';
import 'orders_repository.dart';
import 'recruit_team_screen.dart';
import '../../design/order_number_title.dart';

// قبل/بعد الشغل — عتبة بسيطة على الحالة بدل قايمة صور فعلية (مفيش GET /technician/orders/:id
// لاسترجاع صور اترفعت قبل كده لو التطبيق اتقفل وفتح تاني، نفس فجوة الاستمرارية الموثّقة فوق).
const Set<String> _beforePhotoStatuses = {
  'accepted',
  'technician_on_way',
  'technician_arrived',
};
const Set<String> _afterPhotoStatuses = {'in_progress', 'work_completed'};

// نفس ACTIVE_TRACKING_STATUSES في order-tracking.gateway.ts بالظبط.
const Set<String> _activeTrackingStatuses = {
  'accepted',
  'technician_on_way',
  'technician_arrived',
  'in_progress',
};

// كانت فجوة موثّقة صراحة — راجع التعليق في _connectTrackingIfActive(). أوسع من
// _activeTrackingStatuses بحالة واحدة إضافية (awaiting_quote_approval) عشان استقبال
// order:status_changed لحظيًا حتى لو الفني مش محتاج يشارك موقعه في الحالة دي.
const Set<String> _statusListenStatuses = {
  ..._activeTrackingStatuses,
  'awaiting_quote_approval',
};

// سياسة إلغاء الفني (docs/10) — نفس TECHNICIAN_CANCELLABLE_STATUSES في orders.service.ts
// (accepted/technician_on_way/technician_arrived بس، مش in_progress). بنفحص السياسة الحقيقية
// (fetchCancellationPolicy) بس للحالات دي — توفير نداء شبكة مش لازم لباقي الحالات.
const Set<String> _cancellableOrderStatuses = {
  'accepted',
  'technician_on_way',
  'technician_arrived',
};

class OrderExecutionScreen extends StatefulWidget {
  final Order initialOrder;

  const OrderExecutionScreen({super.key, required this.initialOrder});

  @override
  State<OrderExecutionScreen> createState() => _OrderExecutionScreenState();
}

class _OrderExecutionScreenState extends State<OrderExecutionScreen> {
  late final OrdersRepository _repository;
  late final MediaRepository _mediaRepository;
  late final RatingsRepository _ratingsRepository;
  late final String _accessToken;
  final _trackingClient = TechnicianTrackingClient();
  late Order _order;
  bool _acting = false;
  bool _uploadingPhoto = false;
  bool _trackingConnected = false;
  // تقييم الفني للعميل (technician_to_customer) — كانت فجوة موثّقة صراحة، راجع
  // ../ratings/ratings_repository.dart. مفيش GET يتحقق مسبقًا لو اتقيّم قبل كده (نفس فجوة
  // customer-app بالضبط) — 409 بيتعامل معاه كنجاح ضمني (setState(_rated = true)).
  bool _rated = false;
  String? _error;
  String? _photoMessage;
  CancellationPolicy? _cancellationPolicy;
  List<OrderMediaItem>? _media;
  List<TeamMember>? _teamMembers;
  List<OrderRescheduleRequest> _rescheduleRequests = [];

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthRepository>();
    _repository = OrdersRepository(auth);
    _mediaRepository = MediaRepository(auth);
    _ratingsRepository = RatingsRepository(auth);
    _accessToken = auth.accessToken!;
    _order = widget.initialOrder;
    _connectTrackingIfActive();
    _loadCancellationPolicyIfApplicable();
    _loadMedia();
    _loadTeamMembersIfApplicable();
    _refreshTeamInfoIfApplicable();
    _loadRescheduleRequests();
  }

  // طاقم الطلب — بس لطلبات "اعتماد" (booking_mode='team'). فشل التحميل (مشكلة شبكة عابرة)
  // مايمنعش بقية الشاشة تشتغل، نفس فلسفة _loadMedia() فوق بالحرف.
  Future<void> _loadTeamMembersIfApplicable() async {
    // ADR-0052 (docs/08 §97) — الشغلانة الفردية ممكن يكون فيها مساعد اختياري مضاف، فلازم تحمّل
    // الطاقم كمان عشان القائد يشوفه ويقدر يشيله. الشرط هنا **مشتق محليًا** (`_isSoloJob`) مش من
    // `crewStatus` — وقت أول تحميل الطلب ممكن يكون جاي من فعل تنفيذي بلا crew_status لسه.
    if (_order.bookingMode != 'team' && !_isSoloJob) return;
    try {
      final members = await _repository.fetchTeamMembers(_order.id);
      if (mounted) setState(() => _teamMembers = members);
    } catch (_) {
      // تجاهل — راجع تعليق _loadMedia().
    }
  }

  // بَقّة حقيقية اتلقطت باختبار حي فعلي (تبليغ مالك 2026-08-21): `widget.initialOrder` بيجي من
  // فعل تنفيذي (accept/depart/arrive/start/complete/cancel) أو استرجاع نشط (getActive()) — كل
  // دول في الباك-إند بيرجّعوا toDto() القاعدية (technician-order-execution.controller.ts)، **مش**
  // toDtoWithTeamInfo() اللي بتحسب `crew_status`/`team_leader_name` (دي بس في getOne()/
  // listTeamAssigned()). يعني كارت تكوين الطاقم وزرار "ضم فني/مساعد" كانوا بيختفوا تمامًا لطلب
  // فريق حقيقي حتى لو الفني هو القائد فعلاً — لحد ما حدث websocket يحصّل تحديث (order:status_changed)
  // أو الفني يرجع من RecruitTeamScreen. نجيب تفاصيل الطلب الكاملة صراحة هنا (نفس _refreshFromServer،
  // بتنادي getOne()) عشان الكارت يظهر فورًا من أول فتح للشاشة، مهما كان مصدر initialOrder.
  Future<void> _refreshTeamInfoIfApplicable() async {
    // ADR-0052 — نفس البَقّة بالظبط بتنطبق على خانة المساعد الاختياري: `crew_status` بتتحسب في
    // getOne() بس، فالشغلانة الفردية محتاجة نفس النداء الصريح ده وإلا الخانة ما تظهرش من أول فتح.
    if (_order.bookingMode != 'team' && !_isSoloJob) return;
    await _refreshFromServer();
  }

  // استرجاع الصور اللي اترفعت قبل كده — راجع التعليق في media_repository.dart. فشل التحميل
  // (مشكلة شبكة عابرة) مايمنعش الشاشة تشتغل — زرار رفع الصور بيفضل شغال عادي، بس المعرض هيفضل فاضي.
  Future<void> _loadMedia() async {
    try {
      final media = await _mediaRepository.listForOrder(_order.id);
      if (mounted) setState(() => _media = media);
    } catch (_) {
      // تجاهل — راجع التعليق فوق.
    }
  }

  // "Show Cancel Order only when backend policy permits it" — استشاري بس، الفرض الحقيقي جوّه
  // الباك-إند وقت الإلغاء الفعلي (نفس مصدر الحقيقة، لو الاتنين اختلفوا الباك-إند بيكسب دايمًا).
  Future<void> _loadCancellationPolicyIfApplicable() async {
    if (!_cancellableOrderStatuses.contains(_order.orderStatus)) {
      if (mounted && _cancellationPolicy != null) {
        setState(() => _cancellationPolicy = null);
      }
      return;
    }
    try {
      final policy = await _repository.fetchCancellationPolicy(_order.id);
      if (mounted) setState(() => _cancellationPolicy = policy);
    } catch (_) {
      // فشل الفحص الاستشاري مايمنعش بقية الشاشة تشتغل — الزرار هيفضل مخفي بس، مش كسر الشاشة كلها.
    }
  }

  void _connectTrackingIfActive() {
    // بَقّة حقيقية اتلقطت: الاتصال (وبالتالي استقبال order:status_changed) كان مربوط
    // بـ_activeTrackingStatuses بس (بتاعة مشاركة الموقع)، اللي مبتشملش awaiting_quote_approval —
    // يعني لو الفني قفل التطبيق وفتحه تاني وهو بالظبط مستني رد العميل على عرض السعر، الاتصال
    // مايحصلش تلقائيًا خالص وهيحتاج يخرج ويرجع يدوي حتى لو العميل رد فورًا. _statusListenStatuses
    // بتوسّع شرط الاتصال (انضمام للـroom بس، مفيش بث موقع تلقائي — sendLocation() بتتنادى بس من
    // زرار "شارك موقعك" الصريح) من غير ما تأثر على _activeTrackingStatuses نفسها (لسه بتتحكم في
    // ظهور زرار المشاركة والملاحة، مالهاش لازمة في الحالة دي).
    if (_trackingConnected ||
        !_statusListenStatuses.contains(_order.orderStatus))
      return;
    _trackingClient.connect(
      accessToken: _accessToken,
      orderId: _order.id,
      onError: (message) {
        if (mounted) setState(() => _error = message);
      },
      onOrderStatusChanged: (previousStatus, newStatus) => _refreshFromServer(),
    );
    _trackingConnected = true;
  }

  // بتتنادى لما يوصل order:status_changed (docs/08 §15) — أهم سيناريو: العميل وافق/رفض عرض
  // السعر (awaiting_quote_approval → in_progress)، والشاشة كانت هتفضل عارضة كارت العرض المعلّق
  // القديم لحد ما الفني يخرج ويرجع يدوي. فشل التحديث (مشكلة شبكة عابرة) مش لازم يكسر الشاشة —
  // القيمة المحلية بتفضل زي ما هي، والفني لسه يقدر يعمل pull-to-refresh يدوي (لو موجود) أو
  // يخرج ويرجع، نفس السلوك القديم بالظبط.
  Future<void> _refreshFromServer() async {
    try {
      final order = await _repository.getOne(_order.id);
      if (mounted) setState(() => _order = order);
      await _loadCancellationPolicyIfApplicable();
      await _loadRescheduleRequests();
    } on ApiException {
      // تجاهل — راجع التعليق فوق.
    }
  }

  Future<void> _loadRescheduleRequests() async {
    try {
      final requests = await _repository.listRescheduleRequests(_order.id);
      if (mounted) setState(() => _rescheduleRequests = requests);
    } on ApiException {
      // سجل التأجيل ثانوي؛ فشله المؤقت لا يعطل تنفيذ الطلب.
    }
  }

  Future<void> _showRescheduleSupport() async {
    final openSupport = await showDialog<bool>(
      context: context,
      builder: (context) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('جدولة الموعد عبر الإدارة'),
          content: const Text(
            'مفيش موعد صريح متاح للاقتراح من جدولك حاليًا. تواصل مع الإدارة أو ابعت رسالة، '
            'والإدارة هتنسّق الموعد الجديد وتبلّغ العميل.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('لاحقًا'),
            ),
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
      await Navigator.of(
        context,
      ).push(MaterialPageRoute(builder: (_) => const SupportContactScreen()));
    }
  }

  Future<void> _requestReschedule() async {
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      final slots = await ScheduleRepository(
        context.read<AuthRepository>(),
      ).list();
      final available = slots.where((slot) {
        if (slot.status != 'available') return false;
        final start = DateTime.tryParse('${slot.slotDate}T${slot.startTime}');
        return start != null && start.isAfter(DateTime.now());
      }).toList();
      if (!mounted) return;
      if (available.isEmpty) {
        await _showRescheduleSupport();
        return;
      }
      final proposal = await showDialog<_RescheduleRequestDraft>(
        context: context,
        builder: (context) => _RescheduleRequestDialog(slots: available),
      );
      if (proposal == null) return;
      await _repository.requestReschedule(
        _order.id,
        newSlotId: proposal.slot.id,
        reason: proposal.reason,
      );
      await _loadRescheduleRequests();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'اتبعت اقتراح التأجيل للعميل — الموعد الحالي محفوظ لحد ما يرد',
            ),
          ),
        );
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  /// استكمال الشغل يوم تاني (ADR-0047، docs/08 §77-D1).
  ///
  /// **مش تأجيل الموعد** (`_requestReschedule` فوق): دي بتنقل زيارة لسه ما حصلتش ومحتاجة
  /// موافقة العميل. هنا الشغل بدأ فعلاً — الفني بيبلّغ إنه هيرجع، والعميل بيتخطر بالسبب
  /// والتاريخ فورًا.
  Future<void> _continueAnotherDay() async {
    final draft = await showDialog<_ContinueAnotherDayDraft>(
      context: context,
      builder: (context) => const _ContinueAnotherDayDialog(),
    );
    if (draft == null) return;
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      await _repository.continueAnotherDay(
        _order.id,
        pauseReason: draft.reason,
        nextSessionDate: draft.date,
      );
      // إعادة تحميل الطلب: `scheduled_at` اتغيّر لليوم الجديد، فالشاشة لازم تعكسه.
      final refreshed = await _repository.getOne(_order.id);
      if (mounted) {
        setState(() => _order = refreshed);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'اتسجّل إنك هتكمّل يوم ${draft.date} — العميل اتبلّغ',
            ),
          ),
        );
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  // تجنيد فريق (docs/08 §31/§35، طلب مالك صريح 2026-08-20) — بعد الرجوع من شاشة المرشّحين،
  // نحدّث الطلب (crew_status) وقايمة الفريق مع بعض عشان الكارت يعكس أي تجنيد حصل فورًا، مش
  // يفضل عارض الأرقام القديمة لحد ما الشاشة تتقفل وتترجع تتفتح.
  /// شغلانة فردية — مشتق محليًا بنفس قاعدة `isSoloJob()` في الباك-إند بالحرف. بيتستخدم **بس**
  /// لتقرير إننا نجيب التفاصيل الكاملة؛ قرار العرض نفسه بيفضل على الباك-إند (تحت).
  bool get _isSoloJob =>
      (_order.requiredTechnicians ?? 1) <= 1 &&
      (_order.requiredAssistants ?? 0) == 0;

  /// ADR-0052 — الشغلانة الفردية اللي القائد يقدر يضم فيها مساعد اختياري (أو ضم واحد بالفعل).
  /// الباك-إند هو اللي بيقرر (crew_status.optionalAssistant*) — التطبيق مابيحسبش الأهلية بنفسه.
  bool get _hasOptionalAssistantSlot {
    final crew = _order.crewStatus;
    if (crew == null) return false;
    return crew.optionalAssistantSlots > 0 || crew.optionalAssistantsAdded > 0;
  }

  /// ADR-0052 — شيل المساعد الاختياري. القائد يقدر يتراجع قبل ما الشغل يخلص، فالخانة بترجع
  /// تفتح تاني (الباك-إند بيعيد حساب crew_status من صفوف الطاقم الفعلية).
  Future<void> _removeOptionalAssistant(String memberId) async {
    if (mounted) setState(() => _error = null);
    try {
      await _repository.removeTeamMember(_order.id, memberId);
      await _refreshFromServer();
      await _loadTeamMembersIfApplicable();
    } catch (e) {
      if (mounted) setState(() => _error = 'مقدرناش نشيل المساعد: $e');
    }
  }

  Future<void> _openRecruitTeam(String role) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => RecruitTeamScreen(orderId: _order.id, role: role),
      ),
    );
    await _refreshFromServer();
    await _loadTeamMembersIfApplicable();
  }

  // بَقّة حقيقية اتلقطت: الفني كان بيكتب lat/lng يدوي بنفسه بدل ما نستخدم موقعه الفعلي —
  // بيفتح باب لموقع غلط (قصدًا أو غلطة كتابة) يوصل للعميل والـtracking. دلوقتي بنستخدم
  // geolocator (اتضاف كـdependency جديدة) نقرأ موقع الجهاز الحقيقي مباشرة.
  Future<void> _shareLocation() async {
    if (mounted) setState(() => _error = null);
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        if (mounted)
          setState(
            () => _error =
                'خدمة تحديد الموقع مقفولة على جهازك، شغّلها الأول وحاول تاني',
          );
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        if (mounted) {
          setState(
            () => _error =
                'محتاجين إذن الوصول لموقعك عشان نشاركه مع العميل — فعّله من إعدادات الجهاز',
          );
        }
        return;
      }
      // منع mock location (§7.3) — كانت فجوة موثّقة صراحة، اتقفلت مع ربط geolocator: دلوقتي
      // الموقع بجيه من GPS حقيقي فعلاً، فالفحص بقى له معنى (قبل كده كان بيتفحص إحداثيات مكتوبة
      // يدوي أصلاً). فشل الفحص نفسه (خطأ منصة) مش نفس اكتشاف تزوير فعلي — بنكمل الإرسال عادي.
      try {
        if (await SafeDevice.isMockLocation) {
          if (mounted) {
            setState(
              () => _error =
                  'موقعك الحالي شكله متزوّر (mock location) — قفّل تطبيقات تزوير الـGPS وحاول تاني',
            );
          }
          return;
        }
      } catch (_) {
        // تجاهل — راجع التعليق فوق.
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
      );
      _trackingClient.sendLocation(
        latitude: position.latitude,
        longitude: position.longitude,
      );
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('اتبعت موقعك للعميل')));
      }
    } catch (_) {
      if (mounted)
        setState(() => _error = 'مقدرناش نحدد موقعك الحالي، حاول تاني');
    }
  }

  // كانت فجوة موثّقة صراحة ("ملاحة فعلية — لسه لأ"): بدل ما نبني خريطة توجيه كاملة جوّه
  // التطبيق (تعقيد وتكلفة صيانة كبيرين لميزة تطبيقات الخرائط بتعملها أحسن بكتير)، بنفتح تطبيق
  // خرائط حقيقي (Google Maps مثبّت، وإلا المتصفح) بمسار اتجاهات جاهز لعنوان الطلب مباشرة —
  // نمط شائع ومعتمد في تطبيقات التوصيل المشابهة. رابط Google Maps العام (`/maps/dir/?api=1`)
  // بيشتغل عبر المنصات كلها من غير أي مفتاح API أو إعداد إضافي.
  Future<void> _openNavigation() async {
    final address = _order.address;
    if (address == null) return;
    final uri = Uri.parse(
      'https://www.google.com/maps/dir/?api=1&destination=${address.latitude},${address.longitude}',
    );
    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!launched && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('مقدرناش نفتح تطبيق الخرائط')),
      );
    }
  }

  @override
  void dispose() {
    _trackingClient.dispose();
    super.dispose();
  }

  Future<void> _uploadPhoto(String mediaType, String labelAr) async {
    final picker = ImagePicker();
    final XFile? picked = await picker.pickImage(
      source: ImageSource.camera,
      imageQuality: 85,
    );
    if (picked == null) return;

    setState(() {
      _uploadingPhoto = true;
      _error = null;
      _photoMessage = null;
    });
    try {
      final bytes = await picked.readAsBytes();
      await _mediaRepository.upload(
        orderId: _order.id,
        fileBytes: bytes,
        filename: picked.name,
        mediaType: mediaType,
      );
      if (mounted) setState(() => _photoMessage = 'صورة $labelAr اترفعت ✅');
      await _loadMedia();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _uploadingPhoto = false);
    }
  }

  // كانت فجوة موثّقة صراحة (S7): مفيش UI لمسار عرض السعر أثناء التنفيذ — الباك-إند
  // (order-items.service.ts) والـ endpoint جاهزين ومختبرين حي، هنا أول استهلاك فعلي من التطبيق.
  Future<void> _proposeQuoteItems() async {
    final drafts = await showDialog<List<_QuoteItemDraft>>(
      context: context,
      builder: (context) => const _ProposeQuoteDialog(),
    );
    if (drafts == null || drafts.isEmpty) return;

    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      final items = drafts
          .map(
            (d) => {
              'item_type': d.itemType,
              'name_ar': d.nameAr,
              'quantity': d.quantity,
              'unit_price_cents': d.unitPriceCents,
            },
          )
          .toList();
      _order = await _repository.proposeQuoteItems(_order.id, items);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('اتبعت عرض السعر للعميل — مستني رده')),
        );
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  // سياسة إلغاء الفني (docs/10) — مفيش إلغاء بضغطة واحدة: (1) اختيار سبب من قايمة حقيقية +
  // نص حر لو محتاج، (2) شاشة تأكيد أخيرة صريحة جوّه نفس الـdialog. بعد النجاح الطلب مبقاش بتاع
  // الفني ده خالص (technician_id بقى null)، فبنقفل الشاشة ونرجّع لقايمة الطلبات المتاحة.
  Future<void> _cancelOrder() async {
    final reasons = await _repository.fetchCancellationReasons();
    if (!mounted) return;
    final result = await showDialog<_CancelOrderResult>(
      context: context,
      builder: (context) => _CancelOrderDialog(reasons: reasons),
    );
    if (result == null) return;

    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      await _repository.cancel(
        _order.id,
        cancellationReasonId: result.reasonId,
        reason: result.freeText,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('اتلغى الطلب — مبقاش بتاعك دلوقتي')),
        );
        Navigator.of(context).pop();
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  // زيارة فاشلة/عدم حضور (docs/08 §22 بند 3+6) — بديل صريح لـ"اتفاق" الفني قدام الطلب: بدل ما
  // يكمّل شغل مش مصرّح أو يقفل الطلب "مكتمل" كاذبة، بيوقف ويوديه لمراجعة أدمن حقيقية.
  Future<void> _reportFailedVisit() async {
    final result = await showDialog<_FailedVisitResult>(
      context: context,
      builder: (context) => const _ReportFailedVisitDialog(),
    );
    if (result == null) return;

    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      _order = await _repository.reportFailedVisit(
        _order.id,
        reason: result.reason,
        description: result.description,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('اتبعت البلاغ — الإدارة هتراجع وترجعلك'),
          ),
        );
        setState(() {});
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  // تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14) — بلاغ نزاع، مش قرار نهائي (بيودّي الطلب
  // disputed لمراجعة أدمن حقيقية زي reportFailedVisit فوق بالحرف). Dialog من خطوتين (وصف + تأكيد
  // صريح) عشان يمنع ضغطة غلط تعلّق الطلب من غير داعي.
  Future<void> _reportCashNotReceived() async {
    final description = await showDialog<String>(
      context: context,
      builder: (context) => const _CashNotReceivedDialog(),
    );
    if (description == null) return;

    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      _order = await _repository.reportCashNotReceived(
        _order.id,
        description: description,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('اتبعت البلاغ — الإدارة هتراجع وترجعلك'),
          ),
        );
        setState(() {});
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _runAction(String action) async {
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      switch (action) {
        case 'depart':
          _order = await _repository.depart(_order.id);
        case 'arrive':
          _order = await _repository.arrive(_order.id);
        case 'start':
          _order = await _repository.start(_order.id);
        case 'complete':
          _order = await _repository.complete(_order.id);
        case 'collect_cash':
          await _repository.collectCash(_order.id);
          // التحصيل غيّر الدفع والحالة وسياسة الإلغاء في نفس اللحظة. نعيد القراءة من المصدر بدل
          // تركيب Order ناقص محليًا، حتى تظل حقيقة الدفع المختلط محفوظة ويختفي الإلغاء فورًا.
          await _refreshFromServer();
      }
      if (mounted) setState(() {});
      // docs/08 §70 (بلاغ مالك: كارت "الطاقم ناقص" بيختفي بعد ما تشتغل على الطلب) — ردود الأفعال
      // التنفيذية بتحطّ نسخة جديدة من الطلب مكان القديمة، وحالة collect_cash بتتبني محليًا أصلاً،
      // فأي حقل مش موجود في الرد (زي crew_status) كان بيضيع. تحديث واحد من السيرفر بعد أي فعل على
      // طلب فريق بيخلّي الكارت وقايمة الطاقم يعكسوا الحقيقة دايمًا، مهما كان شكل رد الفعل.
      if (_order.bookingMode == 'team') {
        await _refreshFromServer();
        await _loadTeamMembersIfApplicable();
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _rateCustomer() async {
    final result = await showTechnicianRatingDialog(context);
    if (result == null) return;
    try {
      await _ratingsRepository.rate(
        _order.id,
        overallRating: result.overallRating,
        punctualityRating: result.punctualityRating,
        professionalismRating: result.professionalismRating,
        comment: result.comment,
      );
      if (mounted) {
        setState(() => _rated = true);
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('شكراً على تقييمك 🙏')));
      }
    } on ApiException catch (err) {
      // 409 لو العميل قيّم الأول — نفس تعامل customer-app بالحرف (اعتبرها "اتقيّم" مش خطأ).
      if (mounted) {
        if (err.statusCode == 409) {
          setState(() => _rated = true);
        }
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(err.message)));
      }
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  String _formatRescheduleRequestDate(DateTime value) {
    final local = value.toLocal();
    return '${local.day}/${local.month}/${local.year} — ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final configuredNextAction = nextTechnicianAction[_order.orderStatus];
    final nextAction =
        configuredNextAction == 'collect_cash' && _order.cashToCollectCents <= 0
        ? null
        : configuredNextAction;
    final isDone = _order.orderStatus == 'completed';

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: OrderNumberTitle(orderNumber: _order.orderNumber),
          actions: [
            // إتاحة الدعم أثناء طلب نشط بشكل واضح (docs/08 §22 بند 18) — مش مدفون في قوائم فرعية.
            IconButton(
              icon: const Icon(Icons.support_agent_outlined),
              tooltip: 'اتصل بالدعم',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const SupportContactScreen()),
              ),
            ),
            // §24 — كانت فجوة موثّقة: صفر طريقة يقدّم بيها الفني شكوى عن طلب معيّن من جوّه
            // التطبيق، رغم إن الباك-إند بيدعم كده من زمان. متاح على أي حالة، مطابق لنفس الزرار
            // في apps/customer-app's order_detail_screen.dart.
            IconButton(
              icon: const Icon(Icons.report_problem_outlined),
              tooltip: 'قدّم شكوى عن الطلب ده',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => FileComplaintScreen(orderId: _order.id),
                ),
              ),
            ),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.all(16),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          children: [
            _OrderProgressCard(status: _order.orderStatus),
            const SizedBox(height: 12),
            // "الشغلانة دي إيه ولمين؟" (docs/08 §56 بند 3) — أول حاجة الفني يشوفها، فوق أي حاجة
            // مالية أو أزرار تنفيذ. قبل كده الشاشة كانت بتبدأ بالمبلغ والأزرار على طول.
            _JobBriefCard(order: _order),
            const SizedBox(height: 12),
            _MoneySummaryCard(order: _order, formatEgp: _formatEgp),
            // ADR-0052 (docs/08 §97، طلب مالك) — «لو الشغلانة عدد أفرادها واحد… أحيانًا الصنايعي
            // بيحب ياخد معاه مساعد… لو هو مش عايز يضيف مساعد خلاص مش مهم». كارت **هادي** عمدًا
            // (surfaceContainerHighest مش errorContainer) — ده اختيار مش نقص، فمينفعش يبان
            // كإنذار زي كارت "الطاقم مش مكتمل".
            if (_order.bookingMode != 'team' && _hasOptionalAssistantSlot) ...[
              const SizedBox(height: 12),
              _OptionalAssistantCard(
                crewStatus: _order.crewStatus!,
                members: _teamMembers,
                onAddAssistant: () => _openRecruitTeam('assistant'),
                onRemove: _removeOptionalAssistant,
              ),
            ],
            if (_order.bookingMode == 'team') ...[
              const SizedBox(height: 12),
              _TeamRosterCard(
                members: _teamMembers,
                requiredTechnicians: _order.requiredTechnicians,
              ),
              // تكوين الطاقم (docs/08 §35، ADR-0021 §1) — بتبان بس للقائد نفسه (crew_status
              // محسوبة بس لو orders.technicianId=viewerProfileId، راجع toDtoWithTeamInfo في
              // الباك-إند). فني/مساعد منفصلين، بدل بند "ناقص" واحد كان بيتجاهل المساعدين.
              if (_order.crewStatus != null &&
                  !_order.crewStatus!.crewComplete) ...[
                const SizedBox(height: 8),
                _CrewStatusCard(
                  crewStatus: _order.crewStatus!,
                  onRecruitTechnician: () => _openRecruitTeam('technician'),
                  onRecruitAssistant: () => _openRecruitTeam('assistant'),
                ),
              ],
              // عضو فريق (مش القائد) بيشوف مين ضافه.
              if (_order.teamLeaderName != null) ...[
                const SizedBox(height: 8),
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.supervisor_account_outlined),
                    title: Text('قائد الفريق: ${_order.teamLeaderName}'),
                  ),
                ),
              ],
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => ChatScreen(orderId: _order.id),
                ),
              ),
              icon: const Icon(Icons.chat_bubble_outline),
              label: const Text('الشات مع العميل'),
            ),
            if (_rescheduleRequests.any((request) => request.isPending)) ...[
              const SizedBox(height: 12),
              Card(
                color: Theme.of(context).colorScheme.tertiaryContainer,
                child: ListTile(
                  leading: const Icon(Icons.hourglass_top_outlined),
                  title: const Text('طلب التأجيل منتظر رد العميل'),
                  subtitle: Text(
                    'الموعد المقترح: ${_formatRescheduleRequestDate(_rescheduleRequests.firstWhere((request) => request.isPending).proposedAt)}\n'
                    '${_rescheduleRequests.firstWhere((request) => request.isPending).reason}',
                  ),
                  isThreeLine: true,
                ),
              ),
            ] else if (_order.orderStatus == 'technician_assigned' ||
                _order.orderStatus == 'accepted') ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _acting ? null : _requestReschedule,
                icon: const Icon(Icons.event_repeat_outlined),
                label: const Text('اطلب تغيير الموعد من العميل'),
              ),
              const SizedBox(height: 6),
              Text(
                'الموعد لا يتغيّر إلا بعد موافقة العميل. لو لم يظهر موعد مناسب، تواصل مع الإدارة.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            if (_photoMessage != null) ...[
              const SizedBox(height: 12),
              Text(_photoMessage!, style: const TextStyle(color: Colors.green)),
            ],
            if (_activeTrackingStatuses.contains(_order.orderStatus)) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _shareLocation,
                icon: const Icon(Icons.share_location_outlined),
                label: const Text('شارك موقعك مع العميل'),
              ),
              if (_order.address != null) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _openNavigation,
                  icon: const Icon(Icons.navigation_outlined),
                  label: const Text('افتح الملاحة للعنوان'),
                ),
              ],
            ],
            if (_beforePhotoStatuses.contains(_order.orderStatus) ||
                _afterPhotoStatuses.contains(_order.orderStatus)) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _uploadingPhoto
                    ? null
                    : () => _uploadPhoto(
                        _beforePhotoStatuses.contains(_order.orderStatus)
                            ? 'before_photo'
                            : 'after_photo',
                        _beforePhotoStatuses.contains(_order.orderStatus)
                            ? 'قبل الشغل'
                            : 'بعد الشغل',
                      ),
                icon: const Icon(Icons.camera_alt_outlined),
                label: _uploadingPhoto
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        _beforePhotoStatuses.contains(_order.orderStatus)
                            ? 'صوّر قبل الشغل'
                            : 'صوّر بعد الشغل',
                      ),
              ),
            ],
            if ((_media ?? []).any(
              (m) =>
                  m.mediaType == 'before_photo' || m.mediaType == 'after_photo',
            )) ...[
              const SizedBox(height: 12),
              _PhotoGallery(
                media: _media!
                    .where((m) => m.mediaType == 'before_photo')
                    .toList(),
                titleAr: 'صور قبل الشغل',
              ),
              _PhotoGallery(
                media: _media!
                    .where((m) => m.mediaType == 'after_photo')
                    .toList(),
                titleAr: 'صور بعد الشغل',
              ),
            ],
            if (_order.orderStatus == 'in_progress') ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _acting ? null : _proposeQuoteItems,
                icon: const Icon(Icons.receipt_long_outlined),
                label: const Text('اقترح عرض سعر (قطع غيار/أجرة إضافية)'),
              ),
              // استكمال الشغل يوم تاني (ADR-0047) — متاح بس والشغل شغّال فعلاً، وده بالظبط
              // الموقف اللي المالك وصفه: الفني اكتشف وسط الشغل إنه محتاج قطعة غيار نادرة.
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _acting ? null : _continueAnotherDay,
                icon: const Icon(Icons.event_repeat_outlined),
                label: const Text('هكمّل الشغل يوم تاني'),
              ),
            ],
            // سياسة إلغاء الفني (docs/10) — الزرار يظهر بس لو can_cancel:true فعلاً من الباك-إند
            // (مش مجرد "الحالة مسموحة" — النافذة الزمنية وصلاحيات الفريق ممكن يمنعوه كمان).
            if (_cancellableOrderStatuses.contains(_order.orderStatus) &&
                _cancellationPolicy?.canCancel == true) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _acting ? null : _cancelOrder,
                icon: const Icon(Icons.cancel_outlined, color: Colors.red),
                label: const Text(
                  'إلغاء الطلب',
                  style: TextStyle(color: Colors.red),
                ),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: Colors.red),
                ),
              ),
            ] else if (_cancellationPolicy != null &&
                _cancellationPolicy!.reasonIfNot != null) ...[
              const SizedBox(height: 12),
              Text(
                _cancellationPolicy!.reasonIfNot!,
                style: const TextStyle(color: Colors.grey, fontSize: 12),
              ),
            ],
            // زيارة فاشلة (docs/08 §22 بند 3+6) — العميل مش موجود، أو رفض شغل ضروري لإتمام الطلب
            // صح. متاح بس وقت الوجود الفعلي على العنوان أو أثناء الشغل، مش في أي حالة تانية.
            if (_order.orderStatus == 'technician_arrived' ||
                _order.orderStatus == 'in_progress') ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _acting ? null : _reportFailedVisit,
                icon: const Icon(
                  Icons.report_problem_outlined,
                  color: Colors.orange,
                ),
                label: const Text(
                  'زيارة فاشلة (العميل مش موجود / رفض شغل ضروري)',
                  style: TextStyle(color: Colors.orange),
                ),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: Colors.orange),
                ),
              ),
            ],
            // إثبات إنجاز الشغل (docs/08 §20 بند 12، قرار مالك صريح) — الباك-إند بيرفض إنهاء
            // الشغل من غير صورة after_photo واحدة على الأقل (order_execution_screen مش بيقدر يلفها).
            // التلميح هنا استباقي بس — نفس فحص الباك-إند بالظبط (>=1 after_photo)، عشان الفني
            // يعرف قبل ما يضغط الزرار ويتفاجئ برسالة خطأ.
            if (nextAction == 'complete' &&
                !(_media ?? []).any((m) => m.mediaType == 'after_photo')) ...[
              const SizedBox(height: 12),
              const Text(
                'لازم تصوّر صورة واحدة على الأقل بعد الشغل قبل ما تقدر تقفل الطلب',
                style: TextStyle(color: Colors.orange),
              ),
            ],
            // تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14) — لو المفروض العميل يدفع كاش
            // ("محتاج تحصيل") ومستلمتش الفلوس فعلاً، بلّغ بدل ما تقفل الطلب "حصّلت الكاش" كذب.
            if ((_order.orderStatus == 'work_completed' ||
                    _order.orderStatus == 'awaiting_payment') &&
                _order.cashToCollectCents > 0) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _acting ? null : _reportCashNotReceived,
                icon: const Icon(Icons.money_off_outlined, color: Colors.red),
                label: const Text(
                  'لم أستلم الكاش',
                  style: TextStyle(color: Colors.red),
                ),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: Colors.red),
                ),
              ),
            ],
            const SizedBox(height: 24),
            if (isDone) ...[
              const Center(child: Text('الطلب اتقفل — شكراً على شغلك 👍')),
              const SizedBox(height: 12),
              if (_rated)
                const Center(child: Text('اتقيّم العميل، شكراً 🙏'))
              else
                Center(
                  child: OutlinedButton.icon(
                    onPressed: _rateCustomer,
                    icon: const Icon(Icons.star_outline),
                    label: const Text('قيّم العميل'),
                  ),
                ),
            ] else if (configuredNextAction == 'collect_cash' &&
                _order.cashToCollectCents <= 0) ...[
              const Center(
                child: Text(
                  'لا تحصّل أي كاش من العميل — المبلغ مغطى بالفعل، وجارٍ إقفال التسوية تلقائيًا.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.green,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ] else if (nextAction != null)
              FilledButton(
                onPressed: _acting ? null : () => _runAction(nextAction),
                child: _acting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(technicianActionLabelsAr[nextAction] ?? nextAction),
              ),
          ],
        ),
      ),
    );
  }
}

class _RescheduleRequestDraft {
  final ScheduleSlot slot;
  final String reason;

  const _RescheduleRequestDraft({required this.slot, required this.reason});
}

class _RescheduleRequestDialog extends StatefulWidget {
  final List<ScheduleSlot> slots;

  const _RescheduleRequestDialog({required this.slots});

  @override
  State<_RescheduleRequestDialog> createState() =>
      _RescheduleRequestDialogState();
}

class _RescheduleRequestDialogState extends State<_RescheduleRequestDialog> {
  final _formKey = GlobalKey<FormState>();
  final _reasonController = TextEditingController();
  ScheduleSlot? _slot;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: AlertDialog(
        title: const Text('اقترح موعدًا بديلًا'),
        content: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('الموعد الحالي لن يتغيّر إلا بعد موافقة العميل.'),
              const SizedBox(height: 16),
              DropdownButtonFormField<ScheduleSlot>(
                initialValue: _slot,
                decoration: const InputDecoration(labelText: 'الموعد المقترح'),
                items: widget.slots
                    .map(
                      (slot) => DropdownMenuItem(
                        value: slot,
                        child: Text(
                          '${slot.slotDate} — ${slot.startTime.substring(0, 5)}',
                        ),
                      ),
                    )
                    .toList(),
                onChanged: (value) => setState(() => _slot = value),
                validator: (value) => value == null ? 'اختار موعدًا' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _reasonController,
                minLines: 2,
                maxLines: 4,
                maxLength: 500,
                decoration: const InputDecoration(
                  labelText: 'سبب التأجيل للعميل',
                  hintText: 'اكتب سببًا واضحًا ومحترمًا',
                ),
                validator: (value) => (value?.trim().length ?? 0) < 5
                    ? 'السبب لازم يكون 5 حروف على الأقل'
                    : null,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () {
              // راجع docs/08 §108-C — شيل الفوكس من حقل السبب قبل الإقفال عشان
              // نتجنب Flutter assertion '_dependents.isEmpty' (شاشة حمرا).
              FocusScope.of(context).unfocus();
              Navigator.of(context).pop();
            },
            child: const Text('تراجع'),
          ),
          FilledButton(
            onPressed: () {
              if (!_formKey.currentState!.validate()) return;
              FocusScope.of(context).unfocus();
              Navigator.of(context).pop(
                _RescheduleRequestDraft(
                  slot: _slot!,
                  reason: _reasonController.text.trim(),
                ),
              );
            },
            child: const Text('إرسال للعميل'),
          ),
        ],
      ),
    );
  }
}

class _OrderProgressCard extends StatelessWidget {
  const _OrderProgressCard({required this.status});

  final String status;

  int get _step => switch (status) {
    'technician_assigned' || 'accepted' => 0,
    'technician_on_way' => 1,
    'technician_arrived' => 2,
    'in_progress' || 'awaiting_quote_approval' => 3,
    'work_completed' || 'awaiting_payment' => 4,
    'completed' => 5,
    _ => 0,
  };

  IconData get _icon => switch (_step) {
    0 => Icons.assignment_turned_in_outlined,
    1 => Icons.directions_car_filled_outlined,
    2 => Icons.location_on_outlined,
    3 => Icons.handyman_outlined,
    4 => Icons.payments_outlined,
    _ => Icons.task_alt,
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final label = technicianOrderStatusLabelsAr[status] ?? status;
    return Card(
      color: scheme.primaryContainer.withValues(alpha: 0.52),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: scheme.primary,
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Icon(_icon, color: scheme.onPrimary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'الخطوة الحالية',
                        style: theme.textTheme.labelMedium,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        label,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  '${_step + 1}/6',
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: scheme.primary,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            ClipRRect(
              borderRadius: BorderRadius.circular(99),
              child: LinearProgressIndicator(
                minHeight: 7,
                value: (_step + 1) / 6,
                backgroundColor: scheme.surface.withValues(alpha: 0.8),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MoneySummaryCard extends StatelessWidget {
  const _MoneySummaryCard({required this.order, required this.formatEgp});

  final Order order;
  final String Function(int cents) formatEgp;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final cashColor = order.cashToCollectCents > 0
        ? Colors.orange.shade800
        : Colors.green.shade700;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  Icons.account_balance_wallet_outlined,
                  color: scheme.primary,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'فلوس الطلب',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                if (order.hasOnlinePayment)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 9,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.green.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(99),
                    ),
                    child: Text(
                      order.fullyPaidOnline ? 'مدفوع أونلاين' : 'جزء أونلاين',
                      style: TextStyle(
                        color: Colors.green.shade800,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
              ],
            ),
            if (order.totalAmountCents != null) ...[
              const SizedBox(height: 12),
              _MoneyLine(
                icon: Icons.receipt_long_outlined,
                label: 'إجمالي الطلب',
                value: formatEgp(order.totalAmountCents!),
              ),
            ],
            const SizedBox(height: 12),
            _MoneyLine(
              icon: order.cashToCollectCents > 0
                  ? Icons.payments_outlined
                  : Icons.check_circle_outline,
              label: 'التحصيل من العميل',
              value: technicianCashStatusLabel(
                cashToCollectCents: order.cashToCollectCents,
                cashCollectedCents: order.cashCollectedCents,
                hasOnlinePayment: order.hasOnlinePayment,
                fullyPaidOnline: order.fullyPaidOnline,
                isCrewShare: order.isCrewShare,
                formatEgp: formatEgp,
              ),
              color: cashColor,
            ),
            const Divider(height: 24),
            _MoneyLine(
              icon: Icons.savings_outlined,
              label: 'مستحقك أنت',
              value: technicianEarningLabel(
                myEarningCents: order.myEarningCents,
                earningPending: order.earningPending,
                isCrewShare: order.isCrewShare,
                formatEgp: formatEgp,
              ),
              color: scheme.primary,
              emphasized: true,
            ),
          ],
        ),
      ),
    );
  }
}

class _MoneyLine extends StatelessWidget {
  const _MoneyLine({
    required this.icon,
    required this.label,
    required this.value,
    this.color,
    this.emphasized = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color? color;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          icon,
          size: 20,
          color: color ?? theme.colorScheme.onSurfaceVariant,
        ),
        const SizedBox(width: 9),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: theme.textTheme.labelMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                style: theme.textTheme.titleSmall?.copyWith(
                  color: color,
                  fontWeight: emphasized ? FontWeight.w900 : FontWeight.w700,
                  height: 1.35,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// طاقم الطلب (docs/08 §5) — راجع تعليق TeamMember في models.dart. `null` لسه بيحمّل، قايمة فاضية
// معناها "محدّش اتضاف لسه" (مختلف عن null، مش خطأ تحميل — الكارت بيوضّح الاتنين بنص مختلف).
/// "الشغلانة دي إيه ولمين؟" (docs/08 §56 بند 3) — بلاغ مالك مباشر بسكرين شوت: شاشة الطلب عند
/// الفني كانت بتعرض الحالة والمبلغ وأزرار التنفيذ بس، من غير اسم العميل ولا تليفونه ولا اسم
/// الخدمة ولا وصف الشغل. الكارت ده بيتعرض فوق كل حاجة تانية في الشاشة.
class _JobBriefCard extends StatelessWidget {
  const _JobBriefCard({required this.order});

  final Order order;

  /// الجدولة باليوم مش بالساعة (ADR-0018 §2) — `scheduled_at` لخدمة عادية = بداية اليوم بالظبط،
  /// فعرض "12:00 ص" هيبقى كذب مش معلومة. الوقت بيتعرض بس لو الخدمة فعلاً طلبت وقت محدد
  /// (أوضاع ADR-0032)، واللي بيميّزها إن الوقت مش منتصف الليل.
  static String _formatSchedule(String? iso) {
    if (iso == null) return 'في أقرب وقت (فوري)';
    final at = DateTime.tryParse(iso)?.toLocal();
    if (at == null) return 'في أقرب وقت (فوري)';
    final day =
        '${at.year}/${at.month.toString().padLeft(2, '0')}/${at.day.toString().padLeft(2, '0')}';
    if (at.hour == 0 && at.minute == 0)
      return '$day (اليوم كله — مفيش ساعة محددة)';
    return '$day الساعة ${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              order.serviceNameAr ?? 'طلب خدمة',
              style: theme.textTheme.titleLarge,
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                const Icon(Icons.event_outlined, size: 16),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _formatSchedule(order.scheduledAt),
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              ],
            ),
            if (order.problemDescription != null &&
                order.problemDescription!.trim().isNotEmpty) ...[
              const SizedBox(height: 10),
              Text('المطلوب', style: theme.textTheme.labelLarge),
              const SizedBox(height: 2),
              Text(order.problemDescription!),
            ],
            // docs/08 §71 — اللي العميل اختاره وقت الحجز (مساحة/دور/نوع…) في سطر واحد، عشان
            // الفني يعرف حجم الشغل قبل ما يتحرك بدل ما يسأل العميل على التليفون.
            if (order.customerInputsLine.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text('اختيارات العميل', style: theme.textTheme.labelLarge),
              const SizedBox(height: 2),
              Text(order.customerInputsLine, style: theme.textTheme.bodyMedium),
            ],
            // بيانات التواصل بترجع من الباك-إند بس بعد تأكيد الحجز — قبل كده بتبقى null والقسم
            // ده بيختفي بالكامل بدل ما يعرض سطر فاضي.
            if (order.customerName != null) ...[
              const Divider(height: 24),
              Row(
                children: [
                  const Icon(Icons.person_outline, size: 18),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      order.customerName!,
                      style: theme.textTheme.titleSmall,
                    ),
                  ),
                ],
              ),
              if (order.customerPhone != null) ...[
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(Icons.phone_outlined, size: 18),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        order.customerPhone!,
                        style: theme.textTheme.bodyMedium,
                      ),
                    ),
                    TextButton.icon(
                      onPressed: () => launchUrl(
                        Uri(scheme: 'tel', path: order.customerPhone!),
                      ),
                      icon: const Icon(Icons.call, size: 18),
                      label: const Text('اتصل'),
                    ),
                  ],
                ),
              ],
            ],
            if (order.address != null) ...[
              const SizedBox(height: 6),
              Row(
                children: [
                  const Icon(Icons.location_on_outlined, size: 18),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      order.address!.landmark == null
                          ? order.address!.streetName
                          : '${order.address!.streetName} — ${order.address!.landmark}',
                      style: theme.textTheme.bodyMedium,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _TeamRosterCard extends StatelessWidget {
  final List<TeamMember>? members;
  final int? requiredTechnicians;

  const _TeamRosterCard({
    required this.members,
    required this.requiredTechnicians,
  });

  @override
  Widget build(BuildContext context) {
    final loaded = members;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.groups_outlined, size: 20),
                const SizedBox(width: 8),
                Text(
                  'طاقم الطلب',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                if (requiredTechnicians != null) ...[
                  const SizedBox(width: 4),
                  Text(
                    '(مطلوب $requiredTechnicians)',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ],
            ),
            const SizedBox(height: 8),
            if (loaded == null)
              const Text('بيحمّل...')
            else if (loaded.isEmpty)
              const Text('لسه محدّش اتضاف لطاقم الطلب')
            else
              ...loaded.map(
                (m) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    children: [
                      const Icon(Icons.person_outline, size: 16),
                      const SizedBox(width: 6),
                      Expanded(child: Text('${m.fullName} — ${m.roleLabel}')),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ADR-0052 (docs/08 §97، طلب مالك) — المساعد الاختياري للشغلانة الفردية.
//
// **مقصود إنه مش شبه `_CrewStatusCard` تحت**: ده كارت هادي (لون سطح عادي، نبرة "لو حابب")،
// والتاني إنذار أحمر لنقص إجباري لازم يتسد. خلطهم كان هيحوّل اختيار لضغط على الفني — بالظبط
// اللي المالك قال إنه مش عايزه («ده بيبقى إجباري… يكون عنده بس أوبشن اختياري»).
class _OptionalAssistantCard extends StatelessWidget {
  const _OptionalAssistantCard({
    required this.crewStatus,
    required this.members,
    required this.onAddAssistant,
    required this.onRemove,
  });

  final CrewStatus crewStatus;
  final List<TeamMember>? members;
  final VoidCallback onAddAssistant;
  final Future<void> Function(String memberId) onRemove;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final assistants = (members ?? const <TeamMember>[])
        .where((m) => m.memberType == 'assistant')
        .toList();
    return Card(
      color: theme.colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.handyman_outlined,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 8),
                Text(
                  'مساعد (اختياري)',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            if (assistants.isEmpty)
              Text(
                'الشغلانة دي تقدر تخلّصها لوحدك عادي. لو حابب حد يساعدك فيها، تقدر تضم مساعد '
                'وهياخد نسبته من قيمة الشغلانة.',
                style: theme.textTheme.bodySmall,
              )
            else
              ...assistants.map(
                (m) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: CircleAvatar(
                    backgroundImage: m.avatarUrl != null
                        ? NetworkImage(m.avatarUrl!)
                        : null,
                    child: m.avatarUrl == null
                        ? const Icon(Icons.person_outline)
                        : null,
                  ),
                  title: Text(m.fullName),
                  subtitle: Text(m.roleLabel),
                  trailing: IconButton(
                    tooltip: 'شيل المساعد',
                    icon: const Icon(Icons.person_remove_outlined),
                    onPressed: () => onRemove(m.id),
                  ),
                ),
              ),
            if (crewStatus.optionalAssistantSlots > 0) ...[
              const SizedBox(height: 4),
              TextButton.icon(
                onPressed: onAddAssistant,
                icon: const Icon(Icons.person_add_alt_outlined),
                label: const Text('ضم مساعد'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// تكوين الطاقم (docs/08 §35، ADR-0021 §1) — بارز فوق زي ما المالك طلب بالحرف، فني/مساعد منفصلين
// (بدل بند "ناقص" واحد كان بيتجاهل المساعدين تمامًا). زرار "دعوة/ضم" مستقل لكل دور ناقص فعليًا.
// القائد بس هو اللي يشوف الكارت ده (crew_status محسوبة بس ليه، راجع toDtoWithTeamInfo في الباك-إند).
class _CrewStatusCard extends StatelessWidget {
  const _CrewStatusCard({
    required this.crewStatus,
    required this.onRecruitTechnician,
    required this.onRecruitAssistant,
  });

  final CrewStatus crewStatus;
  final VoidCallback onRecruitTechnician;
  final VoidCallback onRecruitAssistant;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Card(
      color: colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.group_add_outlined,
                  color: colorScheme.onErrorContainer,
                ),
                const SizedBox(width: 8),
                Text(
                  'الطاقم مش مكتمل',
                  style: TextStyle(
                    color: colorScheme.onErrorContainer,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'مطلوب ${crewStatus.requiredTechnicians} فني + ${crewStatus.requiredAssistants} مساعد — '
              'حالي ${crewStatus.assignedTechnicians} فني + ${crewStatus.assignedAssistants} مساعد',
              style: TextStyle(color: colorScheme.onErrorContainer),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (crewStatus.missingTechnicians > 0)
                  TextButton.icon(
                    onPressed: onRecruitTechnician,
                    icon: const Icon(Icons.engineering_outlined),
                    label: Text('محتاج ${crewStatus.missingTechnicians} فني'),
                  ),
                if (crewStatus.missingAssistants > 0)
                  TextButton.icon(
                    onPressed: onRecruitAssistant,
                    icon: const Icon(Icons.handyman_outlined),
                    label: Text('محتاج ${crewStatus.missingAssistants} مساعد'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// معرض صغير للصور اللي اترفعت بالفعل — راجع التعليق في MediaRepository.listForOrder().
class _PhotoGallery extends StatelessWidget {
  final List<OrderMediaItem> media;
  final String titleAr;

  const _PhotoGallery({required this.media, required this.titleAr});

  @override
  Widget build(BuildContext context) {
    if (media.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '$titleAr (${media.length})',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 4),
          SizedBox(
            height: 72,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: media.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, index) => ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.network(
                  resolveMediaUrl(media[index].fileUrl),
                  width: 72,
                  height: 72,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => Container(
                    width: 72,
                    height: 72,
                    color: Theme.of(
                      context,
                    ).colorScheme.surfaceContainerHighest,
                    child: const Icon(Icons.broken_image_outlined),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _QuoteItemDraft {
  String itemType;
  String nameAr;
  double quantity;
  int unitPriceCents;

  _QuoteItemDraft({
    this.itemType = 'spare_part',
    this.nameAr = '',
    this.quantity = 1,
    this.unitPriceCents = 0,
  });
}

const Map<String, String> _quoteItemTypeLabelsAr = {
  'spare_part': 'قطعة غيار',
  'extra_labor': 'أجرة إضافية',
  'addon': 'إضافة',
};

// Dialog بسيط لإضافة بند أو أكتر لعرض السعر — كل بند: النوع، الاسم، الكمية، سعر الوحدة بالجنيه
// (بيتحول لقروش وقت الإرسال، مطابق لباقي التطبيق كله بالقرش).
class _ProposeQuoteDialog extends StatefulWidget {
  const _ProposeQuoteDialog();

  @override
  State<_ProposeQuoteDialog> createState() => _ProposeQuoteDialogState();
}

class _ProposeQuoteDialogState extends State<_ProposeQuoteDialog> {
  final List<_QuoteItemDraft> _drafts = [_QuoteItemDraft()];
  final List<TextEditingController> _nameControllers = [
    TextEditingController(),
  ];
  final List<TextEditingController> _qtyControllers = [
    TextEditingController(text: '1'),
  ];
  final List<TextEditingController> _priceControllers = [
    TextEditingController(),
  ];

  @override
  void dispose() {
    for (final c in [
      ..._nameControllers,
      ..._qtyControllers,
      ..._priceControllers,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  void _addRow() {
    setState(() {
      _drafts.add(_QuoteItemDraft());
      _nameControllers.add(TextEditingController());
      _qtyControllers.add(TextEditingController(text: '1'));
      _priceControllers.add(TextEditingController());
    });
  }

  void _removeRow(int index) {
    setState(() {
      _drafts.removeAt(index);
      _nameControllers.removeAt(index).dispose();
      _qtyControllers.removeAt(index).dispose();
      _priceControllers.removeAt(index).dispose();
    });
  }

  void _submit() {
    final result = <_QuoteItemDraft>[];
    for (var i = 0; i < _drafts.length; i++) {
      final name = _nameControllers[i].text.trim();
      final qty = double.tryParse(_qtyControllers[i].text.trim());
      final priceEgp = double.tryParse(_priceControllers[i].text.trim());
      if (name.isEmpty ||
          qty == null ||
          qty <= 0 ||
          priceEgp == null ||
          priceEgp < 0)
        continue;
      result.add(
        _QuoteItemDraft(
          itemType: _drafts[i].itemType,
          nameAr: name,
          quantity: qty,
          unitPriceCents: (priceEgp * 100).round(),
        ),
      );
    }
    // راجع docs/08 §108-C — شيل الفوكس من أي حقل مفتوح قبل الإقفال عشان نتجنب
    // Flutter assertion '_dependents.isEmpty' (شاشة حمرا + الطلب بيعلّق).
    FocusScope.of(context).unfocus();
    Navigator.of(context).pop(result);
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: AlertDialog(
        title: const Text('اقترح عرض سعر'),
        content: SizedBox(
          width: 400,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (var i = 0; i < _drafts.length; i++)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: DropdownButtonFormField<String>(
                                initialValue: _drafts[i].itemType,
                                decoration: const InputDecoration(
                                  labelText: 'النوع',
                                ),
                                items: _quoteItemTypeLabelsAr.entries
                                    .map(
                                      (e) => DropdownMenuItem(
                                        value: e.key,
                                        child: Text(e.value),
                                      ),
                                    )
                                    .toList(),
                                onChanged: (v) => setState(
                                  () => _drafts[i].itemType = v ?? 'spare_part',
                                ),
                              ),
                            ),
                            if (_drafts.length > 1)
                              IconButton(
                                onPressed: () => _removeRow(i),
                                icon: const Icon(Icons.delete_outline),
                              ),
                          ],
                        ),
                        TextField(
                          controller: _nameControllers[i],
                          decoration: const InputDecoration(
                            labelText: 'اسم البند',
                          ),
                        ),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _qtyControllers[i],
                                decoration: const InputDecoration(
                                  labelText: 'الكمية',
                                ),
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                      decimal: true,
                                    ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: TextField(
                                controller: _priceControllers[i],
                                decoration: const InputDecoration(
                                  labelText: 'سعر الوحدة (ج.م.)',
                                ),
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                      decimal: true,
                                    ),
                              ),
                            ),
                          ],
                        ),
                        if (i < _drafts.length - 1) const Divider(),
                      ],
                    ),
                  ),
                TextButton.icon(
                  onPressed: _addRow,
                  icon: const Icon(Icons.add),
                  label: const Text('بند تاني'),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () {
              FocusScope.of(context).unfocus();
              Navigator.of(context).pop();
            },
            child: const Text('إلغاء'),
          ),
          FilledButton(onPressed: _submit, child: const Text('ابعت العرض')),
        ],
      ),
    );
  }
}

class _CancelOrderResult {
  final String reasonId;
  final String? freeText;

  _CancelOrderResult({required this.reasonId, required this.freeText});
}

// سياسة إلغاء الفني (docs/10) — مرحلتين جوّه نفس الـdialog، مش إلغاء بضغطة واحدة:
// 1) اختيار سبب (كود من قايمة حقيقية جاية من الباك-إند) + نص حر (إجباري لو السبب محتاجه).
// 2) شاشة تأكيد أخيرة صريحة قبل ما الإلغاء يتبعت فعليًا.
class _CancelOrderDialog extends StatefulWidget {
  final List<CancellationReason> reasons;

  const _CancelOrderDialog({required this.reasons});

  @override
  State<_CancelOrderDialog> createState() => _CancelOrderDialogState();
}

class _CancelOrderDialogState extends State<_CancelOrderDialog> {
  CancellationReason? _selected;
  final _freeTextController = TextEditingController();
  bool _showConfirm = false;
  String? _validationError;

  @override
  void dispose() {
    _freeTextController.dispose();
    super.dispose();
  }

  void _goToConfirm() {
    if (_selected == null) {
      setState(() => _validationError = 'اختار سبب الإلغاء الأول');
      return;
    }
    if (_selected!.requiresFreeText &&
        _freeTextController.text.trim().isEmpty) {
      setState(() => _validationError = 'السبب ده محتاج توضيح نصي');
      return;
    }
    setState(() {
      _validationError = null;
      _showConfirm = true;
    });
  }

  void _confirm() {
    Navigator.of(context).pop(
      _CancelOrderResult(
        reasonId: _selected!.id,
        freeText: _freeTextController.text,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: AlertDialog(
        title: Text(_showConfirm ? 'تأكيد إلغاء الطلب' : 'إلغاء الطلب'),
        content: SizedBox(
          width: 400,
          child: _showConfirm ? _buildConfirmStep() : _buildReasonStep(),
        ),
        actions: _showConfirm
            ? [
                TextButton(
                  onPressed: () => setState(() => _showConfirm = false),
                  child: const Text('رجوع'),
                ),
                FilledButton(
                  onPressed: _confirm,
                  style: FilledButton.styleFrom(backgroundColor: Colors.red),
                  child: const Text('أيوه، ألغي الطلب'),
                ),
              ]
            : [
                TextButton(
                  onPressed: () {
                    // راجع docs/08 §108-C — شيل الفوكس من حقل التوضيح النصي قبل
                    // الإقفال عشان نتجنب Flutter assertion '_dependents.isEmpty'.
                    FocusScope.of(context).unfocus();
                    Navigator.of(context).pop();
                  },
                  child: const Text('تراجع'),
                ),
                FilledButton(
                  onPressed: _goToConfirm,
                  child: const Text('التالي'),
                ),
              ],
      ),
    );
  }

  Widget _buildReasonStep() {
    return SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('اختار سبب الإلغاء:'),
          const SizedBox(height: 8),
          if (widget.reasons.isEmpty)
            const Text(
              'مفيش أسباب إلغاء متاحة دلوقتي — تواصل مع الدعم',
              style: TextStyle(color: Colors.red),
            ),
          for (final reason in widget.reasons)
            RadioListTile<CancellationReason>(
              value: reason,
              groupValue: _selected,
              onChanged: (v) => setState(() => _selected = v),
              title: Text(reason.reasonAr),
              subtitle: reason.chargesFee
                  ? Text(
                      'رسوم إلغاء ${reason.feePercentage.toStringAsFixed(0)}%',
                    )
                  : null,
              dense: true,
            ),
          if (_selected?.requiresFreeText == true) ...[
            const SizedBox(height: 8),
            TextField(
              controller: _freeTextController,
              decoration: const InputDecoration(
                labelText: 'وضّح السبب (إجباري)',
              ),
              maxLines: 3,
            ),
          ],
          if (_validationError != null) ...[
            const SizedBox(height: 8),
            Text(_validationError!, style: const TextStyle(color: Colors.red)),
          ],
        ],
      ),
    );
  }

  Widget _buildConfirmStep() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('هتلغي الطلب بسبب: ${_selected!.reasonAr}'),
        if (_freeTextController.text.trim().isNotEmpty) ...[
          const SizedBox(height: 4),
          Text('التفاصيل: ${_freeTextController.text.trim()}'),
        ],
        if (_selected!.chargesFee) ...[
          const SizedBox(height: 8),
          Text(
            'هيتخصم منك رسوم إلغاء ${_selected!.feePercentage.toStringAsFixed(0)}% من قيمة الطلب.',
            style: const TextStyle(color: Colors.red),
          ),
        ],
        const SizedBox(height: 12),
        const Text('متأكد إنك عايز تلغي الطلب ده؟ الخطوة دي مش هترجع.'),
      ],
    );
  }
}

class _FailedVisitResult {
  final String reason;
  final String description;

  _FailedVisitResult({required this.reason, required this.description});
}

// أسباب مقفولة (مطابقة لـFailedVisitReason في report-failed-visit.dto.ts) — مش نص حر بالكامل،
// عشان الأدمن يقدر يفلتر ويقيس (docs/08 §22 بند 3).
const Map<String, String> _failedVisitReasonLabelsAr = {
  'customer_no_show': 'العميل مش موجود / مش بيرد',
  'required_work_rejected': 'العميل رفض شغل ضروري لإتمام الطلب صح',
  'other': 'سبب تاني',
};

class _ReportFailedVisitDialog extends StatefulWidget {
  const _ReportFailedVisitDialog();

  @override
  State<_ReportFailedVisitDialog> createState() =>
      _ReportFailedVisitDialogState();
}

class _ReportFailedVisitDialogState extends State<_ReportFailedVisitDialog> {
  String _reason = 'customer_no_show';
  final _descriptionController = TextEditingController();
  String? _validationError;

  @override
  void dispose() {
    _descriptionController.dispose();
    super.dispose();
  }

  void _submit() {
    if (_descriptionController.text.trim().length < 10) {
      setState(
        () => _validationError =
            'اكتب توضيح مختصر (10 حروف على الأقل) عشان الإدارة تفهم الموقف',
      );
      return;
    }
    // راجع docs/08 §108-C — شيل الفوكس من حقل التوضيح قبل الإقفال عشان نتجنب
    // Flutter assertion '_dependents.isEmpty' (شاشة حمرا + الطلب بيعلّق).
    FocusScope.of(context).unfocus();
    Navigator.of(context).pop(
      _FailedVisitResult(
        reason: _reason,
        description: _descriptionController.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: AlertDialog(
        title: const Text('زيارة فاشلة'),
        content: SizedBox(
          width: 400,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('السبب:'),
                for (final entry in _failedVisitReasonLabelsAr.entries)
                  RadioListTile<String>(
                    value: entry.key,
                    groupValue: _reason,
                    onChanged: (v) => setState(() => _reason = v!),
                    title: Text(entry.value),
                    dense: true,
                  ),
                const SizedBox(height: 8),
                TextField(
                  controller: _descriptionController,
                  decoration: const InputDecoration(
                    labelText: 'وضّح الموقف بالتفصيل',
                  ),
                  maxLines: 3,
                ),
                if (_validationError != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _validationError!,
                    style: const TextStyle(color: Colors.red),
                  ),
                ],
                const SizedBox(height: 12),
                const Text(
                  'الطلب هيتوقف والإدارة هتراجع الموقف وترجعلك — مش هيتحصّل ولا يتقفل لحد ما المراجعة تخلص.',
                  style: TextStyle(color: Colors.orange, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () {
              FocusScope.of(context).unfocus();
              Navigator.of(context).pop();
            },
            child: const Text('تراجع'),
          ),
          FilledButton(
            onPressed: _submit,
            style: FilledButton.styleFrom(backgroundColor: Colors.orange),
            child: const Text('ابعت البلاغ'),
          ),
        ],
      ),
    );
  }
}

// تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14) — بلاغ حسّاس (ممكن يبقى نزاع مباشر مع
// العميل)، فخطوتين بدل واحدة: وصف الموقف الأول، بعدين تأكيد صريح منفصل قبل الإرسال الفعلي —
// نفس مبدأ "double-tap protection" بس للتأكيد البشري مش الشبكة.
class _CashNotReceivedDialog extends StatefulWidget {
  const _CashNotReceivedDialog();

  @override
  State<_CashNotReceivedDialog> createState() => _CashNotReceivedDialogState();
}

class _CashNotReceivedDialogState extends State<_CashNotReceivedDialog> {
  final _descriptionController = TextEditingController();
  String? _validationError;
  bool _confirming = false;

  @override
  void dispose() {
    _descriptionController.dispose();
    super.dispose();
  }

  void _goToConfirm() {
    if (_descriptionController.text.trim().length < 10) {
      setState(
        () => _validationError =
            'اكتب توضيح مختصر (10 حروف على الأقل) عشان الإدارة تفهم الموقف',
      );
      return;
    }
    setState(() {
      _validationError = null;
      _confirming = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: AlertDialog(
        title: const Text('لم أستلم الكاش'),
        content: SizedBox(
          width: 400,
          child: _confirming
              ? Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: const [
                    Text('متأكد إنك مستلمتش أي فلوس من العميل على الطلب ده؟'),
                    SizedBox(height: 8),
                    Text(
                      'الطلب هيتوقف فورًا وهيتحول لشكوى تراجعها الإدارة — البلاغ ده بيتسجّل وبيوصل للعميل.',
                      style: TextStyle(color: Colors.red, fontSize: 12),
                    ),
                  ],
                )
              : SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      TextField(
                        controller: _descriptionController,
                        decoration: const InputDecoration(
                          labelText: 'وضّح الموقف بالتفصيل',
                        ),
                        maxLines: 3,
                      ),
                      if (_validationError != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          _validationError!,
                          style: const TextStyle(color: Colors.red),
                        ),
                      ],
                    ],
                  ),
                ),
        ),
        actions: _confirming
            ? [
                TextButton(
                  onPressed: () => setState(() => _confirming = false),
                  child: const Text('رجوع'),
                ),
                FilledButton(
                  onPressed: () => Navigator.of(
                    context,
                  ).pop(_descriptionController.text.trim()),
                  style: FilledButton.styleFrom(backgroundColor: Colors.red),
                  child: const Text('أكّد — مستلمتش الفلوس'),
                ),
              ]
            : [
                TextButton(
                  onPressed: () {
                    // راجع docs/08 §108-C — شيل الفوكس من حقل التوضيح قبل
                    // الإقفال عشان نتجنب Flutter assertion '_dependents.isEmpty'.
                    FocusScope.of(context).unfocus();
                    Navigator.of(context).pop();
                  },
                  child: const Text('تراجع'),
                ),
                FilledButton(
                  onPressed: _goToConfirm,
                  child: const Text('التالي'),
                ),
              ],
      ),
    );
  }
}

/// مدخلات «هكمّل الشغل يوم تاني» (ADR-0047).
class _ContinueAnotherDayDraft {
  const _ContinueAnotherDayDraft(this.reason, this.date);

  final String reason;

  /// `YYYY-MM-DD` — الجدولة في المشروع كله باليوم مش بالساعة (ADR-0018 §2).
  final String date;
}

/// حوار «هكمّل الشغل يوم تاني».
///
/// **السبب إجباري ومش قصير** — هو اللي بيوصل للعميل حرفيًا. سبب فاضي أو من كلمة واحدة بيخلّي
/// الميزة تبان للعميل كتهرّب مش كشفافية، وده عكس الغرض منها بالظبط.
class _ContinueAnotherDayDialog extends StatefulWidget {
  const _ContinueAnotherDayDialog();

  @override
  State<_ContinueAnotherDayDialog> createState() =>
      _ContinueAnotherDayDialogState();
}

class _ContinueAnotherDayDialogState extends State<_ContinueAnotherDayDialog> {
  final _reasonController = TextEditingController();
  DateTime? _date;
  String? _error;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      // أقرب اختيار هو بعد بكرة — الاستكمال معناه ترجع في **يوم تاني**، والباك-إند بيرفض
      // النهارده صراحةً. تقييد المُنتقي هنا بيمنع رفض متأخر بعد ما الفني يملا كل حاجة.
      initialDate: now.add(const Duration(days: 1)),
      firstDate: now.add(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 60)),
      helpText: 'هترجع تكمّل امتى؟',
    );
    if (picked != null && mounted) setState(() => _date = picked);
  }

  void _submit() {
    final reason = _reasonController.text.trim();
    if (reason.length < 3) {
      setState(() => _error = 'اكتب السبب — العميل هيقراه زي ما هو');
      return;
    }
    if (_date == null) {
      setState(() => _error = 'اختار اليوم اللي هترجع فيه');
      return;
    }
    // راجع docs/08 §108-C — شيل الفوكس من حقل السبب قبل الإقفال عشان نتجنب
    // Flutter assertion '_dependents.isEmpty' (شاشة حمرا + الطلب بيعلّق).
    FocusScope.of(context).unfocus();
    Navigator.of(context).pop(
      _ContinueAnotherDayDraft(
        reason,
        _date!.toLocal().toIso8601String().split('T').first,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('هكمّل الشغل يوم تاني'),
      // بَقّة حقيقية اتلقطت بلقطة شاشة مالك — لما الكيبورد بيفتح (العميل بيكتب السبب)، المساحة
      // المتاحة للحوار بتقل والمحتوى الثابت الطول ده كان بيعمل RenderFlex overflow ("BOTTOM
      // OVERFLOWED BY 26 PIXELS"). SingleChildScrollView بيخلي المحتوى يتمرّر بدل ما يفيض.
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'الطلب هيفضل مفتوح باسمك، والعميل هيوصله إن الشغل هيكمّل — بالسبب واليوم.',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _reasonController,
              maxLines: 2,
              maxLength: 500,
              decoration: const InputDecoration(
                labelText: 'ليه وقفت النهارده؟',
                hintText: 'مثلاً: محتاج قطعة غيار مش متوفرة، هجيبها وأرجع',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _pickDate,
              icon: const Icon(Icons.event_outlined),
              label: Text(
                _date == null
                    ? 'اختار يوم الرجوع'
                    : 'هرجع يوم ${_date!.toLocal().toIso8601String().split('T').first}',
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(
                _error!,
                style: const TextStyle(color: Colors.red, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () {
            FocusScope.of(context).unfocus();
            Navigator.of(context).pop();
          },
          child: const Text('إلغاء'),
        ),
        FilledButton(onPressed: _submit, child: const Text('تأكيد')),
      ],
    );
  }
}
