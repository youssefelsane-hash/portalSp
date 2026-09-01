import Flutter
import GoogleMaps
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // بوابة P0-2 في docs/23 — المفتاح كان مكتوب صراحةً هنا ومتتبَّع في git. بيتقرا دلوقتي من
    // `Info.plist` (المفتاح `GoogleMapsApiKey`)، اللي بياخد قيمته من xcconfig غير متتبَّع.
    // لو مش موجود، الخرائط مش بتتفعّل بدل ما نشحن مفتاح مسرّب — والتطبيق بيفضل شغّال عادي.
    if let mapsApiKey = Bundle.main.object(forInfoDictionaryKey: "GoogleMapsApiKey") as? String,
       !mapsApiKey.isEmpty {
      GMSServices.provideAPIKey(mapsApiKey)
    } else {
      NSLog("[Maps] GoogleMapsApiKey مش متظبّط — الخرائط هتفضل معطّلة. راجع docs/23 بوابة P0-2.")
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }
}
