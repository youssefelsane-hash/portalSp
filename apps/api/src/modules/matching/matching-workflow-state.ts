import { OrderStatus } from '../orders/entities/order.entity';

/**
 * **المصدر الوحيد لسؤالين: «الخطوة الجاية إيه وامتى؟» و«الـworkflow متأخر؟»**
 *
 * الوحدة دي **نقية** (بلا DB ولا حقن) عمدًا: بتتنادى من مسار تفاصيل الطلب الواحد ومن استعلام
 * Operations المجمّع ومن Exception Center — التلاتة. لو كل واحد فيهم اشتق القاعدة بنفسه كنا
 * هنرجع لنفس المشكلة اللي المشروع اتعب فيها: نفس السؤال بتلات إجابات بتفترق مع أول تعديل.
 *
 * **مفيش scheduler هنا ولا قراءة queue.** التوقيت كله مشتق من الحقيقة المحفوظة في القاعدة
 * (`order_assignments.expires_at` + إعداد `matching.max_rounds`) — الـqueue بينفّذ التوسيع،
 * وde الجدول بيقول امتى كان **مفروض** ينفّذه. لما الاتنين يفترقوا، ده بالظبط التأخير اللي عايزين
 * الأدمن يشوفه.
 *
 * تحذير دلالي مهم (ADR-0018 §5): `expires_at` **مش** وقت انتهاء صلاحية العرض — العرض بيفضل
 * قابل للقبول بعدها. هي وقت **توسيع البث** لفنيين إضافيين. الأسماء هنا بتعكس ده بالحرف.
 */

/** الحالات اللي الطلب فيها بيدوّر على فني فعليًا — بره دول مفيش «جولة جاية» أصلاً. */
const MATCHING_ACTIVE_STATUSES: ReadonlySet<OrderStatus> = new Set([OrderStatus.SEARCHING_TECHNICIAN]);

export type MatchingWorkflowPhase =
  /** الطلب مش في مرحلة بحث أصلاً (مجدول/منفَّذ/ملغي…) — مفيش خطوة مطابقة منتظرة. */
  | 'not_matching'
  /** بيدوّر بس لسه ماتبعتش لأي فني — أول جولة لسه ما اتعملتش. */
  | 'not_dispatched'
  /** فيه عروض قايمة لسه في مهلتها — النظام مستني رد الفنيين. */
  | 'awaiting_technician_response'
  /** عدّى وقت توسيع البث والجولة الجاية لسه ما اتعملتش. */
  | 'round_expansion_due'
  /** وصلنا سقف الجولات ومحدش قبل — مستني تدخّل/استرداد. */
  | 'rounds_exhausted';

export interface MatchingWorkflowInput {
  orderStatus: OrderStatus;
  /** أعلى `assignment_round` على الطلب — صفر يعني مفيش أي توزيع لسه. */
  currentRound: number;
  /** أقصى `expires_at` في الجولة الحالية = وقت توسيع البث المفروض. */
  roundExpansionDueAt: Date | null;
  /** عدد العروض اللي لسه `sent`/`viewed` في الجولة الحالية. */
  pendingInCurrentRound: number;
  maxRounds: number;
  graceSeconds: number;
  now: Date;
}

export interface MatchingWorkflowState {
  phase: MatchingWorkflowPhase;
  /** امتى الخطوة الجاية مفروض تحصل — null لو مفيش خطوة تلقائية منتظرة. */
  nextActionAt: Date | null;
  /** ثواني التأخير بعد المهلة — صفر لما يكون سليم. */
  delaySeconds: number;
  /** `true` بس لما الخطوة كان مفروض تحصل وعدّت مهلة السماح ولسه ما حصلتش. */
  isDelayed: boolean;
}

