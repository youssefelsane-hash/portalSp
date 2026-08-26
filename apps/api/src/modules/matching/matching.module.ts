import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { SettingsModule } from '../settings/settings.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { Order } from '../orders/entities/order.entity';
import { MatchingRoundExpiryProcessor } from './matching-round-expiry.processor';
import { MATCHING_ROUNDS_QUEUE } from './matching-rounds.queue';
import { MatchingDeferredDispatchProcessor } from './matching-deferred-dispatch.processor';
import { MATCHING_DISPATCH_QUEUE } from './matching-dispatch.queue';
import { MatchingService } from './matching.service';
import { MatchingExplainabilityService } from './matching-explainability.service';
import { MatchingRecoveryService } from './matching-recovery.service';
import { OrderDispatchListener } from './order-dispatch.listener';
import { OrderRematchListener } from './order-rematch.listener';
import { TechnicianOrdersController } from './technician-orders.controller';
import { OrderAssignment } from './entities/order-assignment.entity';
import { PricingModule } from '../pricing/pricing.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  // كانت الوحدة دي بتستورد OrdersModule بالكامل — بَقّة حقيقية اتلقطت واتصلحت (تفاصيل في
  // orders/README.md): مفيش أي كود هنا بيحقن OrdersService فعلياً (الاستخدام الوحيد لـ
  // OrderStatusHistory هو `manager.create()` جوّه transaction، وده بيشتغل عالمياً عبر
  // DataSource مش محتاج Repository مُحقن)، فالاستيراد كان بيفرض ترتيب تحميل OrdersModule
  // قبل MatchingModule دايماً — وده كان بيخلي أي مسار حرفي (زي `available`) في هنا يتسجّل
  // *بعد* `GET /technician/orders/:id` في OrdersModule، فـ NestJS كان بيطابق `:id` الأول
  // ويرفض "available" كـ UUID غلط. Order لسه لازم لـ TypeOrmModule.forFeature بس (استعلامات
  // ST_Distance المباشرة)، بدون الموديول كله.
  imports: [
    TypeOrmModule.forFeature([OrderAssignment, Order]),
    TechniciansModule,
    SettingsModule,
    // CustomersModule (AddressesService، لعنوان الطلب وقت القبول — للملاحة في apps/technician-app)
    // — عمداً مش OrdersModule زي التحذير فوق. CustomersModule بتاعته controller مختلف تماماً
    // (/addresses) ومفيش أي استيراد لـ OrdersModule جواها، فمفيش نفس فخ ترتيب التسجيل.
    CustomersModule,
    CatalogModule,
    PaymentsModule,
    // docs/08 §60.3 — فرق "الفني المميّز" بعد التعيين التلقائي (LevelPremiumService).
    // **بَقّة إقلاع حقيقية اتلقطت لما شغّلت التطبيق فعليًا**: الحقن اتضاف في MatchingService
    // من غير الاستيراد ده، فـ`npx nest build` و`npx jest` عدّوا نضاف (الاتنين مابيبنوش حاوية
    // الـDI الحقيقية) والتطبيق كان بيموت وقت الإقلاع بـ"Nest can't resolve dependencies".
    // الدرس: أي حقن جديد في خدمة لازم يتأكد بإقلاع فعلي، مش بالبناء والاختبارات بس.
    PricingModule,
    BullModule.registerQueue({ name: MATCHING_ROUNDS_QUEUE }, { name: MATCHING_DISPATCH_QUEUE }),
  ],
  controllers: [TechnicianOrdersController],
  providers: [
    MatchingService,
    MatchingExplainabilityService,
    MatchingRecoveryService,
    OrderDispatchListener,
    OrderRematchListener,
    MatchingRoundExpiryProcessor,
    MatchingDeferredDispatchProcessor,
  ],
  exports: [MatchingService, MatchingExplainabilityService],
})
export class MatchingModule {}
