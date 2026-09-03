import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { AdminOperationsOverviewService } from './admin-operations-overview.service';
import { AdminWorkloadForecastService } from './admin-workload-forecast.service';
import { AdminDispatchDeliveryService } from './admin-dispatch-delivery.service';
import { AdminExceptionCenterService } from './admin-exception-center.service';
import { AdminCoverageIntelligenceService } from './admin-coverage-intelligence.service';
import { OperationsOverviewQueryDto } from './dto/operations-overview-query.dto';
import { WorkloadForecastQueryDto } from './dto/workload-forecast-query.dto';
import { DispatchDeliveryQueryDto } from './dto/dispatch-delivery-query.dto';
import { LiveDispatchQueryDto } from './dto/live-dispatch-query.dto';
import { MATCHING_WORKFLOW_PHASE_AR } from '../matching/matching-workflow-state';
import { ExceptionCenterQueryDto } from './dto/exception-center-query.dto';
import { CoverageIntelligenceQueryDto } from './dto/coverage-intelligence-query.dto';

// مركز العمليات (docs/08 §36.2 فصاعدًا) — بداية قسم جديد كامل بيتوسّع مرحلة بمرحلة (§36.3-14).
@Controller('admin/operations')
@Roles(UserType.ADMIN)
export class AdminOperationsController {
  constructor(
    private readonly overviewService: AdminOperationsOverviewService,
    private readonly workloadForecastService: AdminWorkloadForecastService,
    private readonly dispatchDeliveryService: AdminDispatchDeliveryService,
    private readonly exceptionCenterService: AdminExceptionCenterService,
    private readonly coverageIntelligenceService: AdminCoverageIntelligenceService,
  ) {}

  @Get('overview')
  async getOverview(@Query() query: OperationsOverviewQueryDto) {
    const overview = await this.overviewService.getOverview({ categoryId: query.category_id ?? null });
    return {
      dispatch_pending_count: overview.dispatchPendingCount,
      crew_shortage_open_count: overview.crewShortageOpenCount,
      technicians_online_count: overview.techniciansOnlineCount,
      capacity_today: {
        light: overview.capacityToday.light,
        meaningful: overview.capacityToday.meaningful,
        heavy: overview.capacityToday.heavy,
        blocked: overview.capacityToday.blocked,
      },
    };
  }

  // عرض الحمل القريب — 7 أيام (docs/08 §36.4). بلا RequirePermission مخصوصة، نفس مستوى overview/
  // by-category (عرض/تشخيص بس).
  @Get('workload-forecast')
  async getWorkloadForecast(@Query() query: WorkloadForecastQueryDto) {
    const { items, meta } = await this.workloadForecastService.getForecast({
      categoryId: query.category_id,
      zoneId: query.zone_id ?? null,
      page: query.page ?? 1,
      perPage: query.per_page ?? 20,
    });
    return {
      items: items.map((r) => ({
        id: r.id,
        technician_code: r.technicianCode,
        full_name: r.fullName,
        current_level: r.currentLevel,
        days: r.days.map((d) => ({ date: d.date, tier: d.tier, is_multi_day: d.isMultiDay })),
      })),
      meta,
    };
  }

