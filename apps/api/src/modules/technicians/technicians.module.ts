import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { storageServiceProvider } from '../../common/storage/storage.provider';
import { RealtimeSecurityModule } from '../../common/websocket/realtime-security.module';
import { AuditModule } from '../audit/audit.module';
import { User } from '../auth/entities/user.entity';
import { GeoModule } from '../geo/geo.module';
import { SettingsModule } from '../settings/settings.module';
// Script 4 §2-7 — تصريح مهارات ذاتي: نفس نمط استيراد Order/OrderTeamMember جوّه CatalogModule
// (كيان من موديول تاني بلا استيراد دائري). CatalogModule بيستورد TechniciansModule أصلاً، فمينفعش
// العكس — الحل: تسجيل الكيانين هنا مباشرة بدل استيراد CatalogModule كامل.
import { Service } from '../catalog/entities/service.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { TechnicianService } from '../catalog/entities/technician-service.entity';
import { TechnicianCategory } from '../catalog/entities/technician-category.entity';
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
import { TechnicianAssignmentGuardService } from './technician-assignment-guard.service';
import { TechnicianCategoriesService } from './technician-categories.service';
import { TechnicianWorkOpportunitiesService } from './technician-work-opportunities.service';
import { TechnicianActivityService } from './technician-activity.service';
import { AdminTechnicianCategoryOpsService } from './admin-technician-category-ops.service';
import { AdminTechnician360Service } from './admin-technician-360.service';
import { TechnicianIdentityService } from './technician-identity.service';
import { ScheduleSlotReleaseListener } from './schedule-slot-release.listener';
import { PreferredCrewService } from './preferred-crew.service';
import { TechnicianPreferredCrewMember } from './entities/technician-preferred-crew-member.entity';
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
import { TechnicianEarningsModule } from '../payments/technician-earnings.module';

@Module({
  imports: [
    // كشف مستحقات الفني الشهري (ADR-0038) — نفس الخدمة اللي بيستخدمها تطبيق الفني بالحرف،
    // عشان رقم الأدمن ورقم الفني ما يختلفوش أبدًا.
    TechnicianEarningsModule,
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
      TechnicianService,
      TechnicianCategory,
      TechnicianPreferredCrewMember,
      Service,
      ServiceCategory,
      User,
    ]),
    AuditModule,
    GeoModule,
    SettingsModule,
    RealtimeSecurityModule,
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
    TechnicianAssignmentGuardService,
    TechnicianCategoriesService,
    TechnicianWorkOpportunitiesService,
    TechnicianActivityService,
    AdminTechnicianCategoryOpsService,
    AdminTechnician360Service,
    TechnicianIdentityService,
    ScheduleSlotReleaseListener,
    PreferredCrewService,
    storageServiceProvider,
  ],
  exports: [
    TechniciansService,
    TechnicianCompaniesService,
    TechnicianLevelsService,
    TechnicianStatsService,
    TechnicianScheduleService,
    TechnicianAssignmentGuardService,
    TechnicianCategoriesService,
    TechnicianWorkOpportunitiesService,
    TechnicianActivityService,
    PreferredCrewService,
    TechnicianIdentityService,
  ],
})
export class TechniciansModule {}
