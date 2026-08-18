// Timeline موحّد لتفاصيل الطلب (Script 4 Part G §30-32) — يجمع 4 مصادر منفصلة كانت كل واحدة
// فيها بتتعرض في كارت لوحده (audit_logs, order_status_history, order_assignments,
// technician_order_cancellations) في تسلسل زمني واحد. مصدر البيانات الخام: raw SQL UNION ALL في
// AdminOrdersService.getTimeline() (نفس أسلوب OrderTeamService.listForOrder()).
export type OrderTimelineEventSource = 'status_history' | 'audit_log' | 'assignment' | 'technician_cancellation';

export interface OrderTimelineEventRow {
  id: string;
  ts: Date;
  source: OrderTimelineEventSource;
  title: string;
  detail: Record<string, unknown> | null;
  actorUserId: string | null;
  actorFullName: string | null;
  actorUserType: string | null;
}

export interface OrderTimelineEventResponseDto {
  id: string;
  timestamp: string;
  source: OrderTimelineEventSource;
  title: string;
  detail: Record<string, unknown> | null;
  actor_user_id: string | null;
  actor_full_name: string | null;
  actor_user_type: string | null;
}

export function toOrderTimelineEventResponseDto(row: OrderTimelineEventRow): OrderTimelineEventResponseDto {
  return {
    id: row.id,
    timestamp: row.ts.toISOString(),
    source: row.source,
    title: row.title,
    detail: row.detail,
    actor_user_id: row.actorUserId,
    actor_full_name: row.actorFullName,
    actor_user_type: row.actorUserType,
  };
}
