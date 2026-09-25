import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'api_client.dart';
import 'api_exception.dart';
import 'biometric_auth_service.dart';
import 'push_notification_service.dart';

class BaytakUser {
  final String id;
  final String phoneNumber;
  final String fullName;
  final String userType;

  /// هل الحساب ليه رمز دخول؟ (ADR-0109)
  ///
  /// `false` لمستخدم قديم اتسجّل بالـOTP قبل التبديل — التطبيق بيطلب منه يحط رمزه وهو داخل
  /// بالفعل. الافتراضي `true` عمدًا لو الحقل مش موجود في الرد: نسخة API أقدم مالهاش الحقل
  /// معناها إن الـOTP لسه شغّال، فمالناش حق نزنّق المستخدم بشاشة مالهاش لازمة.
  final bool pinSet;

  BaytakUser({
    required this.id,
    required this.phoneNumber,
    required this.fullName,
    required this.userType,
    this.pinSet = true,
  });

  factory BaytakUser.fromJson(Map<String, dynamic> json) => BaytakUser(
        id: json['id'] as String,
        phoneNumber: json['phone_number'] as String,
        fullName: json['full_name'] as String,
        userType: json['user_type'] as String,
        pinSet: json['pin_set'] as bool? ?? true,
      );
}

// إدارة الجلسة: refresh_token في flutter_secure_storage (Keychain على iOS، Keystore على
// Android) — مش SharedPreferences (ده مش آمن كفاية لـ tokens حساسة). access_token في
// الذاكرة بس، نفس منطق apps/admin بالظبط (راجع apps/admin/README.md لتفاصيل ليه).
class AuthRepository extends ChangeNotifier {
  static const _refreshTokenKey = 'baytak_refresh_token';
  final _secureStorage = const FlutterSecureStorage();

  String? _accessToken;
  BaytakUser? _user;
  bool _isLoading = true;
  bool _biometricUnlockPending = false;
  Future<String>? _inFlightRefresh;

  String? get accessToken => _accessToken;
  BaytakUser? get user => _user;
  bool get isLoading => _isLoading;
  bool get isAuthenticated => _accessToken != null;
  // docs/08 §17.22 — فيه جلسة محفوظة (refresh_token) بس البصمة مفعّلة ولسه ما أثبتناش هوية
  // المستخدم بيها للدورة دي. _AuthGate بيتأكد من الحقل ده *قبل* isAuthenticated — جلسة محفوظة
  // مش كافية لوحدها لدخول التطبيق لو البصمة مفعّلة.
  bool get biometricUnlockPending => _biometricUnlockPending;

  // نفس بَقّة apps/admin بالظبط (راجع الـ README هناك): refresh_token بيتدوّر على كل استخدام،
  // وأي إعادة استخدام لتوكن اتلغى بتقفل كل جلسات المستخدم. الـ single-flight guard ده بيمنع
  // أكتر من نداء refresh متزامن (زي init() بيتنادى مرتين من حاجتين مختلفتين وقت الإقلاع).
  //
  // Script 2 Part E (finding #30) — لو الباك-إند رفض الـrefresh برسالة 401 صريحة (حساب اتحظر،
  // الجلسة اتلغت من الأدمن، refresh token متكرر الاستخدام)، ده معناها الجلسة ميتة فعليًا مش
  // مجرد access_token قديم. كانت المشكلة إن الفشل ده بيتنشر بس للشاشة اللي عملت الـcall (مثلاً
  // OrderDetailScreen بعد Deep Link)، وبتعرض رسالة خطأ خام من غير أي رجوع لـLoginScreen — باقي
  // التطبيق (وAuthRepository نفسه) فاضل مقتنع إن المستخدم لسه داخل. مسح الحالة هنا (نقطة
  // مركزية واحدة يمر بيها كل استدعاء authed*) بيخلي _AuthGate يعرض LoginScreen فورًا من أي
  // مكان في التطبيق. الفحص محصور صراحة في statusCode==401 (رفض حقيقي من الباك-إند بعد رد HTTP
  // فعلي) — مش أي فشل شبكة (SocketException/Timeout بترمي استثناء مختلف تمامًا مش ApiException،
  // راجع api_client.dart)، عشان انقطاع نت مؤقت ميسجّلش خروج المستخدم بالغلط.
  Future<String> _refresh() {
    return (_inFlightRefresh ??= _doRefresh().whenComplete(() => _inFlightRefresh = null)).catchError((Object err) {
      if (err is ApiException && err.statusCode == 401) {
        _accessToken = null;
        _user = null;
        unawaited(_secureStorage.delete(key: _refreshTokenKey));
        notifyListeners();
      }
      throw err;
    });
  }

