import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsModule } from '../settings/settings.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { Order } from '../orders/entities/order.entity';
import { OrderTeamMember } from '../orders/entities/order-team-member.entity';
import { AssistantMatchingService } from './assistant-matching.service';
import { AssistantMatchingRecoveryService } from './assistant-matching-recovery.service';
import { AssistantOffersController } from './assistant-matching.controller';
import { AssistantOfferExpiryProcessor } from './assistant-offer-expiry.processor';
import { ASSISTANT_MATCHING_QUEUE } from './assistant-matching.queue';
import { OrderAssistantOffer } from './entities/order-assistant-offer.entity';
import { OrderAcceptedAssistantMatchingListener } from './order-accepted-assistant-matching.listener';

// مطابقة المساعد التلقائية (ADR-0007) — موديول منفصل عمداً عن matching (مفهوم مختلف: قبول
// تنافسي على "شريحة عمل" بعد ما القائد اتحدد، مش توزيع "طلب كامل"). Order/OrderTeamMember
// عبر TypeOrmModule.forFeature بس (مش OrdersModule كامل) — نفس تحذير matching.module.ts
// (استيراد OrdersModule بالكامل بيفرض ترتيب تحميل، والاستخدام هنا Repository بس).
@Module({
  imports: [
    TypeOrmModule.forFeature([OrderAssistantOffer, Order, OrderTeamMember]),
    TechniciansModule,
    SettingsModule,
    BullModule.registerQueue({ name: ASSISTANT_MATCHING_QUEUE }),
  ],
  controllers: [AssistantOffersController],
  providers: [
    AssistantMatchingService,
    AssistantMatchingRecoveryService,
    OrderAcceptedAssistantMatchingListener,
    AssistantOfferExpiryProcessor,
  ],
  exports: [AssistantMatchingService],
})
export class AssistantMatchingModule {}
