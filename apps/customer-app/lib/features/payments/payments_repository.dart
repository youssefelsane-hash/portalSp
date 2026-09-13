import 'dart:math';
import '../../core/auth_repository.dart';

class WalletBalance {
  final int balanceCents;
  final int pendingBalanceCents;
  final int reservedBalanceCents;
  final String currencyCode;
  final bool isFrozen;

  WalletBalance({
    required this.balanceCents,
    required this.pendingBalanceCents,
    required this.reservedBalanceCents,
    required this.currencyCode,
    required this.isFrozen,
  });

  factory WalletBalance.fromJson(Map<String, dynamic> json) => WalletBalance(
    balanceCents: (json['balance_cents'] as num).toInt(),
    pendingBalanceCents: (json['pending_balance_cents'] as num).toInt(),
    reservedBalanceCents: (json['reserved_balance_cents'] as num).toInt(),
    currencyCode: json['currency_code'] as String,
    isFrozen: json['is_frozen'] as bool,
  );
}

class WalletTransactionItem {
  final String id;
  final String direction;
  final String transactionType;
  final int amountCents;
  final int balanceAfterCents;
  final String? descriptionAr;
  final bool isReversed;
  final DateTime createdAt;

  WalletTransactionItem({
    required this.id,
    required this.direction,
    required this.transactionType,
    required this.amountCents,
    required this.balanceAfterCents,
    required this.descriptionAr,
    required this.isReversed,
    required this.createdAt,
  });

  bool get isCredit => direction == 'credit';

  factory WalletTransactionItem.fromJson(Map<String, dynamic> json) =>
      WalletTransactionItem(
        id: json['id'] as String,
        direction: json['direction'] as String,
        transactionType: json['transaction_type'] as String,
        amountCents: (json['amount_cents'] as num).toInt(),
        balanceAfterCents: (json['balance_after_cents'] as num).toInt(),
        descriptionAr: json['description_ar'] as String?,
        isReversed: json['is_reversed'] as bool,
        createdAt: DateTime.parse(json['created_at'] as String).toLocal(),
      );
}

class PaymentsRepository {
  final AuthRepository auth;

  PaymentsRepository(this.auth);

  Future<WalletBalance> fetchWallet() async {
    final data = await auth.authedRequest('GET', '/wallet');
    return WalletBalance.fromJson(data!);
  }

  Future<List<WalletTransactionItem>> fetchWalletTransactions() async {
    final items = await auth.authedRequestList('/wallet/transactions');
    return items.map(WalletTransactionItem.fromJson).toList();
  }

  // كل عملية دفع لازم Idempotency-Key حقيقي — مش UUID package (تجنّب اعتماد جديد لسطر واحد)،
  // مزيج timestamp + رقم عشوائي كافي كمفتاح فريد على مستوى الجهاز الواحد لعملية دفع واحدة.
  //
  // بَقّة حقيقية اتلقطت (مراجعة booking flow الشاملة 2026-08-12): الدالة دي كانت بتتنادى من
  // جوّه كل واحدة من الدوال التلاتة تحت، يعني كل نداء (حتى لو retry لنفس الطلب بعد timeout
  // شبكة) كان بيولّد مفتاح جديد كل مرة — يعني الـIdempotency-Key عمليًا كان بيتلغى تمامًا
  // (الباك-إند بيدور على مفتاح موجود قبل كده بنفس القيمة، ومفتاح جديد كل مرة يعني الفحص ده
  // مبيلاقيش حاجة أبداً). الحماية الفعلية من دفع مزدوج فضلت موجودة بس عبر قفل الطلب الذرّي
  // في الباك-إند نفسه (orders.service.ts's payWithWallet)، مش عبر العقد المصمَّم أصلاً. الإصلاح:
  // المفتاح بقى بيتولّد مرة واحدة بس ويتبعت من الكولر (order_detail_screen.dart) — retry لنفس
  // محاولة الدفع بيستخدم نفس المفتاح فعليًا، زي ما العقد مفروض يشتغل بالظبط.
  //
  // بَقّة حقيقية تانية اتلقطت (Script 7 Phase 9 نفسها، ظهرت بس على Flutter Web): `1 << 32`
  // بيتقيّم لـ0 لما التطبيق يتبني بـdart2js/DDC (بعكس الـVM اللي بتحسبها 4294967296 عادي) —
  // `Random().nextInt(0)` بيرمي RangeError فورًا، يعني أي شاشة بتنادي الدالة دي وقت initState
  // (create_order_screen.dart) كانت بتكسر الشاشة كلها بشاشة حمرا قبل ما أي حاجة تترندر خالص
  // (بما فيها الخريطة — مش بَقّة خريطة زي ما بدا في الظاهر). الحد الأقصى بقى `0x7FFFFFFF`
  // (2^31-1) — قيمة آمنة ومتطابقة على كل أهداف الترجمة (VM، dart2js، DDC) بلا أي إزاحة بت كبيرة.
  String generateIdempotencyKey() {
    final random = Random();
    return '${DateTime.now().microsecondsSinceEpoch}-${random.nextInt(0x7FFFFFFF)}';
  }

