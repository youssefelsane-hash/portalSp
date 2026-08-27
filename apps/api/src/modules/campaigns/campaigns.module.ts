import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminCampaignsController } from './admin-campaigns.controller';
import { AdminCampaignsService } from './admin-campaigns.service';
import { CampaignSweepService } from './campaign-sweep.service';
import { CampaignsService } from './campaigns.service';
import { CustomerCampaignsController } from './customer-campaigns.controller';
import { CustomerServiceIntent } from './entities/customer-service-intent.entity';
import { NotificationCampaign } from './entities/notification-campaign.entity';
import { NotificationCampaignSend } from './entities/notification-campaign-send.entity';

/**
 * محرك حملات التسويق (ADR-0046) — **موديول معزول بالكامل**.
 *
 * بيستهلك `NotificationsModule` من برّه زي أي مستهلك تاني، ومش بيستورد orders/matching/payments
 * ولا بيتم استيراده منهم. ده مقصود: الميزة تسويقية بحتة، وأسوأ فشل ممكن فيها هو إن إعلان
 * ما اتبعتش — مستحيل تعطّل حجز حقيقي.
 *
 * `CustomerProfile` مسجّل هنا مباشرة (مش استيراد CustomersModule كامل) — نفس نمط تسجيل كيان
 * من موديول تاني المتّبع في TechniciansModule، بيتجنّب أي دورة استيراد.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationCampaign, NotificationCampaignSend, CustomerServiceIntent, CustomerProfile]),
    NotificationsModule,
    SettingsModule,
    AuditModule,
  ],
  controllers: [AdminCampaignsController, CustomerCampaignsController],
  providers: [CampaignsService, AdminCampaignsService, CampaignSweepService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
