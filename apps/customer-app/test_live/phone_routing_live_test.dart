// «الرقم ده مسجّل؟» من كود التطبيق الحقيقي ضد السيرفر الحقيقي (docs/08 §189 UX-2، ADR-0115).
import 'dart:io';

import 'package:customer_app/core/auth_repository.dart';
import 'package:flutter_test/flutter_test.dart';

import '_live_support.dart';

void main() {
  setUpAll(() => HttpOverrides.global = null);

  test('مسجّل ⇒ true، مش مسجّل ⇒ false، والشكل المحلي نفس الإجابة', () async {
    final phone = uniquePhone();
    await registerCustomer(phone, fullName: 'عميل توجيه حي');
    final auth = AuthRepository();

    expect(await auth.isPhoneRegistered(phone), isTrue);
    expect(await auth.isPhoneRegistered('0${phone.substring(3)}'), isTrue);
    expect(await auth.isPhoneRegistered(uniquePhone()), isFalse);
  });
}
