import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuthModule } from './modules/auth/auth.module';
import { GeoModule } from './modules/geo/geo.module';
import { CustomersModule } from './modules/customers/customers.module';
import { TechniciansModule } from './modules/technicians/technicians.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthModule } from './modules/common/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    EventEmitterModule.forRoot(),
    // 60 طلب/دقيقة لكل مستخدم افتراضياً — docs/01-master-plan.md §7.3
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
    DatabaseModule,
    AuthModule,
    GeoModule,
    CustomersModule,
    TechniciansModule,
    CatalogModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