  Future<String> _doRefresh() async {
    final storedRefreshToken = await _secureStorage.read(key: _refreshTokenKey).timeout(const Duration(seconds: 5));
    if (storedRefreshToken == null) {
      throw ApiException(code: 'AUTH_NO_SESSION', message: 'مفيش جلسة', statusCode: 401);
    }
    final data = await apiRequest('POST', '/auth/refresh', body: {'refresh_token': storedRefreshToken});
    final newAccessToken = data!['access_token'] as String;
    final newRefreshToken = data['refresh_token'] as String;
    await _persistRefreshToken(newRefreshToken);
    _accessToken = newAccessToken;
    return newAccessToken;
  }

  // كتابة refresh_token في flutter_secure_storage ممكن ترمي (Keystore متلف بعد تحديث نظام،
  // Secret Service مش متاح، إلخ) — فشلها ميستحقّش يوقف تسجيل الدخول (access_token في الذاكرة
  // اشتغل فعلاً)، بس هيمنع استمرار الجلسة بعد إعادة فتح التطبيق. نفس مبدأ "فشل الـ infra
  // الثانوي ميكسرش العملية الحقيقية للمستخدم" المتّبع في الباك-إند (queue/cache).
  //
  // بَقّة حقيقية اتلقطت (بلاغ مالك 2026-08-22): try/catch فوق بيحمي من استثناء صريح، لكن
  // Keystore ملتف على بعض الأجهزة الحقيقية بيعلّق (hang) بدل ما يرمي — والـawait وقتها
  // مابيرجعش أبدًا، فمفيش catch اتصلحه، والتطبيق كله بيقعد على شاشة تحميل للأبد (نفس الحاجة
  // تحصل مع read() في init()/_doRefresh() تحت). .timeout() هنا بيحوّل أي hang لـTimeoutException
  // حقيقي بعد 5 ثواني، يقع في نفس catch الموجود بالفعل.
  Future<void> _persistRefreshToken(String refreshToken) async {
    try {
      await _secureStorage.write(key: _refreshTokenKey, value: refreshToken).timeout(const Duration(seconds: 5));
    } catch (e) {
      debugPrint('فشل حفظ refresh_token بأمان — الجلسة الحالية سليمة، بس مش هتفضل بعد إعادة فتح التطبيق: $e');
    }
  }

