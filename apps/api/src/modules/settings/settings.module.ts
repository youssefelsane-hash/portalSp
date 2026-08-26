import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { AuditModule } from '../audit/audit.module';
import { Setting } from './entities/setting.entity';
import { HomepageContentController } from './homepage-content.controller';
import { SettingsService } from './settings.service';
import { SupportContactController } from './support-contact.controller';
import { BookingPolicyController } from './booking-policy.controller';

// موديول خفيف مستقل زي AuditModule بالظبط — settings.default_commission_percent
// وأمثالها لازم تتقرا من موديولات كتير (payments, matching, orders, ...) من غير
// ما أي حد فيهم يعتمد على admin نفسه.
@Module({
  imports: [TypeOrmModule.forFeature([Setting]), AuditModule],
  controllers: [BookingPolicyController, SupportContactController, HomepageContentController],
  providers: [SettingsService, RedisCacheService],
  exports: [SettingsService],
})
export class SettingsModule {}
