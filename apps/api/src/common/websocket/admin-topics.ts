// خريطة مواضيع التحديثات الحية للأدمن (docs/01B مهمة B) — المصدر الوحيد للعلاقة بين
// topic ↔ الصلاحية المطلوبة للاشتراك فيه. null = يكفي أن الحساب admin.
// الغرف دايمًا `admin:topic:{topic}` — البوابة بتفحص الصلاحية وقت الاشتراك فقط، والبيانات
// نفسها بتتدفع للأعضاء من AdminRealtimeGateway handlers.

export const ADMIN_TOPICS = [
  'orders',
  'technicians',
  'payments',
  'payouts',
  'refunds',
  'support',
  'installments',
  'recurring',
  'settings',
  'security',
  'ratings',
  'projects',
  'warranty',
] as const;

export type AdminTopic = (typeof ADMIN_TOPICS)[number];

/** null = أي حساب أدمن؛ نص = صلاحية مطلوبة (بتتفحص حية وقت الاشتراك). */
export const TOPIC_PERMISSIONS: Record<AdminTopic, string | null> = {
  orders: null,
  technicians: null,
  payments: null,
  refunds: null,
  support: null,
  ratings: null,
  payouts: 'payouts.view',
  installments: 'installments.view',
  recurring: 'recurring_orders.view',
  settings: 'settings.manage',
  security: 'security.alerts.view',
  projects: 'projects.view',
  warranty: 'warranty.view',
};

/** payload موحّد لأي حدث حي — `at` لحظة وقوع الحدث في السيرفر (ISO) للحماية من الكتابة القديمة. */
export interface AdminLiveEvent {
  topic: AdminTopic;
  entity:
    | 'order'
    | 'technician'
    | 'payment'
    | 'payout'
    | 'refund'
    | 'complaint'
    | 'support_message'
    | 'installment_application'
    | 'installment_payment'
    | 'recurring_template'
    | 'rating'
    | 'setting'
    | 'security_event'
    | 'project'
    | 'warranty_claim';
  action: string;
  entity_id: string | null;
  at: string;
  data?: Record<string, unknown>;
}
