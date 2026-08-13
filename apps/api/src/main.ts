import 'reflect-metadata';
import { resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ApiException, ErrorCode } from './common/exceptions/api.exception';

// شبكة أمان — بدون هيّ أي rejection ملوش .catch (زي اللي كانت بتحصل جوّه BullMQ Worker وقت
// انقطاع Redis) كانت بتوقف الـ event loop المعني بصمت تام من غير أي أثر في اللوج، وده صعّب
// تشخيص بَقّة "الـ Worker مابيرجعش يشتغل بعد رجوع Redis" جداً. دلوقتي أي rejection غير متوقعة
// بتتسجّل صريح بدل ما تختفي.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled Rejection:', reason);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // لازم عشان onModuleDestroy hooks (زي إغلاق اتصالات DB/Redis، وclearInterval بتاع
  // QueueWatchdogService) تتنفّذ فعليًا وقت SIGTERM — من غير كده NestJS معندهوش أي listener
  // للإشارة دي افتراضيًا، فsystemd/docker بيضطروا يستنوا TimeoutStopSec كامل ثم SIGKILL قسري
  // بدل إغلاق نظيف. جزء من خطة supervisor/restart الكاملة (infra/systemd/baytak-api.service).
  app.enableShutdownHooks();

  // كانت بَقّة حقيقية: LocalDiskStorageService بيكتب الملفات فعلياً وبيرجّع رابط `/uploads/...`،
  // بس مفيش حاجة كانت بتخدمها فوق HTTP — أي `file_url` راجع من order-media كان رابط ميت 404.
  // بره الـ globalPrefix عمداً (نفس شكل الرابط اللي already بيترجع من LocalDiskStorageService.save()).
  app.useStaticAssets(resolve(config.get<string>('storage.localDir')!), { prefix: '/uploads/' });

  // رؤوس أمان قياسية (X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security،
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

  app.setGlobalPrefix(config.get<string>('apiPrefix')!);

  // أصول الـCORS من env.validation.ts (CORS_ORIGIN) — فاضي = مفتوح للكل (`*`)، مقبول تطويريًا
  // بس، مرفوض صراحة وقت الإقلاع لو NODE_ENV=production (راجع env.validation.ts). الـJWT بيتبعت
  // كـBearer header مش cookie، فمفيش credentials تتسرّب حتى لو الأصل مفتوح — القيد ده طبقة
  // دفاع إضافية (defense-in-depth)، مش الحماية الوحيدة.
  const corsOrigins = config.get<string[]>('security.corsOrigins')!;
  if (corsOrigins.length === 0) {
    Logger.warn('CORS مفتوح للكل (*) — لازم CORS_ORIGIN يتحدد صراحة قبل أي نشر إنتاجي.', 'Bootstrap');
  }
  app.enableCors({ origin: corsOrigins.length > 0 ? corsOrigins : '*' });

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

  const port = config.get<number>('port')!;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`baytak api شغال على http://localhost:${port}/${config.get<string>('apiPrefix')}`);
}

bootstrap();
