import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix(config.get<string>('apiPrefix')!);
  app.enableCors();
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
