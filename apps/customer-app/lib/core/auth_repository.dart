import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'api_client.dart';
import 'api_exception.dart';

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
  Future<String>? _inFlightRefresh;

  String? get accessToken => _accessToken;
  BaytakUser? get user => _user;
  bool get isLoading => _isLoading;
  bool get isAuthenticated => _accessToken != null;

  // نفس بَقّة apps/admin بالظبط (راجع الـ README هناك): refresh_token بيتدوّر على كل استخدام،
  // وأي إعادة استخدام لتوكن اتلغى بتقفل كل جلسات المستخدم. الـ single-flight guard ده بيمنع
  // أكتر من نداء refresh متزامن (زي init() بيتنادى مرتين من حاجتين مختلفتين وقت الإقلاع).
  Future<String> _refresh() {
    return _inFlightRefresh ??= _doRefresh().whenComplete(() => _inFlightRefresh = null);
  }

  Future<String> _doRefresh() async {
    final storedRefreshToken = await _secureStorage.read(key: _refreshTokenKey);
    if (storedRefreshToken == null) {
      throw ApiException(code: 'AUTH_NO_SESSION', message: 'مفيش جلسة', statusCode: 401);
    }
    final data = await apiRequest('POST', '/auth/refresh', body: {'refresh_token': storedRefreshToken});
    final newAccessToken = data!['access_token'] as String;
    final newRefreshToken = data['refresh_token'] as String;
    await _secureStorage.write(key: _refreshTokenKey, value: newRefreshToken);
    _accessToken = newAccessToken;
    return newAccessToken;
  }

  Future<void> init() async {
    try {
      await _refresh();
      await _fetchMe();
    } catch (_) {
      _accessToken = null;
      _user = null;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> _fetchMe() async {
    final data = await apiRequest('GET', '/auth/me', accessToken: _accessToken);
    _user = BaytakUser.fromJson(data!);
  }

  Future<void> requestOtp(String phoneNumber) async {
    await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'login'});
  }

  Future<void> verifyOtp(String phoneNumber, String otpCode) async {
    final data = await apiRequest(
      'POST',
      '/auth/otp/verify',
      body: {'phone_number': phoneNumber, 'otp_code': otpCode},
    );
    _accessToken = data!['access_token'] as String;
    await _secureStorage.write(key: _refreshTokenKey, value: data['refresh_token'] as String);
    await _fetchMe();
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
  Future<Map<String, dynamic>?> authedRequest(String method, String path, {Map<String, dynamic>? body}) async {
    try {
      return await apiRequest(method, path, body: body, accessToken: _accessToken);
    } on ApiException catch (err) {
      if (err.statusCode == 401) {
        final newToken = await _refresh();
        return apiRequest(method, path, body: body, accessToken: newToken);
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
}
