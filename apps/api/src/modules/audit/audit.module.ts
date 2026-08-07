import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogService } from './audit-log.service';
import { AuditLog } from './entities/audit-log.entity';

// موديول خفيف مستقل عمداً (مش جوّه admin) — عشان أي موديول تاني (orders, technicians,
// payments, support, promotions) يقدر يسجّل تدقيق من غير ما يعتمد على موديول admin نفسه
// (اللي بيعتمد هو على الكيانات دي أصلاً)، ومنعاً لأي اعتمادية دائرية.
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
