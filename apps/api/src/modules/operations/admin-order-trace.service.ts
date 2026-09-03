import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';

/** نفس الافتراضي اللي `MatchingService` بيستخدمه — القيمة الحقيقية بتيجي من الإعدادات. */
const MAX_ROUNDS_FALLBACK = 4;

export interface OrderTraceTechnician {
  assignmentId: string;
  technicianId: string;
  technicianCode: string;
  fullName: string;
  status: string;
  sentAt: string;
  viewedAt: string | null;
  respondedAt: string | null;
  rejectionReasonCode: string | null;
  distanceKm: number | null;
  estimatedEtaMinutes: number | null;
}

export interface OrderTraceRound {
  round: number;
  startedAt: string;
  /** مهلة توسيع الجولة — **مش** انتهاء صلاحية العروض (العروض بتفضل قابلة للقبول بعدها). */
  expansionDueAt: string;
  technicians: OrderTraceTechnician[];
}

/**
 * الخطوة اللي النظام مستنيها دلوقتي — **مشتقّة** من حالة الطلب والجولات في الداتابيز،
 * مش من scheduler جديد ولا counters مخزّنة.
 */
export type OrderTraceNextAction =
  /** لسه في وقت للرد على الجولة الحالية. */
  | 'waiting_technician_response'
  /** مهلة الجولة عدّت والمفروض جولة جديدة تتفتح. */
  | 'expand_next_round'
  /** كل الجولات خلصت ومفيش قبول — المطابقة مستنية إنقاذ/تدخل. */
  | 'matching_exhausted'
  /** الطلب اتقفل على فني. */
  | 'assigned'
  /** الطلب مش في مرحلة بحث أصلاً (مجدول مؤكد، ملغي، إلخ) — مفيش جولات مطلوبة. */
  | 'no_matching_required';

export interface OrderTrace {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  isEmergency: boolean;
  currentRound: number | null;
  maxRounds: number;
  techniciansContacted: number;
  counts: { sent: number; viewed: number; rejected: number; accepted: number; timeout: number; cancelled: number };
  rounds: OrderTraceRound[];
  nextAction: OrderTraceNextAction;
  /** الوقت اللي الخطوة الجاية مفروض تحصل فيه. null لو مفيش خطوة مجدولة. */
  nextActionAt: string | null;
  /** ثواني التأخير عن `nextActionAt`. 0 = مش متأخر. */
  delaySeconds: number;
}

interface TraceRow {
  order_id: string;
  order_number: string;
  order_status: string;
  order_type: string;
  assignment_id: string;
  technician_id: string;
  technician_code: string;
  full_name: string;
  status: string;
  assignment_round: number;
  sent_at: string;
  viewed_at: string | null;
  responded_at: string | null;
  rejection_reason_code: string | null;
  distance_km: string | null;
  estimated_eta_minutes: number | null;
  expires_at: string;
}

/**
 * **تتبّع الطلب في المطابقة — نفس مصدر الحقيقة، مجمّع حسب الطلب والجولة.**
 *
 * `AdminDispatchDeliveryService` بيدّي feed مسطّح مرتّب زمنيًا (مفيد لمراقبة الأحداث)، بس
 * مايجاوبش «الطلب ده وصل لمين، في أنهي جولة، ومستني إيه دلوقتي». الخدمة دي بتجمّع **نفس**
 * `order_assignments` حسب الطلب → الجولة → الفني، وبتشتق الخطوة الجاية من نفس البيانات.
 *
 * **مش محرك مطابقة تاني**: مفيش هنا أي قرار أهلية ولا ترتيب ولا جدولة. بتقرا اللي المطابقة
 * كتبته بس، وبتقارن مهلة الجولة بالساعة عشان تقول «متأخر ولا لأ».
 */
