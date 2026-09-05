import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module';
import { HealthController } from './health.controller';

@Module({
  // `DbPoolMonitorService` جاي من هنا — أرقام الـpool جزء من رد الصحة نفسه.
  imports: [DatabaseModule],
  controllers: [HealthController],
})
export class HealthModule {}
