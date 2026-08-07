import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { User } from '../auth/entities/user.entity';
import { Order } from '../orders/entities/order.entity';
import { Rating } from '../ratings/entities/rating.entity';
import { SettingsModule } from '../settings/settings.module';
import { Complaint } from '../support/entities/complaint.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { AdminAuditController } from './admin-audit.controller';
import { AdminReportsController } from './admin-reports.controller';
import { AdminReportsService } from './admin-reports.service';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminUsersController } from './admin-users.controller';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRole } from './entities/user-role.entity';
import { PermissionsService } from './permissions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, TechnicianProfile, Complaint, Rating, Role, Permission, RolePermission, UserRole, User]),
    AuditModule,
    SettingsModule,
  ],
  controllers: [AdminReportsController, AdminUsersController, AdminAuditController, AdminSettingsController],
  providers: [AdminReportsService, PermissionsService],
  exports: [PermissionsService],
})
export class AdminModule {}
