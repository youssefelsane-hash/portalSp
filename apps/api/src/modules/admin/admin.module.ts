import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { User } from '../auth/entities/user.entity';
import { Order } from '../orders/entities/order.entity';
import { Rating } from '../ratings/entities/rating.entity';
import { Complaint } from '../support/entities/complaint.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { AdminAuditController } from './admin-audit.controller';
import { AdminReportsController } from './admin-reports.controller';
import { AdminReportsService } from './admin-reports.service';
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
  ],
  controllers: [AdminReportsController, AdminUsersController, AdminAuditController],
  providers: [AdminReportsService, PermissionsService],
  exports: [PermissionsService],
})
export class AdminModule {}
