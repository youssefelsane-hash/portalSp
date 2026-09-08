import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { ApiException, ErrorCode } from './common/exceptions/api.exception';

/** الحد الأدنى اللي محتاجينه من `NestExpressApplication` — مكتوب كواجهة صريحة عشان
 * `configureHttpLayer` تبقى قابلة للاختبار من غير ما نقوم تطبيق Nest كامل في السبيك. */
export interface HttpLayerTarget {
  use(...handlers: unknown[]): unknown;
  set(key: string, value: unknown): unknown;
  setGlobalPrefix(prefix: string): unknown;
  enableCors(options: unknown): unknown;
  useStaticAssets(path: string, options?: { prefix?: string }): unknown;
  useGlobalPipes(...pipes: unknown[]): unknown;
}

export interface HttpLayerOptions {
  uploadsDir: string;
  apiPrefix: string;
  corsOrigins: string[];
  /** عدد الـproxies الموثوقة بين العميل والتطبيق (راجع الشرح جوّه `configureHttpLayer`). */
  trustedProxyHops: number;
}

/**
 * تركيب طبقة الـHTTP كلها بترتيب مقصود. **الترتيب هنا مش تفصيلة تجميلية** — express بينفّذ
 * الـmiddleware بترتيب التسجيل بالظبط، فأي تبديل بيغيّر السلوك فعليًا. `http-bootstrap.spec.ts`
 * بيقفل على الترتيب ده صراحة.
 */
export function configureHttpLayer(app: HttpLayerTarget, options: HttpLayerOptions): void {
  // 0) **الثقة في الـproxy — لازم تيجي قبل أي حاجة بتقرا `req.ip`** (تدقيق `docs/29` P0-2).
  //
  // من غير السطر ده، Express بيرجّع في `req.ip` عنوان **الـload balancer** مش العميل، لأن ده
  // فعلًا الطرف اللي فاتح الـsocket. و`@nestjs/throttler` بيتعقّب بالـ`req.ip` افتراضيًا،
  // فالنتيجة إن **كل عملاء المنصة بيتحسبوا شخص واحد**: السقف العام (٦٠/دقيقة) بيقف المنصة كلها
  // عند طلب واحد في الثانية، و`/auth/otp/request` (٥/دقيقة) بيخلّي خمس عمليات تسجيل دخول
  // للمنصة **كلها** في الدقيقة. وكمان كل `audit_logs.ip_address` و`security_events` بتسجّل
  // عنوان الـload balancer، فسجل الأمان بيفقد قيمته التحقيقية بالكامل.
  //
  // **رقم مش `true`**: `trust proxy: true` معناها «صدّق أي `X-Forwarded-For`»، وده بيخلّي أي
  // حد يزوّر الهيدر وياخد هوية شبكية تانية (يتخطى الـthrottle أو يلوّث سجل الأمان). الرقم
  // بيقول «صدّق آخر N قفزة موثوقة بس» — القيمة بتختلف حسب النشر (Railway = 1، nginx محلي = 1،
  // CDN + LB = 2)، فهي من env مش مكتوبة في الكود.
  app.set('trust proxy', options.trustedProxyHops);

  // 1) رؤوس أمان قياسية (X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security،
  // إلخ) — API JSON بحت من غير أي صفحة HTML مُصيَّرة، فـcontentSecurityPolicy معطّلة عمداً
  // (قيمتها الحقيقية ضد XSS في صفحات HTML، مش موجودة هنا) بدل ما تضيف تعقيد من غير فايدة.
  // crossOriginResourcePolicy لازم 'cross-origin' صراحة — صور /uploads/* (طلبات/مستندات فنيين)
  // بتتحمّل من أصل مختلف (لوحة الأدمن على subdomain تاني، تطبيقات Flutter) في الإنتاج.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.setGlobalPrefix(options.apiPrefix);

  // 2) أصول الـCORS من env.validation.ts (CORS_ORIGIN) — فاضي = مفتوح للكل (`*`)، مقبول تطويريًا
  // بس، مرفوض صراحة وقت الإقلاع لو NODE_ENV=production (راجع env.validation.ts). الـJWT بيتبعت
  // كـBearer header مش cookie، فمفيش credentials تتسرّب حتى لو الأصل مفتوح — القيد ده طبقة
  // دفاع إضافية (defense-in-depth)، مش الحماية الوحيدة.
  if (options.corsOrigins.length === 0) {
    Logger.warn('CORS مفتوح للكل (*) — لازم CORS_ORIGIN يتحدد صراحة قبل أي نشر إنتاجي.', 'Bootstrap');
  }
  app.enableCors({ origin: options.corsOrigins.length > 0 ? options.corsOrigins : '*' });

  // 3) كانت بَقّة حقيقية: LocalDiskStorageService بيكتب الملفات فعلياً وبيرجّع رابط `/uploads/...`،
  // بس مفيش حاجة كانت بتخدمها فوق HTTP — أي `file_url` راجع من order-media كان رابط ميت 404.
  // بره الـ globalPrefix عمداً (نفس شكل الرابط اللي already بيترجع من LocalDiskStorageService.save()).
  //
  // وبَقّة تانية حقيقية فوقها (بلاغ مالك 2026-08-25، docs/08 §59): السطر ده كان **فوق** helmet
  // وenableCors. express.static بيرد على الملف الموجود ويقفل السلسلة من غير ما ينادي next()،
  // يعني ردود /uploads/* كانت بتخرج **بلا** Access-Control-Allow-Origin وبلا
  // Cross-Origin-Resource-Policy خالص — رغم إن الكومنت فوق helmet بيقول صراحة إن CORP مضبوطة
  // عشان صور /uploads تتحمّل من أصل مختلف. النتيجة كانت لوجو/سبلاش البراند وصور الطلبات مكسورة
  // في Flutter web (net::ERR_FAILED) وفي لوحة الأدمن على subdomain مختلف.
  app.useStaticAssets(options.uploadsDir, { prefix: '/uploads/' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new ApiException(
          ErrorCode.VAL_001,
          errors
            .map((e) => Object.values(e.constraints ?? {}).join(', '))
            .filter(Boolean)
            .join(' | ') || 'بيانات غير صحيحة',
        ),
    }),
  );
}
