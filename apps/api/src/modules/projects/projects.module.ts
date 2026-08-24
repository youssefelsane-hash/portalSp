import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { SettingsModule } from '../settings/settings.module';
import { Project } from './entities/project.entity';
import { ProjectQuote } from './entities/project-quote.entity';
import { ProjectMilestone, WarrantyPlan } from './entities/project-milestone.entity';
import { WarrantyClaim } from './entities/warranty-entities';
import { ProjectsService } from './projects.service';
import { MyProjectsController } from './my-projects.controller';
import { AdminProjectsController } from './admin-projects.controller';
import { AdminWarrantyClaimsController } from './admin-warranty-claims.controller';
import { AdminWarrantyPlansController } from './admin-warranty-plans.controller';
import { ProjectRoomController } from './project-room.controller';
import { MyWarrantyController } from './my-warranty.controller';
import { MilestoneAutoApproveService } from './milestone-auto-approve.service';
import { CustomerWarrantyPlansController } from './customer-warranty-plans.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, ProjectQuote, ProjectMilestone, WarrantyClaim, WarrantyPlan]),
    AuditModule,
    SettingsModule,
  ],
  controllers: [MyProjectsController, MyWarrantyController, CustomerWarrantyPlansController, AdminProjectsController, AdminWarrantyClaimsController, ProjectRoomController, AdminWarrantyPlansController],
  providers: [ProjectsService, MilestoneAutoApproveService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
