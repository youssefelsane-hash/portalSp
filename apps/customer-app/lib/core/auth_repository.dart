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

  BaytakUser({required this.id, required this.phoneNumber, required this.fullName, required this.userType});

  factory BaytakUser.fromJson(Map<String, dynamic> json) => BaytakUser(
        id: json['id'] as String,
        phoneNumber: json['phone_number'] as String,
        fullName: json['full_name'] as String,
        userType: json['user_type'] as String,
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
    final storedRefreshToken = await _secureStorage.read(key: _refreshTokenKey);
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
  Future<void> _persistRefreshToken(String refreshToken) async {
    try {
      await _secureStorage.write(key: _refreshTokenKey, value: refreshToken);
    } catch (e) {
      debugPrint('فشل حفظ refresh_token بأمان — الجلسة الحالية سليمة، بس مش هتفضل بعد إعادة فتح التطبيق: $e');
    }
  }

  Future<void> init() async {
    try {
      final storedRefreshToken = await _secureStorage.read(key: _refreshTokenKey);
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
  /// لمسار OTP العادي في الحالتين.
  Future<bool> unlockWithBiometrics() async {
    final authenticated = await BiometricAuthService.authenticate(reason: 'افتح صُنّاع ببصمتك');
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

  /// "استخدم رقم موبايلك بدلاً" — بيقفل شاشة البصمة ويوديك لمسار OTP العادي (LoginScreen) من
  /// غير ما يمسح الجلسة المحفوظة (لو المستخدم رجع بعدين ممكن يجرّب البصمة تاني بدل ما يتسجّل
  /// خروج كامل قسرًا لمجرد إنه اختار يفضّل الرقم المرة دي).
  void useOtpInsteadOfBiometrics() {
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

  Future<void> requestOtp(String phoneNumber, {String purpose = 'login'}) async {
    await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': purpose});
  }

  Future<void> verifyOtp(String phoneNumber, String otpCode) async {
    final data = await apiRequest(
      'POST',
      '/auth/otp/verify',
      body: {'phone_number': phoneNumber, 'otp_code': otpCode},
    );
    _accessToken = data!['access_token'] as String;
    await _persistRefreshToken(data['refresh_token'] as String);
    await _fetchMe();
    _registerPushDeviceInBackground();
    notifyListeners();
  }

  // تسجيل عميل جديد (كانت فجوة موثّقة صراحة: Customer App عندها OTP login بس، بيفترض ضمنيًا إن
  // اليوزر موجود بالفعل — POST /auth/register كان جاهز ومختبر في الباك-إند بلا أي شاشة تستخدمه).
  // نفس شكل verifyOtp تمامًا (بيرجّع token pair مباشرة) بس بمعامل full_name إضافي + user_type
  // ثابت 'customer' (التطبيق ده للعميل بس — الفني له تطبيقه الخاص).
  Future<void> register(
    String phoneNumber,
    String otpCode,
    String fullName, {
    String? referralCode,
    String? technicianReferralCode,
  }) async {
    final data = await apiRequest(
      'POST',
      '/auth/register',
      body: {
        'phone_number': phoneNumber,
        'otp_code': otpCode,
        'full_name': fullName,
        'user_type': 'customer',
        if (referralCode != null && referralCode.isNotEmpty) 'referral_code': referralCode,
        // ترشيح QR فني (docs/11 §1) — منفصل تمامًا عن referral_code فوق (ترشيح عميل-لعميل).
        if (technicianReferralCode != null && technicianReferralCode.isNotEmpty)
          'technician_referral_code': technicianReferralCode,
      },
    );
    _accessToken = data!['access_token'] as String;
    await _persistRefreshToken(data['refresh_token'] as String);
    await _fetchMe();
    _registerPushDeviceInBackground();
    notifyListeners();
  }

  Future<void> logout() async {
    final storedRefreshToken = await _secureStorage.read(key: _refreshTokenKey);
    if (storedRefreshToken != null) {
      await apiRequest('POST', '/auth/logout', body: {'refresh_token': storedRefreshToken}).catchError((_) => null);
    }
    await _secureStorage.delete(key: _refreshTokenKey);
    _accessToken = null;
    _user = null;
    notifyListeners();
  }

  // نداء API موثّق — لو access_token منتهي (401)، يجرّب refresh (single-flight) مرة واحدة ويعيد المحاولة.
  Future<Map<String, dynamic>?> authedRequest(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? extraHeaders,
  }) async {
    try {
      return await apiRequest(method, path, body: body, accessToken: _accessToken, extraHeaders: extraHeaders);
    } on ApiException catch (err) {
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
    } on ApiException catch (err) {
      if (err.statusCode == 401) {
        final newToken = await _refresh();
        return apiRequestList(path, accessToken: newToken);
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
    } on ApiException catch (err) {
      if (err.statusCode == 401) {
        final newToken = await _refresh();
        return apiUpload(path, fileBytes: fileBytes, filename: filename, fields: fields, accessToken: newToken);
      }
      rethrow;
    }
  }
}
