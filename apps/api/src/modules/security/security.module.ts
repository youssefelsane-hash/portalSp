import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { SettingsModule } from '../settings/settings.module';
import { AdminSecurityController } from './admin-security.controller';
import { AdminWorkforceController } from './admin-workforce.controller';
import { EmployeeDailyActivity } from './entities/employee-daily-activity.entity';
import { SecurityEventNote } from './entities/security-event-note.entity';
import { SecurityEvent } from './entities/security-event.entity';
import { SecurityEventsService } from './security-events.service';
import { WorkforceActivityService } from './workforce-activity.service';

// Script 5 (docs/adr/0016) — نموذج Security Event + نشاط/جلسات الموظفين. موديول مستقل (زي
// AuditModule/SettingsModule بالظبط) عشان PermissionsGuard/StepUpGuard/PermissionsService
// (المسجّلين global في AppModule) يقدروا يحقنوا SecurityEventsService بلا أي دورة استيراد.
@Module({
  imports: [TypeOrmModule.forFeature([SecurityEvent, SecurityEventNote, EmployeeDailyActivity, RefreshToken]), AuditModule, SettingsModule],
  controllers: [AdminSecurityController, AdminWorkforceController],
  providers: [SecurityEventsService, WorkforceActivityService],
  exports: [SecurityEventsService, WorkforceActivityService],
})
export class SecurityModule {}