@Injectable()
export class AdminOrderTraceService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
  ) {}

  /** تتبّع طلب واحد بالتفصيل (صفحة الطلب). */
  async getForOrder(orderId: string): Promise<OrderTrace | null> {
    const traces = await this.buildTraces(`o.id = $1`, [orderId]);
    return traces[0] ?? null;
  }

  /**
   * كل الطلبات اللي لسه بتدوّر على فني (مركز العمليات).
   *
   * استعلام واحد لكل الطلبات — **مش** استعلام لكل صف. ده الفرق بين شاشة بتفتح وشاشة بتقع.
   */
  async listSearchingOrders(limit = 50): Promise<OrderTrace[]> {
    return this.buildTraces(`o.order_status = 'searching_technician' AND o.deleted_at IS NULL`, [], limit);
  }

  private async buildTraces(where: string, params: unknown[], limit?: number): Promise<OrderTrace[]> {
    const maxRounds = await this.settings.getNumber('matching.max_rounds', MAX_ROUNDS_FALLBACK);

    const rows = await this.dataSource.query<TraceRow[]>(
      `
      WITH target_orders AS (
        SELECT o.id, o.order_number, o.order_status::text AS order_status, o.order_type::text AS order_type
        FROM orders o
        WHERE ${where}
        ORDER BY o.created_at DESC
        ${limit ? `LIMIT ${Number(limit)}` : ''}
      )
      SELECT t.id AS order_id, t.order_number, t.order_status, t.order_type,
             oa.id AS assignment_id, oa.technician_id, tp.technician_code, u.full_name,
             oa.assignment_status::text AS status, oa.assignment_round,
             oa.sent_at, oa.viewed_at, oa.responded_at, oa.rejection_reason_code,
             oa.distance_km, oa.estimated_eta_minutes, oa.expires_at
      FROM target_orders t
      LEFT JOIN order_assignments oa ON oa.order_id = t.id
      LEFT JOIN technician_profiles tp ON tp.id = oa.technician_id
      LEFT JOIN users u ON u.id = tp.user_id
      ORDER BY t.order_number, oa.assignment_round, oa.sent_at
      `,
      params,
    );

    const byOrder = new Map<string, TraceRow[]>();
    for (const row of rows) {
      const list = byOrder.get(row.order_id);
      if (list) list.push(row);
      else byOrder.set(row.order_id, [row]);
    }

    const now = Date.now();
    return [...byOrder.values()].map((orderRows) => this.toTrace(orderRows, maxRounds, now));
  }

  private toTrace(orderRows: TraceRow[], maxRounds: number, now: number): OrderTrace {
    const head = orderRows[0];
    // LEFT JOIN بيرجّع صف واحد بـassignment فاضي للطلب اللي لسه مفيش عليه عروض.
    const assignments = orderRows.filter((r) => r.assignment_id !== null);

    const counts = { sent: 0, viewed: 0, rejected: 0, accepted: 0, timeout: 0, cancelled: 0 };
    for (const a of assignments) {
      if (a.status in counts) counts[a.status as keyof typeof counts] += 1;
    }

    const roundNumbers = [...new Set(assignments.map((a) => a.assignment_round))].sort((x, y) => x - y);
    const rounds: OrderTraceRound[] = roundNumbers.map((round) => {
      const inRound = assignments.filter((a) => a.assignment_round === round);
      return {
        round,
        startedAt: inRound.reduce((min, a) => (a.sent_at < min ? a.sent_at : min), inRound[0].sent_at),
        expansionDueAt: inRound.reduce((max, a) => (a.expires_at > max ? a.expires_at : max), inRound[0].expires_at),
        technicians: inRound.map((a) => ({
          assignmentId: a.assignment_id,
          technicianId: a.technician_id,
          technicianCode: a.technician_code,
          fullName: a.full_name,
          status: a.status,
          sentAt: a.sent_at,
          viewedAt: a.viewed_at,
          respondedAt: a.responded_at,
          rejectionReasonCode: a.rejection_reason_code,
          distanceKm: a.distance_km === null ? null : Number(a.distance_km),
          estimatedEtaMinutes: a.estimated_eta_minutes,
        })),
      };
    });

    const currentRound = roundNumbers.length > 0 ? roundNumbers[roundNumbers.length - 1] : null;
    const lastRound = rounds[rounds.length - 1] ?? null;
    const { nextAction, nextActionAt } = this.deriveNextAction(
      head.order_status,
      counts.accepted,
      currentRound,
      maxRounds,
      lastRound,
    );

    const delaySeconds =
      nextAction === 'expand_next_round' && nextActionAt
        ? Math.max(0, Math.floor((now - new Date(nextActionAt).getTime()) / 1000))
        : 0;

    return {
      orderId: head.order_id,
      orderNumber: head.order_number,
      orderStatus: head.order_status,
      isEmergency: head.order_type === 'emergency',
      currentRound,
      maxRounds,
      techniciansContacted: new Set(assignments.map((a) => a.technician_id)).size,
      counts,
      rounds,
      nextAction,
      nextActionAt,
      delaySeconds,
    };
  }

  /**
   * القاعدة كلها مشتقّة من حالة موجودة — مفيش تخمين:
   *   * الطلب مش بيدوّر            → مفيش مطابقة مطلوبة (أو اتقفل على فني).
   *   * في عرض مقبول               → اتعيّن.
   *   * مفيش جولات لسه             → البث الأول لسه ما حصلش.
   *   * مهلة آخر جولة لسه جاية     → مستنيين رد الفنيين.
   *   * المهلة عدّت وفي جولات فاضلة → المفروض توسيع، والتأخير = الفرق.
   *   * المهلة عدّت وخلصت الجولات   → المطابقة استنفدت.
   */
  private deriveNextAction(
    orderStatus: string,
    acceptedCount: number,
    currentRound: number | null,
    maxRounds: number,
    lastRound: OrderTraceRound | null,
  ): { nextAction: OrderTraceNextAction; nextActionAt: string | null } {
    if (acceptedCount > 0) return { nextAction: 'assigned', nextActionAt: null };
    if (orderStatus !== 'searching_technician') return { nextAction: 'no_matching_required', nextActionAt: null };
    if (currentRound === null || lastRound === null) {
      return { nextAction: 'waiting_technician_response', nextActionAt: null };
    }

    const dueAt = new Date(lastRound.expansionDueAt).getTime();
    if (Date.now() < dueAt) {
      return { nextAction: 'waiting_technician_response', nextActionAt: lastRound.expansionDueAt };
    }
    if (currentRound >= maxRounds) return { nextAction: 'matching_exhausted', nextActionAt: null };
    return { nextAction: 'expand_next_round', nextActionAt: lastRound.expansionDueAt };
  }
}
