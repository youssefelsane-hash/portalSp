// CORS ديناميكي لبوابات WebSocket (docs/08 §19 بند 21) — كانت فجوة حقيقية: ChatGateway/
// OrderTrackingGateway كانوا بيثبتوا `cors: { origin: '*' }` مباشرة في خيارات `@WebSocketGateway()`،
// يعني حتى لو `CORS_ORIGIN` اتظبطت صح للـREST API (main.ts، مفروضة إجباريًا في الإنتاج عبر
// env.validation.ts)، بوابات الـWebSocket كانت بتفضل مفتوحة للكل بلا أي علاقة بالإعداد ده — أصل
// خبيث كان يقدر يفتح اتصال WebSocket من متصفح ويستغل أي CSRF-like ثغرة لو الـJWT كان بيتخزن بطريقة
// عرضة (مش الحال هنا فعليًا — Bearer/handshake.auth مش cookie — بس القيد جزء من "دفاع بعمق" زي
// main.ts نفسه).
//
// **ليه function مش array ثابتة في الـdecorator**: خيارات `@WebSocketGateway({...})` بتتقيّم وقت
// تحميل الملف (module-load time)، **قبل** ما NestJS يبدأ يشغّل `ConfigModule`/`dotenv` فعليًا —
// فقراءة `process.env.CORS_ORIGIN` مباشرة في وقت التقييم ده مش مضمونة تلاقي القيمة اتحطت. الحل:
// نمرّر *function* لـ`cors.origin` (socket.io/engine.io بيدعموها رسميًا) بتتنفّذ **مع كل اتصال
// جديد فعليًا وقت runtime**، مش وقت التحميل — ووقت أول اتصال حقيقي، الـserver يكون بدأ `listen()`
// بالفعل (بعد ما `ConfigModule`/`dotenv` خلصوا تحميل الـenv) فالقيمة مضمونة تكون جاهزة.
export function websocketCorsOriginHandler(
  requestOrigin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  const configured = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured.length === 0) {
    // فاضي = مفتوح للكل — نفس فلسفة main.ts بالحرف. مقبول تطويريًا، مرفوض صراحة وقت إقلاع
    // الـREST API في الإنتاج (env.validation.ts) فمينفعش يوصل هنا أصلاً بـNODE_ENV=production
    // من غير CORS_ORIGIN مضبوطة.
    callback(null, true);
    return;
  }

  callback(null, !requestOrigin || configured.includes(requestOrigin));
}
