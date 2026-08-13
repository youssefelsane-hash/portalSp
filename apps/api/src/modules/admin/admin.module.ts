import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { User } from '../auth/entities/user.entity';
import { Order } from '../orders/entities/order.entity';
import { Payout } from '../payments/entities/payout.entity';
import { Rating } from '../ratings/entities/rating.entity';
import { SettingsModule } from '../settings/settings.module';
import { Complaint } from '../support/entities/complaint.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { AdminAuditController } from './admin-audit.controller';
import { AdminCustomersController } from './admin-customers.controller';
import { AdminCustomersService } from './admin-customers.service';
import { AdminEmployeesController } from './admin-employees.controller';
import { AdminEmployeesService } from './admin-employees.service';
import { AdminReportsController } from './admin-reports.controller';
import { AdminReportsService } from './admin-reports.service';
import { AdminRolesController } from './admin-roles.controller';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminUsersController } from './admin-users.controller';
import { EmployeeProfile } from './entities/employee-profile.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRole } from './entities/user-role.entity';
import { PermissionsService } from './permissions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      TechnicianProfile,
      Complaint,
      Rating,
      Role,
      Permission,
      RolePermission,
      UserRole,
      User,
      EmployeeProfile,
      CustomerProfile,
      RefreshToken,
      Payout,
    ]),
    AuditModule,
    SettingsModule,
  ],
  controllers: [
    AdminReportsController,
    AdminUsersController,
    AdminRolesController,
    AdminAuditController,
    AdminSettingsController,
    AdminEmployeesController,
    AdminCustomersController,
  ],
  providers: [AdminReportsService, PermissionsService, AdminEmployeesService, AdminCustomersService],
  exports: [PermissionsService],
})
export class AdminModule {}
