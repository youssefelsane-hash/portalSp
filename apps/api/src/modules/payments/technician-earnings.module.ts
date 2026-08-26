import { Module } from '@nestjs/common';
import { TechnicianEarningsService } from './technician-earnings.service';

/**
 * موديول مستقل صغير عمدًا (ADR-0038).
 *
 * `TechnicianEarningsService` محتاجه **جهتين**: تطبيق الفني (عبر `PaymentsModule`) ولوحة الأدمن
 * (عبر `TechniciansModule`). و`PaymentsModule` بيستورد `TechniciansModule` أصلاً، فحطّه في
 * `PaymentsModule` وحده كان هيخلّي `TechniciansModule` يحتاج `forwardRef` على دايرة كاملة.
 *
 * الخدمة نفسها مالهاش أي اعتماد غير `DataSource` (read model خالص)، فموديول مستقل هو أنضف حل —
 * الجهتين بيستوردوه بلا أي دايرة، ونسخة واحدة بس من الخدمة.
 */
@Module({
  providers: [TechnicianEarningsService],
  exports: [TechnicianEarningsService],
})
export class TechnicianEarningsModule {}
