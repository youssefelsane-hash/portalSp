import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { PaymentPoliciesController } from './payment-policies.controller';
import { PaymentPoliciesService } from './payment-policies.service';
import { PaymentPolicy, PaymentPolicyAcceptance, PaymentPolicyVersion } from './entities/payment-policy.entity';

// سياسات الدفع/الشروط (migration 0177) — versioned consent: النسخ immutable، القبول مربوط
// بنسخة + سياق. مستهلكة من orders (شروط ما بعد الخدمة) ومن installments (شروط التقسيط).
@Module({
  imports: [TypeOrmModule.forFeature([PaymentPolicy, PaymentPolicyVersion, PaymentPolicyAcceptance]), AuditModule],
  controllers: [PaymentPoliciesController],
  providers: [PaymentPoliciesService],
  exports: [PaymentPoliciesService],
})
export class PaymentPoliciesModule {}
