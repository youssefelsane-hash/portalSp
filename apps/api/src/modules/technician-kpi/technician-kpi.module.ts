import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from '../admin/admin.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettingsModule } from '../settings/settings.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { AdminTechnicianKpiController } from './admin-technician-kpi.controller';
import { TechnicianKpiSnapshot } from './entities/technician-kpi-snapshot.entity';
import { TechnicianKpiCalculationService } from './technician-kpi-calculation.service';
import { TechnicianKpiController } from './technician-kpi.controller';
import { TechnicianKpiService } from './technician-kpi.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TechnicianKpiSnapshot, TechnicianProfile]),
    SettingsModule,
    PaymentsModule,
    AuditModule,
    NotificationsModule,
    TechniciansModule,
    AdminModule,
  ],
  controllers: [AdminTechnicianKpiController, TechnicianKpiController],
  providers: [TechnicianKpiService, TechnicianKpiCalculationService],
  exports: [TechnicianKpiService],
})
export class TechnicianKpiModule {}
