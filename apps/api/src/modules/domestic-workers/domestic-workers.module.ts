import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminDomesticWorkersController } from './admin-domestic-workers.controller';
import { DomesticWorkerBookingsController } from './domestic-worker-bookings.controller';
import { DomesticWorkerBookingsService } from './domestic-worker-bookings.service';
import { DomesticWorkerEarningApprovalsService } from './domestic-worker-earning-approvals.service';
import { DomesticWorkerProfileListener } from './domestic-worker-profile.listener';
import { DomesticWorkersController } from './domestic-workers.controller';
import { DomesticWorkersService } from './domestic-workers.service';
import { PublicDomesticWorkersController } from './public-domestic-workers.controller';
import { DomesticWorkerBooking } from './entities/domestic-worker-booking.entity';
import { DomesticWorkerEarningApproval } from './entities/domestic-worker-earning-approval.entity';
import { DomesticWorkerProfile } from './entities/domestic-worker-profile.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DomesticWorkerProfile, DomesticWorkerBooking, DomesticWorkerEarningApproval]),
    CustomersModule,
    PaymentsModule,
    SettingsModule,
    AuditModule,
  ],
  controllers: [
    DomesticWorkersController,
    PublicDomesticWorkersController,
    AdminDomesticWorkersController,
    DomesticWorkerBookingsController,
  ],
  providers: [DomesticWorkersService, DomesticWorkerBookingsService, DomesticWorkerEarningApprovalsService, DomesticWorkerProfileListener],
  exports: [DomesticWorkersService, DomesticWorkerBookingsService],
})
export class DomesticWorkersModule {}
