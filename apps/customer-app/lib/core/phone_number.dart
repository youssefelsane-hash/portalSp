/// Keep the API's E.164 identity while letting Egyptian users type 01... naturally.
String phoneNumberForApi(String input) {
  final phone = input.trim().replaceAll(RegExp(r'[\s()-]'), '');
  if (RegExp(r'^01[0125][0-9]{8}$').hasMatch(phone)) {
    return '+20${phone.substring(1)}';
  }
  return phone;
}

bool isValidPhoneInput(String input) =>
    RegExp(r'^\+[1-9][0-9]{7,14}$').hasMatch(phoneNumberForApi(input));

String phoneNumberForDisplay(String input) {
  final phone = input.trim();
  if (RegExp(r'^\+201[0125][0-9]{8}$').hasMatch(phone)) {
    return '0${phone.substring(3)}';
  }
  return phone;
}
