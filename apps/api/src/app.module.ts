import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { PermissionsGuard } from './common/guards/permissions.guard';
import { StepUpGuard } from './common/guards/step-up.guard';
import { AuthModule } from './modules/auth/auth.module';
import { GeoModule } from './modules/geo/geo.module';
import { CustomersModule } from './modules/customers/customers.module';
import { TechniciansModule } from './modules/technicians/technicians.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { OrdersModule } from './modules/orders/orders.module';
import { MatchingModule } from './modules/matching/matching.module';
import { OperationsModule } from './modules/operations/operations.module';
import { AssistantMatchingModule } from './modules/assistant-matching/assistant-matching.module';
import { ChatModule } from './modules/chat/chat.module';
import { InternalChatModule } from './modules/internal-chat/internal-chat.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { SupportModule } from './modules/support/support.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { TechnicianReferralsModule } from './modules/technician-referrals/technician-referrals.module';
import { TechnicianKpiModule } from './modules/technician-kpi/technician-kpi.module';
import { TechnicianProgressionModule } from './modules/technician-progression/technician-progression.module';
import { AdminModule } from './modules/admin/admin.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { HealthModule } from './modules/common/health/health.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { BuildingsModule } from './modules/buildings/buildings.module';
import { AcademyModule } from './modules/academy/academy.module';
import { OpsModule } from './modules/ops/ops.module';
import { BrandingModule } from './modules/branding/branding.module';
import { TechnicianProductivityModule } from './modules/technician-productivity/technician-productivity.module';
import { SecurityModule } from './modules/security/security.module';

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
    // اتسجّل هنا مرة واحدة (مش في كل موديول محتاج طابور) — أي موديول يقدر يستخدم
    // BullModule.registerQueue() بعد كده من غير ما يعيد ضبط الاتصال بـ Redis. الاتصال ده
    // بيتستخدم من الـ Queue (producer, .add()) — الـ Workers (consumers) ليهم اتصال منفصل
    // بيتحدد مباشرة جوّه كل @Processor() (راجع technician-stats.processor.ts للتفاصيل
    // الكاملة ليه؛ باختصار: BullModule.forRootAsync(configKey, ...) + @Processor({configKey})
    // بيتجاهله @nestjs/bullmq تماماً لو فيه Queue متسجّل بنفس الاسم بالفعل — بيرجع لاتصال الـ
    // Queue الافتراضي عادي، فمفيش طريقة تانية غير override مباشر لـ connection في الـ Worker).
    //
    // enableOfflineQueue: false ضروري هنا — ioredis افتراضياً بيحجز أي أمر (زي queue.add()) في
    // طابور داخلي لحد ما يرجع يتصل، يعني queue.add() هيفضل معلّق (await من غير reject ولا
    // resolve) للأبد لو Redis واقع، وده كان بيعلّق الطلب الحقيقي كله (تقييم، دفع) مش بس فشل
    // التوزيع الخلفي — اتلقطت البَقّة دي فعلياً وقت اختبار حي (طلب rating علّق أكتر من دقيقتين).
    // بالإعداد ده، أي أمر بيتبعت والاتصال مقطوع بيترفض فوراً بدل ما يستنى، فالـ try/catch في
    // enqueueRecalculation() (وأي مكان تاني بيستخدم طابور) يقدر يتلقّطه ويكمّل بدون ما يعلّق المستخدم.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('redis.url'),
          enableOfflineQueue: false,
          maxRetriesPerRequest: null,
          retryStrategy: (times: number) => Math.min(times * 200, 5000),
        },
      }),
    }),
    DatabaseModule,
    AuthModule,
    GeoModule,
    CustomersModule,
    TechniciansModule,
    CatalogModule,
    PricingModule,
    BuildingsModule,
    // MatchingModule قبل OrdersModule عمداً — تفاصيل كاملة في matching/matching.module.ts.
    // NestJS بيسجّل مسارات الـ controllers بترتيب تحميل الموديولات، ومسارات حرفية زي
    // GET /technician/orders/available (في MatchingModule) لازم تتسجّل قبل GET
    // /technician/orders/:id (في OrdersModule) وإلا الـ ParseUUIDPipe بترفض "available" كـ id غلط.
    MatchingModule,
    OrdersModule,
    // مركز العمليات (docs/08 §36.2 فصاعدًا) — موديول مستقل، صفر تعارض ترتيب مسارات (بادئة
    // admin/operations خاصة بيه بالكامل).
    OperationsModule,
    // مكانها هنا تنظيمي بس — بتسمع ORDER_ACCEPTED_EVENT عبر EventEmitter2 العالمي، مفيش أي
    // كوبلينج فعلي على ترتيب التحميل زي تحذير matching.module.ts.
    AssistantMatchingModule,
    ChatModule,
    InternalChatModule,
    PaymentsModule,
    RatingsModule,
    SupportModule,
    NotificationsModule,
    PromotionsModule,
    ReferralsModule,
    FavoritesModule,
    TechnicianReferralsModule,
    TechnicianKpiModule,
    TechnicianProgressionModule,
    AdminModule,
    FeatureFlagsModule,
    HealthModule,
    AcademyModule,
    OpsModule,
    BrandingModule,
    TechnicianProductivityModule,
    SecurityModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: StepUpGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