  Future<Map<String, dynamic>> payWithWallet(
    String orderId,
    String idempotencyKey,
  ) async {
    final data = await auth.authedRequest(
      'POST',
      '/orders/$orderId/pay-with-wallet',
      extraHeaders: {'Idempotency-Key': idempotencyKey},
    );
    return data!;
  }

  // بيرجّع {payment, redirect_url} — الكولر مسؤول يفتح redirect_url في WebView (نفس نمط
  // "الباك-إند جاهز، مفيش ولا مسؤولية تسوية هنا" — القفل النهائي بيحصل عبر webhook مش رد الـ endpoint ده).
  Future<String> payWithCard(String orderId, String idempotencyKey) async {
    final data = await auth.authedRequest(
      'POST',
      '/orders/$orderId/pay-with-card',
      extraHeaders: {'Idempotency-Key': idempotencyKey},
    );
    return data!['redirect_url'] as String;
  }

  // بيرجّع كود مرجعي فوري + تاريخ انتهاء — العميل بياخد الكود ويدفعه كاش في أقرب منفذ فوري.
  // مفيش WebView هنا خالص، القفل النهائي بردو عبر webhook مش رد الـ endpoint ده.
  Future<FawryReference> payWithFawryReference(
    String orderId,
    String idempotencyKey,
  ) async {
    final data = await auth.authedRequest(
      'POST',
      '/orders/$orderId/pay-with-fawry-reference',
      extraHeaders: {'Idempotency-Key': idempotencyKey},
    );
    return FawryReference.fromJson(data!);
  }

  // InstaPay — تعليمات تحويل بالعربي + كود مرجعي، مفيش webhook خالص (ADR-0013 §7): موظف Finance
  // بيأكّد الاستلام يدويًا عبر POST /admin/payments/:id/confirm-instapay. مفيش تاريخ انتهاء
  // (بعكس Fawry) — الكود العميل لازم يذكره وقت التحويل عشان الموظف يقدر يربطه بالدفعة الصح.
  Future<InstaPayReference> payWithInstaPay(
    String orderId,
    String idempotencyKey,
  ) async {
    final data = await auth.authedRequest(
      'POST',
      '/orders/$orderId/pay-with-instapay',
      extraHeaders: {'Idempotency-Key': idempotencyKey},
    );
    return InstaPayReference.fromJson(data!);
  }

  /// **معاينة الدفع بـInstaPay جوّه الطلب** (ADR-0089) — قراءة بحتة، مابتفتحش أي دفعة.
  ///
  /// الفرق عن `getInstaPayTransfer` تحت: دي بتشتغل حتى لو **مفيش** تحويل مفتوح أصلاً — وده
  /// حال كل طلب كاش. الغرض إن بيانات الحساب والمبلغ يفضلوا قدام العميل جوّه الطلب، من غير
  /// ما نفتح دفعة معلّقة تقفل عليه مسار الكاش.
  Future<InstaPayPreview?> previewInstaPay(String orderId) async {
    final data = await auth.authedRequest('GET', '/orders/$orderId/instapay-preview');
    if (data == null) return null;
    return InstaPayPreview.fromJson(data);
  }

  /// استئناف شاشة التحويل — **قراءة بحتة، مابتعملش دفعة جديدة**.
  ///
  /// العميل بيسيب تطبيقنا ويفتح تطبيق البنك ويرجع؛ ده الاستخدام الطبيعي لـInstaPay. المسار
  /// ده بيرجّع نفس تفاصيل الدفعة المعلّقة، فالرجوع مابيحتاجش `Idempotency-Key` ولا بيخاطر
  /// بدفعة تانية.
  Future<InstaPayReference> getInstaPayTransfer(String orderId) async {
    final data = await auth.authedRequest(
      'GET',
      '/orders/$orderId/instapay-transfer',
    );
    return InstaPayReference.fromJson(data!);
  }

  // العميل بيقول "أنا حوّلت فعلاً" — بيسجّل customer_confirmed_transfer_at بس، مش تأكيد نهائي
  // للدفعة (ده لسه شغل موظف Finance عبر confirm-instapay). كانت فجوة حقيقية: الزرار في الشاشة
  // كان بيعمل polling محلي بس من غير ما ينادي أي endpoint يسجّل إن العميل ادّعى التحويل خالص.
  Future<void> confirmInstaPayTransfer(String orderId) async {
    await auth.authedRequest(
      'POST',
      '/orders/$orderId/confirm-instapay-transfer',
    );
  }
}

