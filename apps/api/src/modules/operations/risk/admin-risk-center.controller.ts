import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../../common/decorators/require-step-up.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserType } from '../../auth/entities/user.entity';
import { JwtPayload } from '../../auth/types/authenticated-request';
import { RiskCenterService } from './risk-center.service';
import { RiskDetectorService } from './risk-detector.service';
import {
  RecordRiskActionDto,
  RecordRiskVerdictDto,
  RiskQueueQueryDto,
  RunRiskDetectorsDto,
  UpsertRiskCaseDto,
} from './dto/risk-center.dto';
import type { RiskVerdict } from './risk-score';

/**
 * **مركز المخاطر والتلاعب** (ADR-0085، docs/08 §140).
 *
 * صلاحية مستقلة (`risk_center.*`) مش `operations.view`: الشاشة دي بتعرض تحليل سلوكي شخصي عن
 * ناس بالاسم، ودي دائرة اطلاع أضيق من لوحة العمليات.
 */
@Controller('admin/risk-center')
@Roles(UserType.ADMIN)
export class AdminRiskCenterController {
  constructor(
    private readonly riskCenter: RiskCenterService,
    private readonly detectors: RiskDetectorService,
  ) {}

  @Get('overview')
  @RequirePermission('risk_center.view')
  overview() {
    return this.riskCenter.overview();
  }

  @Get('queue')
  @RequirePermission('risk_center.view')
  queue(@Query() query: RiskQueueQueryDto) {
    return this.riskCenter.listQueue({
      minScore: query.min_score,
      actorType: query.actor_type,
      bucket: query.bucket,
      caseStatus: query.case_status,
      sort: query.sort,
      limit: query.limit,
    });
  }

  /** كتالوج أنواع الإشارات بأوزانها — الواجهة بتشرح بيه «إيه اللي النظام بيراقبه». */
  @Get('signal-types')
  @RequirePermission('risk_center.view')
  async signalTypes() {
    return this.riskCenter.listSignalTypes();
  }

  @Get('actors/:userId')
  @RequirePermission('risk_center.view')
  async actor(@Param('userId', ParseUUIDPipe) userId: string) {
    const profile = await this.riskCenter.actorProfile(userId);
    return {
      ...profile,
      // الاقتراح بيتبعت مع الملف عشان الواجهة تعرض «النظام بيقترح كذا» جنب زرار التنفيذ —
      // مع تعليم صريح إنه **اقتراح مش تنفيذ آلي** (ADR-0085 §5).
      suggested_action: RiskCenterService.suggestedAction(Number(profile.score ?? 0)),
    };
  }

  @Get('actors/:userId/signals')
  @RequirePermission('risk_center.view')
  actorSignals(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.riskCenter.actorSignals(userId);
  }

  @Get('actors/:userId/orders')
  @RequirePermission('risk_center.view')
  actorOrders(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.riskCenter.actorOrders(userId);
  }

  @Get('actors/:userId/customers')
  @RequirePermission('risk_center.view')
  actorCustomers(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.riskCenter.actorCounterparties(userId);
  }

  /**
   * حكم المراجع — **مش بيطلب step-up**: ده توسيم مراجعة مش إجراء على حساب، والاحتكاك الزايد
   * هنا بيخلّي المراجعين يبطّلوا يوسموا، فالضوضاء تفضل والشاشة تموت.
   */
  @Post('signals/:signalId/verdict')
  @RequirePermission('risk_center.manage')
  verdict(
    @CurrentUser() user: JwtPayload,
    @Param('signalId', ParseUUIDPipe) signalId: string,
    @Body() dto: RecordRiskVerdictDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.riskCenter.recordVerdict(user.sub, signalId, dto.verdict as RiskVerdict, dto.notes, audit);
  }

  @Post('actors/:userId/case')
  @RequirePermission('risk_center.manage')
  upsertCase(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpsertRiskCaseDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.riskCenter.upsertCase(user.sub, userId, dto, audit);
  }

  /**
   * تنفيذ إجراء — **step-up مطلوب**: ده أقوى فعل في الشاشة، وممكن يوقف رزق إنسان. وده كمان
   * المكان الوحيد اللي بيلمس حالة الحساب فعلاً.
   */
  @Post('actors/:userId/actions')
  @RequirePermission('risk_center.manage')
  @RequireStepUp()
  action(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: RecordRiskActionDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.riskCenter.recordAction(user.sub, userId, dto, audit);
  }

  /**
   * تشغيل الكاشفات يدويًا.
   *
   * بتشتغل مجدولة كمان، بس الزرار اليدوي ضروري: مراجع بيحقق في حالة محتاج يشوف أحدث إشارة
   * دلوقتي مش بعد ساعة. العملية idempotent (مفتاح تكرار لكل إشارة) فتكرارها مالوش ضرر.
   */
  @Post('run-detectors')
  @RequirePermission('risk_center.manage')
  @RequireStepUp()
  runDetectors(@Body() dto: RunRiskDetectorsDto) {
    return this.detectors.runAllDetectors(dto.window_days);
  }
}