  // مراقبة تسليم الطلبات — REQ SENT + حالات حقيقية بس (docs/08 §36.7). صفر طبقة تتبّع توصيل موازية:
  // بيعرض order_assignments + technician_work_opportunities الحقيقيين زي ما همّ. الرد متعشّش
  // (`feed: {items, meta}` مش items/meta على المستوى الأول) — لازم عشان ResponseInterceptor بيعمل
  // auto-unwrap لأي رد فيه items+meta على المستوى الأول ويقطع summary بصمت، راجع تعليق
  // admin-dispatch-delivery.service.ts للتفصيل الكامل (بَقّة حقيقية اتلقطت بـcurl حي).
  @Get('dispatch-delivery')
  async getDispatchDelivery(@Query() query: DispatchDeliveryQueryDto) {
    const result = await this.dispatchDeliveryService.getDeliveryObservability({
      categoryId: query.category_id ?? null,
      zoneId: query.zone_id ?? null,
      hours: query.hours ?? 24,
      page: query.page ?? 1,
      perPage: query.per_page ?? 20,
    });
    return {
      summary: {
        assignments: {
          sent: result.summary.assignments.sent,
          viewed: result.summary.assignments.viewed,
          accepted: result.summary.assignments.accepted,
          rejected: result.summary.assignments.rejected,
          timeout: result.summary.assignments.timeout,
          cancelled: result.summary.assignments.cancelled,
          stale_sent_count: result.summary.assignments.staleSentCount,
        },
        work_opportunities: {
          offered: result.summary.workOpportunities.offered,
          accepted: result.summary.workOpportunities.accepted,
          declined: result.summary.workOpportunities.declined,
          closed: result.summary.workOpportunities.closed,
        },
      },
      feed: {
        items: result.feed.items.map((r) => ({
          id: r.id,
          kind: r.kind,
          order_id: r.orderId,
          technician_id: r.technicianId,
          technician_code: r.technicianCode,
          full_name: r.fullName,
          status: r.status,
          context: r.context,
          sent_at: r.sentAt,
          responded_at: r.respondedAt,
          expires_at: r.expiresAt,
          is_stale: r.isStale,
          // بَقّة حقيقية اتلقطت بلقطة شاشة مالك (docs/08 §90): الخدمة والواجهة كانوا جاهزين من
          // §72 (رقم الطلب + عدد الفنيين اللي اتبعتلهم)، لكن الـmapping هنا نسي الحقلين — يعني
          // الـJSON كان بيوصل من غيرهم فعليًا، فعمود "الطلب" كان بيبان فاضي (order_number
          // undefined) والعداد "اتبعت لـ فني" من غير رقم (order_technician_count undefined).
          order_number: r.orderNumber,
          order_technician_count: r.orderTechnicianCount,
        })),
        meta: result.feed.meta,
      },
    };
  }

  // التحكم اللحظي في التوزيع — صف لكل طلب لسه بيدوّر على فني (مقابل feed الأحداث المسطح فوق).
  // نفس الخدمة ونفس الجداول عمدًا: مفيش «مركز مطابقة» موازي. الحالة والخطوة الجاية والتأخير كلهم
  // مشتقين في الباك-إند بـ`deriveMatchingWorkflowState` — الواجهة **ما بتشتقّش** ولا واحدة منهم.
  @Get('live-dispatch')
  async getLiveDispatch(@Query() query: LiveDispatchQueryDto) {
    const items = await this.dispatchDeliveryService.getLiveDispatch({
      categoryId: query.category_id ?? null,
      zoneId: query.zone_id ?? null,
      onlyDelayed: query.only_delayed ?? false,
    });
    return {
      items: items.map((r) => ({
        order_id: r.orderId,
        order_number: r.orderNumber,
        service_name_ar: r.serviceNameAr,
        booking_mode: r.bookingMode,
        order_type: r.orderType,
        searching_since_seconds: r.searchingSinceSeconds,
        current_round: r.currentRound,
        max_rounds: r.maxRounds,
        technicians_contacted: r.techniciansContacted,
        pending: r.pending,
        viewed: r.viewed,
        rejected: r.rejected,
        accepted: r.accepted,
        workflow_phase: r.workflow.phase,
        workflow_phase_ar: MATCHING_WORKFLOW_PHASE_AR[r.workflow.phase],
        next_action_at: r.workflow.nextActionAt,
        delay_seconds: r.workflow.delaySeconds,
        is_delayed: r.workflow.isDelayed,
      })),
      meta: { page: 1, perPage: items.length, total: items.length },
    };
  }