export function deriveMatchingWorkflowState(input: MatchingWorkflowInput): MatchingWorkflowState {
  const healthy = (phase: MatchingWorkflowPhase, nextActionAt: Date | null = null): MatchingWorkflowState => ({
    phase,
    nextActionAt,
    delaySeconds: 0,
    isDelayed: false,
  });

  if (!MATCHING_ACTIVE_STATUSES.has(input.orderStatus)) return healthy('not_matching');
  if (input.currentRound === 0) return healthy('not_dispatched');

  // وصلنا السقف: مفيش توسيع جاي مهما طال الوقت، فالانتظار هنا **مش** تأخير — ده وضع نهائي
  // بيحتاج تدخّل إداري أو استرداد. خلطه بالتأخير كان هيدفن التنبيه الحقيقي وسط ضوضاء.
  if (input.currentRound >= input.maxRounds) return healthy('rounds_exhausted');

  if (input.roundExpansionDueAt === null) {
    // جولة موجودة من غير وقت توسيع — مش مفروض يحصل، بس منقولش «متأخر» على أساس بيانات ناقصة.
    return healthy(input.pendingInCurrentRound > 0 ? 'awaiting_technician_response' : 'round_expansion_due');
  }

  const overdueMs = input.now.getTime() - input.roundExpansionDueAt.getTime();
  if (overdueMs <= 0) {
    return healthy('awaiting_technician_response', input.roundExpansionDueAt);
  }

  // عدّى وقت التوسيع والجولة الجاية ما اتعملتش (الكولر بيستدعي الدالة دي بـ`currentRound` الأعلى
  // فعليًا، فوجودنا هنا معناه إن الجولة الجاية مش موجودة).
  const delaySeconds = Math.floor(overdueMs / 1000);
  return {
    phase: 'round_expansion_due',
    nextActionAt: input.roundExpansionDueAt,
    delaySeconds,
    isDelayed: delaySeconds > input.graceSeconds,
  };
}

/** نص عربي واحد لكل حالة — الواجهات بتعرضه زي ما هو، مابتشتقّش نص من عندها. */
export const MATCHING_WORKFLOW_PHASE_AR: Record<MatchingWorkflowPhase, string> = {
  not_matching: 'مفيش مطابقة جارية',
  not_dispatched: 'لسه ما اتوزّعش على أي فني',
  awaiting_technician_response: 'مستني رد الفنيين',
  round_expansion_due: 'توسيع البث لجولة جديدة',
  rounds_exhausted: 'خلصت جولات التوزيع بلا قبول',
};

/**
 * مصدر إسناد الطلب — **مشتق** من الحقيقة المحفوظة، مش عمود جديد.
 *
 * كل قيمة هنا ليها إثبات مباشر في البيانات: قفل المنفّذ بيتسجّل في `provider_lock_source`
 * (ADR-0065)، وإعادة الزيارة في `revisit_pinned_technician_id` (ADR-0051)، والتعيين الإداري في
 * `order_status_history.change_source='admin'`. إضافة عمود `assignment_source` كانت هتبقى نسخة
 * تالتة من معلومة محفوظة مرتين أصلاً.
 */
export type OrderAssignmentSource =
  | 'customer_selected'
  | 'post_quote_selection'
  | 'revisit_pinned'
  | 'admin_assignment'
  | 'auto_match'
  | 'not_assigned';

export interface AssignmentSourceInput {
  technicianId: string | null;
  providerLockSource: string | null;
  revisitPinnedTechnicianId: string | null;
  /** `true` لو `order_status_history` فيه تعيين/إعادة تعيين مصدره الأدمن. */
  hasAdminAssignmentHistory: boolean;
}

export function deriveAssignmentSource(input: AssignmentSourceInput): OrderAssignmentSource {
  if (!input.technicianId) return 'not_assigned';
  // الترتيب مقصود: الأدمن بيغلب أي إسناد سابق لأنه **آخر** قرار حصل فعليًا على الطلب.
  if (input.hasAdminAssignmentHistory) return 'admin_assignment';
  if (input.revisitPinnedTechnicianId === input.technicianId) return 'revisit_pinned';
  if (input.providerLockSource === 'post_quote_selection') return 'post_quote_selection';
  if (input.providerLockSource !== null) return 'customer_selected';
  return 'auto_match';
}

export const ORDER_ASSIGNMENT_SOURCE_AR: Record<OrderAssignmentSource, string> = {
  customer_selected: 'العميل اختار الفني بنفسه',
  post_quote_selection: 'العميل اختار الفني بعد عرض السعر',
  revisit_pinned: 'إعادة زيارة مثبّتة على نفس الفني',
  admin_assignment: 'تعيين إداري',
  auto_match: 'مطابقة تلقائية',
  not_assigned: 'لسه مفيش فني معيّن',
};
