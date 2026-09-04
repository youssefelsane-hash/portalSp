import 'reflect-metadata';
import { resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureHttpLayer } from './http-bootstrap';

// شبكة أمان — بدون هيّ أي rejection ملوش .catch (زي اللي كانت بتحصل جوّه BullMQ Worker وقت
// انقطاع Redis) كانت بتوقف الـ event loop المعني بصمت تام من غير أي أثر في اللوج، وده صعّب
// تشخيص بَقّة "الـ Worker مابيرجعش يشتغل بعد رجوع Redis" جداً. دلوقتي أي rejection غير متوقعة
// بتتسجّل صريح بدل ما تختفي.
process.on('unhandledRejection', (reason) => {
   
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

  // كل تركيب طبقة الـHTTP (helmet ← prefix ← CORS ← static ← pipes) في مكان واحد مُختبَر —
  // الترتيب نفسه هو السلوك، راجع http-bootstrap.ts.
  configureHttpLayer(app, {
    uploadsDir: resolve(config.get<string>('storage.localDir')!),
    apiPrefix: config.get<string>('apiPrefix')!,
    corsOrigins: config.get<string[]>('security.corsOrigins')!,
  });

  const port = config.get<number>('port')!;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`baytak api شغال على http://localhost:${port}/${config.get<string>('apiPrefix')}`);
}

// `bootstrap()` بلا معالجة كان بيخلّي أي فشل إقلاع (Postgres واقع، بورت مشغول، إعداد ناقص)
// يطلع كـunhandled rejection بستاك خام. الرسالة الواضحة + خروج بكود ١ أنفع لأي مشغّل/CI.
bootstrap().catch((err) => {
  console.error('فشل إقلاع baytak api:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
