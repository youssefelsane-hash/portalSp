import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { PaymentPoliciesModule } from '../payment-policies/payment-policies.module';
import { storageServiceProvider } from '../../common/storage/storage.provider';
import { InstallmentPlan } from './entities/installment-plan.entity';
import { InstallmentApplication } from './entities/installment-application.entity';
import { InstallmentPlanDocumentRequirement } from './entities/installment-plan-document-requirement.entity';
import { InstallmentsController } from './installments.controller';
import { AdminInstallmentsController } from './admin-installments.controller';
import { InstallmentsService } from './installments.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InstallmentPlan, InstallmentApplication, InstallmentPlanDocumentRequirement]),
    CustomersModule,
    AuditModule,
    PaymentPoliciesModule,
    SettingsModule,
  ],
  controllers: [InstallmentsController, AdminInstallmentsController],
  providers: [InstallmentsService, storageServiceProvider],
  exports: [InstallmentsService],
})
export class InstallmentsModule {}
