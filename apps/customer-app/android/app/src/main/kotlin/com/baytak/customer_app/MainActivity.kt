package com.baytak.customer_app

import io.flutter.embedding.android.FlutterFragmentActivity

// FlutterFragmentActivity إجباري (مش FlutterActivity العادي) — local_auth (docs/08 §17.22)
// بيستخدم BiometricPrompt اللي محتاج FragmentActivity حقيقي عشان يشتغل على Android.
class MainActivity : FlutterFragmentActivity()
