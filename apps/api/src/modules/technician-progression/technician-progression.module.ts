import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { TechnicianLevelHistory } from '../technicians/entities/technician-level-history.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { AdminTechnicianProgressionController } from './admin-technician-progression.controller';
import { TechnicianProgressionRule } from './entities/technician-progression-rule.entity';
import { TechnicianProgressionStatus } from './entities/technician-progression-status.entity';
import { TechnicianProgressionCalculationService } from './technician-progression-calculation.service';
import { TechnicianProgressionController } from './technician-progression.controller';
import { TechnicianProgressionService } from './technician-progression.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TechnicianProgressionRule, TechnicianProgressionStatus, TechnicianProfile, TechnicianLevelHistory]),
    AuditModule,
    NotificationsModule,
    TechniciansModule,
  ],
  controllers: [AdminTechnicianProgressionController, TechnicianProgressionController],
  providers: [TechnicianProgressionService, TechnicianProgressionCalculationService],
  exports: [TechnicianProgressionService],
})
export class TechnicianProgressionModule {}
