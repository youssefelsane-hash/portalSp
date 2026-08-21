import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { User } from '../auth/entities/user.entity';
import { CustomersModule } from '../customers/customers.module';
import { Order } from '../orders/entities/order.entity';
import { Payout } from '../payments/entities/payout.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { Rating } from '../ratings/entities/rating.entity';
import { SecurityModule } from '../security/security.module';
import { SettingsModule } from '../settings/settings.module';
import { Complaint } from '../support/entities/complaint.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { AdminAuditController } from './admin-audit.controller';
import { AdminCustomer360Service } from './admin-customer-360.service';
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
      Wallet,
    ]),
    AuditModule,
    SettingsModule,
    // Call Center — عناوين العميل قبل إنشاء طلب نيابة عنه (Script 4 §33-37). CustomersModule
    // مالوش أي استيراد لـAdminModule، فمفيش خطر دائرية (نفس نمط TechniciansModule/CatalogModule).
    CustomersModule,
    // Script 5 (docs/adr/0016) — PermissionsService بيسجّل محاولات تصعيد الصلاحيات كـsecurity
    // event. SecurityModule بيستورد AuditModule/SettingsModule بس، صفر استيراد لـAdminModule
    // — نفس فحص اللادائرية فوق بالحرف.
    SecurityModule,
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
  providers: [AdminReportsService, PermissionsService, AdminEmployeesService, AdminCustomersService, AdminCustomer360Service],
  exports: [PermissionsService],
})
export class AdminModule {}