  Future<void> init() async {
    try {
      // بَقّة حقيقية اتلقطت (بلاغ مالك 2026-08-22): على بعض الأجهزة الحقيقية، Keystore ملتف
      // بيخلي read() يعلّق (hang) بدل ما يرمي استثناء — التطبيق كان بيقعد على شاشة تحميل للأبد
      // من غير أي طلب شبكة يتبعت خالص (init() مابيوصلش لـ_refresh() أصلاً). .timeout() هنا
      // بيضمن إن أسوأ حالة هي "العميل محتاج يسجّل دخول تاني" مش "التطبيق ميفتحش خالص".
      final storedRefreshToken = await _secureStorage.read(key: _refreshTokenKey).timeout(const Duration(seconds: 5));
      if (storedRefreshToken == null) {
        _accessToken = null;
        _user = null;
        return;
      }
      // docs/08 §17.22 — بصمة مفعّلة على الجهاز ده = مينفعش نستخدم الجلسة المحفوظة تلقائيًا،
      // حتى لو الجهاز نفسه مفتوح فعليًا. _AuthGate هيعرض شاشة "افتح ببصمتك"، وunlockWithBiometrics()
      // هي اللي هتكمّل باقي المنطق ده (refresh + fetchMe) بعد نجاح البصمة فعليًا.
      if (await BiometricAuthService.isEnabled()) {
        _biometricUnlockPending = true;
        return;
      }
      await _refresh();
      await _fetchMe();
      _registerPushDeviceInBackground();
    } catch (_) {
      _accessToken = null;
      _user = null;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// بترجّع true لو الدخول نجح فعليًا (بصمة + refresh + fetchMe الاتلاتة). false لو أي خطوة فشلت
  /// (بصمة اتلغت/فشلت، أو الباك-إند رفض الجلسة المحفوظة — حساب موقوف/جلسة ملغاة، fail-closed
  /// حقيقي من `AuthService.refresh()` مش افتراض محلي) — الكولر (شاشة القفل) بيوجّه المستخدم
  /// لشاشة الدخول بالرقم + الرمز في الحالتين.
  Future<bool> unlockWithBiometrics() async {
    final authenticated = await BiometricAuthService.authenticate(reason: 'افتح أسطى ببصمتك');
    if (!authenticated) return false;

    _biometricUnlockPending = false;
    _isLoading = true;
    notifyListeners();
    try {
      await _refresh();
      await _fetchMe();
      _registerPushDeviceInBackground();
      return true;
    } catch (_) {
      _accessToken = null;
      _user = null;
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// "استخدم رقم موبايلك بدلاً" — بيقفل شاشة البصمة ويوديك لشاشة الدخول بالرقم + الرمز من
  /// غير ما يمسح الجلسة المحفوظة (لو المستخدم رجع بعدين ممكن يجرّب البصمة تاني بدل ما يتسجّل
  /// خروج كامل قسرًا لمجرد إنه اختار يفضّل الرقم المرة دي).
  void usePinInsteadOfBiometrics() {
    _biometricUnlockPending = false;
    notifyListeners();
  }

  Future<void> _fetchMe() async {
    final data = await apiRequest('GET', '/auth/me', accessToken: _accessToken);
    _user = BaytakUser.fromJson(data!);
  }

  // Fire-and-forget — تسجيل جهاز push مش لازم يأخّر أو يفشّل تسجيل الدخول نفسه.
  void _registerPushDeviceInBackground() {
    unawaited(PushNotificationService.registerCurrentDevice(authedRequest));
  }

  // ── الدخول برمز (ADR-0109) ──────────────────────────────────────────
  // نفس شكل مسارات الـOTP القديمة بالحرف — بيرجّعوا نفس زوج التوكنز وبيعملوا نفس الخطوات بعده
  // (حفظ الـrefresh، جلب /me، تسجيل جهاز الـpush). التغيير الوحيد هو الحقل اللي بيتبعت.

  /// دخول برقم + رمز. بيرمي `ApiException` برسالة الباك-إند زي ما هي.
  Future<void> loginWithPin(String phoneNumber, String pin) async {
    final data = await apiRequest(
      'POST',
      '/auth/pin/login',
      // **`role` بيقول للسيرفر التطبيق ده مين** (ADR-0110). الحساب الواحد ممكن يكون عميل
      // وصنايعي بنفس الرقم، والجلسة لازم تبقى بدور التطبيق اللي فاتح — من غير الحقل ده الجلسة
      // كانت بتاخد `users.user_type` فيبقى التطبيق نص شغّال. السيرفر **بيتحقق** من المنحة،
      // فالقيمة دي طلب مش صلاحية.
      body: {'phone_number': phoneNumber, 'pin': pin, 'role': 'customer'},
    );
    await _adoptTokenPair(data!);
  }

  /// تسجيل عميل جديد برمز. نفس حقول التسجيل القديمة بالظبط — `otp_code` بقى `pin`.
  Future<void> registerWithPin(
    String phoneNumber,
    String pin,
    String fullName, {
    String? referralCode,
    String? technicianReferralCode,
  }) async {
    final data = await apiRequest(
      'POST',
      '/auth/pin/register',
      body: {
        'phone_number': phoneNumber,
        'pin': pin,
        'full_name': fullName,
        'user_type': 'customer',
        if (referralCode != null && referralCode.isNotEmpty) 'referral_code': referralCode,
        if (technicianReferralCode != null && technicianReferralCode.isNotEmpty)
          'technician_referral_code': technicianReferralCode,
      },
    );
    await _adoptTokenPair(data!);
  }

  /// تعيين/تغيير الرمز لمستخدم **داخل بالفعل** — مسار هجرة المستخدمين القدام (ADR-0109 §6-أ).
  ///
  /// `currentPin` مطلوب بس لو الحساب ليه رمز. الباك-إند هو اللي بيفرض ده حسب حالة الحساب —
  /// التطبيق بيبعت اللي عنده وخلاص.
  Future<void> setPin(String pin, {String? currentPin}) async {
    await authedRequest('POST', '/auth/pin', body: {
      'pin': pin,
      if (currentPin != null && currentPin.isNotEmpty) 'current_pin': currentPin,
    });
    await _fetchMe();
    notifyListeners();
  }

  /// الخطوات اللي بتحصل بعد أي دخول ناجح — **مصدر واحد** للدخول والتسجيل. أي خطوة تتضاف
  /// لواحد وتتنسى في التاني = مستخدم داخل بنص حالة.
  Future<void> _adoptTokenPair(Map<String, dynamic> data) async {
    _accessToken = data['access_token'] as String;
    await _persistRefreshToken(data['refresh_token'] as String);
    await _fetchMe();
    _registerPushDeviceInBackground();
    notifyListeners();
  }

  /// **استهلاك كود استرجاع رمز الدخول** (ADR-0109 §6-ب).
  ///
  /// المخرج الوحيد للمستخدم اللي نسي رمزه وهو **مش داخل**: بيكلّم الدعم، الدعم بيتأكد من هويته
  /// ويدّيه كود في المكالمة، وهو بيكتبه هنا **ويختار رمزه بنفسه** (الأدمن عمره ما يعرف الرمز).
  ///
  /// **مابيرجّعش جلسة عمدًا** — الكود تصريح لتعيين رمز مش تسجيل دخول. المستخدم بيدخل بالرمز
  /// الجديد من شاشة الدخول العادية، فمسار الدخول يفضل واحد لكل الحالات.
  Future<void> redeemPinResetCode(String phoneNumber, String resetCode, String pin) async {
    await apiRequest('POST', '/auth/pin/reset/redeem', body: {
      'phone_number': phoneNumber,
      'reset_code': resetCode,
      'pin': pin,
    });
  }

  /// حذف الحساب نهائيًا (بوابة P0-1 في docs/23، ADR-0053).
  ///
  /// Google Play بيطلب **مسار حذف جوّه التطبيق** مش رابط ويب بس. الباك-إند بيرفض الحذف لو فيه
  /// رصيد محفظة أو طلب لسه شغال (بيرمي `ApiException` برسالة عربية واضحة يعرضها الكولر زي ما هي)،
  /// ولو نجح بيمسح البيانات الشخصية فعليًا ويلغي كل الجلسات على كل الأجهزة.
  ///
  /// بننضّف الحالة المحلية بعد النجاح بس — لو الحذف اترفض، المستخدم لازم يفضل داخل بحسابه.
  Future<void> deleteAccount() async {
    await authedRequest('DELETE', '/auth/me');
    await _secureStorage.delete(key: _refreshTokenKey);
    _accessToken = null;
    _user = null;
    notifyListeners();
  }

  Future<void> logout() async {
    final storedRefreshToken =
        await _secureStorage.read(key: _refreshTokenKey).timeout(const Duration(seconds: 5), onTimeout: () => null);
    if (storedRefreshToken != null) {
      await apiRequest('POST', '/auth/logout', body: {'refresh_token': storedRefreshToken}).catchError((_) => null);
    }
    await _secureStorage.delete(key: _refreshTokenKey);
    _accessToken = null;
    _user = null;
    notifyListeners();
  }

  // نداء API موثّق — لو access_token منتهي (401)، يجرّب refresh (single-flight) مرة واحدة ويعيد المحاولة.
  // ── تأكيد رقم الموبايل عند أول طلب (ADR-0112) ───────────────────────────
  //
  // المفتاح مقفول افتراضيًا، فالمسارات دي عمرها ما بتتنادى لحد ما الأدمن يفعّل الخاصية —
  // والتطبيق بيعرف ده من رفض `AUTH_009` على إنشاء الطلب، مش من فحص مسبق على كل حجز.

  /// بيطلب كود التأكيد. `newPhoneNumber` + `pin` = العميل بيصحّح رقمه (عاملين مستقلين).
  /// بيرجّع الرقم اللي الكود اتبعت له فعلاً عشان الشاشة تعرضه.
  Future<String> requestPhoneVerification({String? newPhoneNumber, String? pin}) async {
    final data = await authedRequest(
      'POST',
      '/auth/phone/verification/request',
      body: {
        'new_phone_number': ?newPhoneNumber,
        'pin': ?pin,
      },
    );
    return (data?['target_phone_number'] as String?) ?? '';
  }

  /// بيأكّد الكود. لو `newPhoneNumber` موجود، رقم الحساب بيتغيّر في نفس العملية.
  /// بعد النجاح `/auth/me` بيتحدّث عشان الشاشات تشوف الرقم الجديد فورًا.
  Future<void> confirmPhoneVerification({required String otpCode, String? newPhoneNumber}) async {
    await authedRequest(
      'POST',
      '/auth/phone/verification/confirm',
      body: {
        'otp_code': otpCode,
        'new_phone_number': ?newPhoneNumber,
      },
    );
    await _fetchMe();
  }

  Future<Map<String, dynamic>?> authedRequest(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? extraHeaders,
  }) async {
    try {
      return await apiRequest(method, path, body: body, accessToken: _accessToken, extraHeaders: extraHeaders);
    } catch (errRaw) {
      // أي استثناء (كاست عقد، تحليل JSON، بَقّة) بيتحوّل لرسالة —
      // مايتسابش يهرب فيسيب الشاشة معلّقة على التحميل للأبد.
      final err = ApiException.from(errRaw);
      if (err.statusCode == 401) {
        final newToken = await _refresh();
        return apiRequest(method, path, body: body, accessToken: newToken, extraHeaders: extraHeaders);
      }
      rethrow;
    }
  }

  // زي authedRequest بس لـ endpoints بترجع قايمة (GET بس، مفيش داعي لـ body).
  Future<List<Map<String, dynamic>>> authedRequestList(String path) async {
    try {
      return await apiRequestList(path, accessToken: _accessToken);
    } catch (errRaw) {
      // أي استثناء (كاست عقد، تحليل JSON، بَقّة) بيتحوّل لرسالة —
      // مايتسابش يهرب فيسيب الشاشة معلّقة على التحميل للأبد.
      final err = ApiException.from(errRaw);
      if (err.statusCode == 401) {
        final newToken = await _refresh();
        return apiRequestList(path, accessToken: newToken);
      }
      rethrow;
    }
  }

  /// زي `authedRequestList` بس لـendpoint مُقسّم صفحات (`{items, meta}` عند الكونترولر).
  ///
  /// لازم يتستخدم مع `/orders` وأي endpoint شبهه — `authedRequest()` بيرمي `BAD_RESPONSE`
  /// معاهم لأن الـ`ResponseInterceptor` بيحط القايمة في `data` و`meta` جنبها.
  Future<ApiPage> authedRequestPage(String path) async {
    try {
      return await apiRequestPage(path, accessToken: _accessToken);
    } catch (errRaw) {
      // أي استثناء (كاست عقد، تحليل JSON، بَقّة) بيتحوّل لرسالة —
      // مايتسابش يهرب فيسيب الشاشة معلّقة على التحميل للأبد.
      final err = ApiException.from(errRaw);
      if (err.statusCode == 401) {
        final newToken = await _refresh();
        return apiRequestPage(path, accessToken: newToken);
      }
      rethrow;
    }
  }

  // زي authedRequest بس لرفع ملف (multipart) — نفس نمط 401→refresh→إعادة محاولة مرة واحدة.
  Future<Map<String, dynamic>?> authedUpload(
    String path, {
    required List<int> fileBytes,
    required String filename,
    Map<String, String> fields = const {},
  }) async {
    try {
      return await apiUpload(path, fileBytes: fileBytes, filename: filename, fields: fields, accessToken: _accessToken);
    } catch (errRaw) {
      // أي استثناء (كاست عقد، تحليل JSON، بَقّة) بيتحوّل لرسالة —
      // مايتسابش يهرب فيسيب الشاشة معلّقة على التحميل للأبد.
      final err = ApiException.from(errRaw);
      if (err.statusCode == 401) {
        final newToken = await _refresh();
        return apiUpload(path, fileBytes: fileBytes, filename: filename, fields: fields, accessToken: newToken);
      }
      rethrow;
    }
  }
}
