import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { AdminOperationsOverviewService } from './admin-operations-overview.service';
import { AdminWorkloadForecastService } from './admin-workload-forecast.service';
import { AdminDispatchDeliveryService } from './admin-dispatch-delivery.service';
import { AdminExceptionCenterService } from './admin-exception-center.service';
import { AdminCoverageIntelligenceService } from './admin-coverage-intelligence.service';
import { AdminOrderTraceService, OrderTrace } from './admin-order-trace.service';
import { OperationsOverviewQueryDto } from './dto/operations-overview-query.dto';
import { WorkloadForecastQueryDto } from './dto/workload-forecast-query.dto';
import { DispatchDeliveryQueryDto } from './dto/dispatch-delivery-query.dto';
import { ExceptionCenterQueryDto } from './dto/exception-center-query.dto';
import { CoverageIntelligenceQueryDto } from './dto/coverage-intelligence-query.dto';

/**
 * تحويل تتبّع الطلب لـsnake_case — نفس اتفاقية باقي واجهة الأدمن. مفيش أي منطق هنا: نسخ حقول بس.
 */
function serializeOrderTrace(t: OrderTrace) {
  return {
    order_id: t.orderId,
    order_number: t.orderNumber,
    order_status: t.orderStatus,
    is_emergency: t.isEmergency,
    current_round: t.currentRound,
    max_rounds: t.maxRounds,
    technicians_contacted: t.techniciansContacted,
    counts: t.counts,
    next_action: t.nextAction,
    next_action_at: t.nextActionAt,
    delay_seconds: t.delaySeconds,
    rounds: t.rounds.map((r) => ({
      round: r.round,
      started_at: r.startedAt,
      expansion_due_at: r.expansionDueAt,
      technicians: r.technicians.map((x) => ({
        assignment_id: x.assignmentId,
        technician_id: x.technicianId,
        technician_code: x.technicianCode,
        full_name: x.fullName,
        status: x.status,
        sent_at: x.sentAt,
        viewed_at: x.viewedAt,
        responded_at: x.respondedAt,
        rejection_reason_code: x.rejectionReasonCode,
        distance_km: x.distanceKm,
        estimated_eta_minutes: x.estimatedEtaMinutes,
      })),
    })),
  };
}

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
    private readonly orderTraceService: AdminOrderTraceService,
  ) {}

  /**
   * **Live Dispatch Control** — كل الطلبات اللي لسه بتدوّر على فني، مجمّعة حسب الطلب.
   *
   * نفس مصدر `dispatch-delivery` بالظبط (`order_assignments`)، بس مقروء بالسؤال التاني: الـfeed
   * بيقول «إيه اللي حصل زمنيًا»، وده بيقول «الطلب ده فين دلوقتي ومستني إيه». الاتنين فاضلين —
   * كل واحد بيجاوب سؤال مختلف على نفس البيانات.
   *
   * استعلام واحد لكل الطلبات، مش استعلام لكل صف.
   */
  @Get('order-traces')
  async listOrderTraces() {
    const traces = await this.orderTraceService.listSearchingOrders();
    // snake_case زي باقي واجهة الأدمن — التحويل هنا مش في الخدمة عشان الخدمة تفضل
    // قابلة للاستخدام من صفحة الطلب كمان بنفس الأنواع الداخلية.
    return { items: traces.map(serializeOrderTrace) };
  }

  /**
   * تتبّع طلب واحد — بيغذّي «مفتّش المطابقة» في صفحة الطلب.
   *
   * المفتّش كان بيعرض عدّادات مسطّحة بس (اتبعت 8، اترفض 3) من غير ما يقول **في أنهي جولة ولمين**،
   * فالأدمن مايقدرش يفرق بين «جولة واحدة وصلت لـ8» و«تلات جولات لسه بتوسّع». نفس بيانات
   * العدّادات، مقروءة بالجولة.
   *
   * بيرجّع null لطلب مش موجود (مش 404) — المفتّش قسم فرعي في صفحة أكبر، وغيابه مايوقّعش الصفحة.
   */
  @Get('order-traces/:orderId')
  async getOrderTrace(@Param('orderId', ParseUUIDPipe) orderId: string) {
    const trace = await this.orderTraceService.getForOrder(orderId);
    return { trace: trace ? serializeOrderTrace(trace) : null };
  }

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
          // إمتى الفني فتح العرض فعلاً (migration 0255) — قبل كده الحالة كانت بتتحوّل لـ'viewed'
          // من غير طابع زمني، فمكانش ينفع تعرف قعد قد إيه قبل ما يرفض.
          viewed_at: r.viewedAt,
          responded_at: r.respondedAt,
          expires_at: r.expiresAt,
          assignment_round: r.assignmentRound,
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
      // إعادة زيارة اتعلّقت على فني مبقاش عنده الطلب (ADR-0051). الخدمة كانت بتحسبه من الأول
      // (استعلام كامل كل نداء) والـcontroller كان بيرميه قبل ما يوصل لأي واجهة — شغل بيتعمل
      // ومحدش بيشوف نتيجته. الأدمن بيحرّره بـPOST /admin/orders/:id/release-revisit.
      stalled_revisits: {
        items: result.stalledRevisits.items.map((i) => ({
          order_id: i.orderId,
          order_number: i.orderNumber,
          original_order_id: i.originalOrderId,
          original_order_number: i.originalOrderNumber,
          technician_id: i.technicianId,
          technician_code: i.technicianCode,
          full_name: i.fullName,
          phone: i.phone,
          pinned_at: i.pinnedAt,
          deadline_at: i.deadlineAt,
          reason: i.reason,
          chargeback_cents: i.chargebackCents,
        })),
        total: result.stalledRevisits.total,
      },
      // «المطابقة نفسها واقفة» — مختلف عن stale_dispatch اللي فوق (ده سلوك محرك، وده سلوك فني).
      matching_workflow_delayed: {
        items: result.matchingWorkflowDelayed.items.map((i) => ({
          order_id: i.orderId,
          order_number: i.orderNumber,
          current_round: i.currentRound,
          max_rounds: i.maxRounds,
          expected_expansion_at: i.expectedExpansionAt,
          delay_seconds: i.delaySeconds,
          technicians_contacted: i.techniciansContacted,
        })),
        total: result.matchingWorkflowDelayed.total,
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
