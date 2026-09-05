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

/**
 * الصلاحية المطلوبة للاشتراك في كل موضوع (بتتفحص حية وقت الاشتراك).
 *
 * **القاعدة: الموضوع بيطلب نفس صلاحية الشاشة اللي بيغذّيها.** ستة مواضيع كانوا `null` (أي أدمن)،
 * وده بقى تناقض صريح بعد تدقيق S-1: `GET /admin/orders` بقى بيطلب `orders.view`، فموظف مالوش
 * الصلاحية دي كان بياخد 403 على الـREST **و** بيستقبل نفس أحداث الطلبات لحظيًا على السوكِت.
 * بوابتين لنفس البيانات بمعيارين مختلفين = الأضعف فيهم هو الفعلي.
 *
 * `null` لسه ممكن، بس بقى قرار مكتوب مش افتراضي — ومفيش موضوع مستخدمه حاليًا.
 */
export const TOPIC_PERMISSIONS: Record<AdminTopic, string | null> = {
  orders: 'orders.view',
  technicians: 'technicians.view',
  payments: 'payments.view',
  refunds: 'refunds.view',
  support: 'support_tickets.view',
  // التقييمات بتتعرض جوّه شاشة الطلب وبتشاور على طلب بالاسم — نفس صلاحية الطلبات بالظبط.
  ratings: 'orders.view',
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