  // مركز الاستثناءات/التنبيهات (docs/08 §36.9) — "فوق تصعيد §35.4 + تنبيهات جديدة". قايمة "محتاج
  // تصرّف دلوقتي" محدودة (EXCEPTION_LIST_LIMIT)، مش جدول قابل للتصفح — راجع تعليق
  // admin-exception-center.service.ts للتفصيل الكامل (النوعين وسبب اختيارهم).
  @Get('exceptions')
  async getExceptions(@Query() query: ExceptionCenterQueryDto) {
    const result = await this.exceptionCenterService.getExceptions({
      categoryId: query.category_id ?? null,
      zoneId: query.zone_id ?? null,
    });
    return {
      // docs/08 §56 بند 4 — أول عنصر عمدًا: شغلانة معادها عدّى ولسه ما بدأتش هي أعجل حاجة هنا.
      overdue_orders: {
        items: result.overdueOrders.items.map((i) => ({
          order_id: i.orderId,
          order_number: i.orderNumber,
          scheduled_at: i.scheduledAt,
          technician_id: i.technicianId,
          technician_code: i.technicianCode,
          full_name: i.fullName,
          days_late: i.daysLate,
        })),
        total: result.overdueOrders.total,
      },
      // توسيع جولة مطابقة متأخر — الـengine نفسه واقف، مش مجرد عرض عدّى معاده. مختلف عن
      // `stale_dispatch` تحته اللي بيولّع على سلوك طبيعي كمان (ADR-0018 §5).
      matching_workflow_delayed: {
        items: result.matchingWorkflowDelayed.items.map((i) => ({
          order_id: i.orderId,
          order_number: i.orderNumber,
          order_status: i.orderStatus,
          current_round: i.currentRound,
          max_rounds: i.maxRounds,
          technicians_contacted: i.techniciansContacted,
          pending_responses: i.pendingResponses,
          expected_action_at: i.expectedActionAt,
          delay_seconds: i.delaySeconds,
        })),
        total: result.matchingWorkflowDelayed.total,
      },
      crew_shortage: {
        items: result.crewShortage.items.map((i) => ({
          order_id: i.orderId,
          order_number: i.orderNumber,
          scheduled_at: i.scheduledAt,
          escalated_at: i.escalatedAt,
          missing_technicians: i.missingTechnicians,
          missing_assistants: i.missingAssistants,
          is_overdue: i.isOverdue,
        })),
        total: result.crewShortage.total,
      },
      stale_dispatch: {
        items: result.staleDispatch.items.map((i) => ({
          assignment_id: i.assignmentId,
          order_id: i.orderId,
          order_number: i.orderNumber,
          technician_id: i.technicianId,
          technician_code: i.technicianCode,
          full_name: i.fullName,
          sent_at: i.sentAt,
          expires_at: i.expiresAt,
        })),
        total: result.staleDispatch.total,
      },
    };
  }

  // ذكاء تغطية القوى العاملة — فئة+منطقة (docs/08 §36.10). صف لكل زوج (منطقة، فئة) بيجمع العرض
  // (فنيين LIGHT/MEANINGFUL متاحين النهاردة) والطلب (طلبات لسه بتدوّر) — راجع تعليق
  // admin-coverage-intelligence.service.ts للتفصيل الكامل.
  @Get('coverage')
  async getCoverage(@Query() query: CoverageIntelligenceQueryDto) {
    const { items, meta } = await this.coverageIntelligenceService.getCoverage({
      categoryId: query.category_id ?? null,
      zoneId: query.zone_id ?? null,
      page: query.page ?? 1,
      perPage: query.per_page ?? 20,
    });
    return {
      items: items.map((r) => ({
        zone_id: r.zoneId,
        zone_name: r.zoneName,
        category_id: r.categoryId,
        category_name: r.categoryName,
        technicians_total: r.techniciansTotal,
        technicians_light: r.techniciansLight,
        technicians_meaningful: r.techniciansMeaningful,
        technicians_heavy: r.techniciansHeavy,
        technicians_blocked: r.techniciansBlocked,
        dispatch_pending_count: r.dispatchPendingCount,
        coverage_status: r.coverageStatus,
      })),
      meta,
    };
  }
}
