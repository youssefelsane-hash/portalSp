import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { storageServiceProvider } from '../../common/storage/storage.provider';
import { AuditModule } from '../audit/audit.module';
import { User } from '../auth/entities/user.entity';
import { GeoModule } from '../geo/geo.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminTechnicianCompaniesController } from './admin-technician-companies.controller';
import { AdminTechnicianLevelsController } from './admin-technician-levels.controller';
import { AdminTechniciansController } from './admin-technicians.controller';
import { AdminTechniciansService } from './admin-technicians.service';
import { PublicTechniciansController } from './public-technicians.controller';
import { PublicTechnicianCompaniesController } from './public-technician-companies.controller';
import { TechnicianCompaniesController } from './technician-companies.controller';
import { TechnicianCompaniesService } from './technician-companies.service';
import { TechnicianLevelsService } from './technician-levels.service';
import { TechniciansController } from './technicians.controller';
import { TechniciansService } from './technicians.service';
import { TechnicianDocumentsService } from './technician-documents.service';
import { PortfolioLinksService } from './portfolio-links.service';
import { TechnicianCertificatesService } from './technician-certificates.service';
import { TechnicianProfileListener } from './technician-profile.listener';
import { TechnicianStatsProcessor } from './technician-stats.processor';
import { TECHNICIAN_STATS_QUEUE } from './technician-stats.queue';
import { TechnicianStatsRecalculationListener } from './technician-stats-recalculation.listener';
import { TechnicianStatsService } from './technician-stats.service';
import { TechnicianScheduleService } from './technician-schedule.service';
import { TechnicianCompanyBranch } from './entities/technician-company-branch.entity';
import { TechnicianCompany } from './entities/technician-company.entity';
import { TechnicianDocument } from './entities/technician-document.entity';
import { TechnicianLevelConfig } from './entities/technician-level-config.entity';
import { TechnicianLevelHistory } from './entities/technician-level-history.entity';
import { TechnicianPortfolioLink } from './entities/technician-portfolio-link.entity';
import { TechnicianCertificate } from './entities/technician-certificate.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechnicianScheduleSlot } from './entities/technician-schedule-slot.entity';
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
      TechnicianPortfolioLink,
      TechnicianCertificate,
      TechnicianScheduleSlot,
      User,
    ]),
    AuditModule,
    GeoModule,
    SettingsModule,
    BullModule.registerQueue({ name: TECHNICIAN_STATS_QUEUE }),
  ],
  controllers: [
    TechniciansController,
    PublicTechniciansController,
    AdminTechniciansController,
    TechnicianCompaniesController,
    PublicTechnicianCompaniesController,
    AdminTechnicianCompaniesController,
    AdminTechnicianLevelsController,
  ],
  providers: [
    TechniciansService,
    TechnicianProfileListener,
    TechnicianDocumentsService,
    PortfolioLinksService,
    TechnicianCertificatesService,
    AdminTechniciansService,
    TechnicianCompaniesService,
    TechnicianLevelsService,
    TechnicianStatsService,
    TechnicianStatsProcessor,
    TechnicianStatsRecalculationListener,
    TechnicianScheduleService,
    storageServiceProvider,
  ],
  exports: [TechniciansService, TechnicianCompaniesService, TechnicianLevelsService, TechnicianStatsService, TechnicianScheduleService],
})
export class TechniciansModule {}
