import { Module } from '@nestjs/common';
import { RealtimeSecurityModule } from '../../common/websocket/realtime-security.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminOperationsOverviewService } from './admin-operations-overview.service';
import { AdminWorkloadForecastService } from './admin-workload-forecast.service';
import { AdminDispatchDeliveryService } from './admin-dispatch-delivery.service';
import { AdminExceptionCenterService } from './admin-exception-center.service';
import { AdminCoverageIntelligenceService } from './admin-coverage-intelligence.service';
import { AdminOrderTraceService } from './admin-order-trace.service';
import { AdminReviewCenterService } from './admin-review-center.service';
import { AdminRiskCenterController } from './risk/admin-risk-center.controller';
import { RiskCenterService } from './risk/risk-center.service';
import { RiskDetectorService } from './risk/risk-detector.service';
import { RiskDetectorScheduler } from './risk/risk-detector.scheduler';
import { AuditModule } from '../audit/audit.module';

// مركز العمليات (docs/08 §36.2 فصاعدًا) — موديول جديد مستقل عمدًا (نفس نمط MatchingModule):
// بيستورد كيانات/ثوابت خام بس من orders (OrderStatus، الثوابت، ESCALATABLE_STATUSES) مش OrdersModule
// نفسه، عشان يتجنّب أي دورة استيراد (نفس التحذير الموثّق في matching.module.ts بالحرف).
@Module({
  imports: [SettingsModule, RealtimeSecurityModule, AuditModule],
  controllers: [AdminOperationsController, AdminRiskCenterController],
  providers: [
    AdminOperationsOverviewService,
    AdminWorkloadForecastService,
    AdminDispatchDeliveryService,
    AdminExceptionCenterService,
    AdminCoverageIntelligenceService,
    AdminOrderTraceService,
    AdminReviewCenterService,
    RiskCenterService,
    RiskDetectorService,
    RiskDetectorScheduler,
  ],
})
export class OperationsModule {}
