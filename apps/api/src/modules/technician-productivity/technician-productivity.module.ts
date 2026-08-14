import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsModule } from '../settings/settings.module';
import { TechnicianKpiSnapshot } from '../technician-kpi/entities/technician-kpi-snapshot.entity';
import { AdminTechnicianProductivityController } from './admin-technician-productivity.controller';
import { TechnicianProductivityService } from './technician-productivity.service';

@Module({
  imports: [TypeOrmModule.forFeature([TechnicianKpiSnapshot]), SettingsModule],
  controllers: [AdminTechnicianProductivityController],
  providers: [TechnicianProductivityService],
  exports: [TechnicianProductivityService],
})
export class TechnicianProductivityModule {}