class InstaPayReference {
  final String referenceCode;
  final String instructionsAr;

  /// صورة QR لاستقبال التحويل (docs/08 §78-د) — بيرفعها/بيربطها الأدمن من لوحة التحكم.
  /// `null` يعني مفيش واحدة مضبوطة، والشاشة بتعرض التعليمات النصية بس زي ما كانت.
  final String? qrImageUrl;

  /// الحساب اللي العميل بيحوّل عليه (عنوان IPA أو رقم موبايل).
  ///
  /// **حقل مستقل مش جوّه `instructionsAr`** (طلب مالك 2026-09-11) — الشاشة بتعرضه LTR في
  /// سطر لوحده مع زرار نسخ، عشان الـbidi ما يقلبش خانات الرقم وسط النص العربي.
  final String? recipientAddress;
  final String? recipientName;
  final int? amountCents;

  /// وعد وقت التأكيد المعروض للعميل — المعتاد والسقف بالدقايق.
  final int confirmTypicalMinutes;
  final int confirmMaxMinutes;

  InstaPayReference({
    required this.referenceCode,
    required this.instructionsAr,
    this.qrImageUrl,
    this.recipientAddress,
    this.recipientName,
    this.amountCents,
    this.confirmTypicalMinutes = 20,
    this.confirmMaxMinutes = 60,
  });

  factory InstaPayReference.fromJson(Map<String, dynamic> json) =>
      InstaPayReference(
        referenceCode: json['reference_code'] as String,
        instructionsAr: json['instructions_ar'] as String,
        qrImageUrl: json['qr_image_url'] as String?,
        recipientAddress: json['recipient_address'] as String?,
        recipientName: json['recipient_name'] as String?,
        amountCents: json['amount_cents'] as int?,
        // الافتراضيات هنا مش أرقام مخترعة: هي نفس افتراضات الباك-إند، وبتغطي نسخة تطبيق
        // قديمة بتقرا رد من سيرفر أقدم من الحقول دي.
        confirmTypicalMinutes: json['confirm_typical_minutes'] as int? ?? 20,
        confirmMaxMinutes: json['confirm_max_minutes'] as int? ?? 60,
      );
}

/// **معاينة الدفع بـInstaPay جوّه الطلب** (ADR-0089).
///
/// نفس حقول `InstaPayReference` العرضية + علمين: هل فيه تحويل مفتوح بالفعل، والطلب لسه
/// قابل للدفع أصلاً. مافيهاش `payment` لأن **مفيش دفعة اتفتحت** — دي قراءة بحتة.
class InstaPayPreview {
  final int amountCents;
  final String? recipientAddress;
  final String? recipientName;
  final String instructionsAr;
  final String? qrImageUrl;
  final String referenceCode;
  final int confirmTypicalMinutes;
  final int confirmMaxMinutes;
  final bool hasOpenTransfer;
  final bool isPayable;

  InstaPayPreview({
    required this.amountCents,
    required this.instructionsAr,
    required this.referenceCode,
    this.recipientAddress,
    this.recipientName,
    this.qrImageUrl,
    this.confirmTypicalMinutes = 20,
    this.confirmMaxMinutes = 60,
    this.hasOpenTransfer = false,
    this.isPayable = true,
  });

  factory InstaPayPreview.fromJson(Map<String, dynamic> json) => InstaPayPreview(
        amountCents: (json['amount_cents'] as num?)?.toInt() ?? 0,
        instructionsAr: json['instructions_ar'] as String? ?? '',
        referenceCode: json['reference_code'] as String? ?? '',
        recipientAddress: json['recipient_address'] as String?,
        recipientName: json['recipient_name'] as String?,
        qrImageUrl: json['qr_image_url'] as String?,
        confirmTypicalMinutes: (json['confirm_typical_minutes'] as num?)?.toInt() ?? 20,
        confirmMaxMinutes: (json['confirm_max_minutes'] as num?)?.toInt() ?? 60,
        hasOpenTransfer: json['has_open_transfer'] as bool? ?? false,
        isPayable: json['is_payable'] as bool? ?? true,
      );
}

class FawryReference {
  final String referenceNumber;
  final DateTime expiresAt;

  FawryReference({required this.referenceNumber, required this.expiresAt});

  factory FawryReference.fromJson(Map<String, dynamic> json) => FawryReference(
    referenceNumber: json['reference_number'] as String,
    expiresAt: DateTime.parse(json['expires_at'] as String),
  );
}
