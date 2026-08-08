// عنوان الباك-إند — Android emulator بيوصل للـ host عن طريق 10.0.2.2 مش localhost،
// iOS simulator بيقدر يستخدم localhost عادي. مفيش .env حقيقي في Flutter بدون حزمة إضافية
// (flutter_dotenv)، فمؤقتاً ثابت هنا لحد ما نحتاج فعلياً نفرّق بين بيئات (dev/staging/prod).
const String apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000/api/v1',
);
