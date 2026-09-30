/**
 * **نص إلغاء نوبة متكررة** (docs/08 §189 بند D-1، ADR-0116).
 *
 * الإشعار القديم «إلغاء تلقائي — الدفع ماتمش خلال 15 دقيقة» كان بيخلّي العميل يفتكر إن الحجز
 * المتكرر كله اتلغى. النص هنا بيقول ٣ حاجات بس: النوبة دي بس، الخطة لسه شغّالة ولا لأ، والجاية امتى.
 * بيوصل للعميل كنص إشعار الإلغاء التلقائي (`OrderStatusNotificationListener`) وبيتسجّل في الـtimeline.
 */

export type RecurringOccurrenceCancelCause =
  | { kind: 'unpaid'; deadline: Date | null }
  | { kind: 'card_declined'; attempts: number };

export interface RecurringPlanState {
  active: boolean;
  nextRunAt: Date | null;
}

const cairoDateTime = new Intl.DateTimeFormat('ar-EG', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Africa/Cairo',
});

export function formatCairoDateTime(date: Date): string {
  return cairoDateTime.format(date);
}

export function recurringOccurrenceCancelNotice(cause: RecurringOccurrenceCancelCause, plan: RecurringPlanState): string {
  const why =
    cause.kind === 'unpaid'
      ? cause.deadline
        ? `النوبة دي بس اتلغت لأن الدفع ماتمّش قبل آخر ميعاد (${formatCairoDateTime(cause.deadline)}).`
        : 'النوبة دي بس اتلغت لأن الدفع ماتمّش في المهلة.'
      : `النوبة دي بس اتلغت بعد ${cause.attempts} محاولات سحب فاشلة من البطاقة.`;

  if (!plan.active) return `${why} والحجز المتكرر نفسه متوقف، فمفيش نوبات جاية.`;

  const next = plan.nextRunAt ? ` والنوبة الجاية ${formatCairoDateTime(plan.nextRunAt)}` : '';
  const cardHint = cause.kind === 'card_declined' ? ' — حدّث بطاقتك قبلها' : '';
  return `${why} حجزك المتكرر لسه شغّال${next}${cardHint}.`;
}

/** حالة الخطة وقت الإلغاء — بتتقري جوّه نفس الـtransaction اللي بتلغي النوبة. */
export async function loadRecurringPlanState(
  query: (sql: string, params: unknown[]) => Promise<Array<{ active: boolean; next_run_at: Date | null }>>,
  templateId: string,
): Promise<RecurringPlanState> {
  const [row] = await query(
    `SELECT (is_active AND deleted_at IS NULL) AS active, next_run_at
       FROM recurring_order_templates WHERE id = $1`,
    [templateId],
  );
  return { active: row?.active === true, nextRunAt: row?.next_run_at ? new Date(row.next_run_at) : null };
}
