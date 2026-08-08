import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { storageServiceProvider } from '../../common/storage/storage.provider';
import { AuditModule } from '../audit/audit.module';
import { User } from '../auth/entities/user.entity';
import { GeoModule } from '../geo/geo.module';
import { AdminTechnicianCompaniesController } from './admin-technician-companies.controller';
import { AdminTechnicianLevelsController } from './admin-technician-levels.controller';
import { AdminTechniciansController } from './admin-technicians.controller';
import { AdminTechniciansService } from './admin-technicians.service';
import { TechnicianCompaniesController } from './technician-companies.controller';
import { TechnicianCompaniesService } from './technician-companies.service';
import { TechnicianLevelsService } from './technician-levels.service';
import { TechniciansController } from './technicians.controller';
import { TechniciansService } from './technicians.service';
import { TechnicianDocumentsService } from './technician-documents.service';
import { TechnicianProfileListener } from './technician-profile.listener';
import { TechnicianStatsProcessor } from './technician-stats.processor';
import { TECHNICIAN_STATS_QUEUE } from './technician-stats.queue';
import { TechnicianStatsService } from './technician-stats.service';
import { TechnicianCompanyBranch } from './entities/technician-company-branch.entity';
import { TechnicianCompany } from './entities/technician-company.entity';
import { TechnicianDocument } from './entities/technician-document.entity';
import { TechnicianLevelConfig } from './entities/technician-level-config.entity';
import { TechnicianLevelHistory } from './entities/technician-level-history.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechnicianZone } from './entities/technician-zone.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TechnicianProfile,
      TechnicianDocument,
      TechnicianCompany,
      TechnicianCompanyBranch,
      TechnicianLevelConfig,
      TechnicianLevelHistory,
      TechnicianZone,
      User,
    ]),
    AuditModule,
    GeoModule,
    BullModule.registerQueue({ name: TECHNICIAN_STATS_QUEUE }),
  ],
  controllers: [
    TechniciansController,
    AdminTechniciansController,
    TechnicianCompaniesController,
    AdminTechnicianCompaniesController,
    AdminTechnicianLevelsController,
  ],
  providers: [
    TechniciansService,
    TechnicianProfileListener,
    TechnicianDocumentsService,
    AdminTechniciansService,
    TechnicianCompaniesService,
    TechnicianLevelsService,
    TechnicianStatsService,
    TechnicianStatsProcessor,
    storageServiceProvider,
  ],
  exports: [TechniciansService, TechnicianLevelsService, TechnicianStatsService],
})
export class TechniciansModule {}
