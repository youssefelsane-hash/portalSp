import { ValidationPipe } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';

export class StrictWebsocketValidationPipe extends ValidationPipe {
  constructor() {
    super({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) =>
        new WsException({
          code: 'VAL_001',
          message:
            errors
              .map((error) => Object.values(error.constraints ?? {}).join(', '))
              .filter(Boolean)
              .join(' | ') || 'بيانات realtime غير صحيحة',
        }),
    });
  }
}
