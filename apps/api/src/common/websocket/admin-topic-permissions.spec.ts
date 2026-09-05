import { DataSource } from 'typeorm';
import { ADMIN_TOPICS, TOPIC_PERMISSIONS } from './admin-topics';
import { loadEffectivePermissionNames } from '../rbac/effective-permissions';

/**
 * تدقيق A-4 — الاشتراك في مواضيع البث اللحظي.
 *
 * فيه مشكلتين اتصلّحوا مع بعض هنا:
 *
 * 1. **أداء**: `handleSubscribe` كان بينده `topicAllowed()` لكل موضوع، وكل نداء استعلامين. ١٣
 *    موضوع = ٢٦ استعلام لكل اشتراك، كلهم بنفس الإجابة. بقى استعلام واحد والقرار في الذاكرة.
 * 2. **تناقض تفويض**: ستة مواضيع كانوا `null` (أي أدمن). بعد تدقيق S-1 بقى `GET /admin/orders`
 *    بيطلب `orders.view` — فموظف مالوش الصلاحية كان بياخد 403 على الـREST وبيستقبل **نفس**
 *    أحداث الطلبات لحظيًا على السوكِت. بوابتين لنفس البيانات بمعيارين، والأضعف هو الفعلي.
 *
 * وكمان الجيتواي كان بيكرّر استعلام الصلاحيات بنفسه (تفاديًا لدورة استيراد)، فقاعدة الاشتقاق
 * (ADR-0074) اتضافت في `PermissionsService` بس — نفس المستخدم مسموح على الـREST ومرفوض على
 * السوكِت. الاتنين بقوا بينادوا `loadEffectivePermissionNames` نفسها.
 */
describe('صلاحيات مواضيع البث اللحظي (تدقيق A-4) — حي', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = Date.now().toString(36);
  let narrowUserId = '';
  let narrowRoleId = '';

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => dataSource.query(sql, params) as Promise<T>;

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    }).initialize();

    const [role] = await q<{ id: string }[]>(
      `INSERT INTO roles (name, display_name) VALUES ($1,$2) RETURNING id`,
      [`a4_tickets_only_${runId}`, `تذاكر فقط ${runId}`],
    );
    narrowRoleId = role.id;
    await q(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE name = 'support_tickets.manage'`,
      [narrowRoleId],
    );
    const [user] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+20a4${runId}`.slice(0, 15), `أدمن A4 ${runId}`],
    );
    narrowUserId = user.id;
    await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)`, [narrowUserId, narrowRoleId]);
  });

  afterAll(async () => {
    await q(`DELETE FROM user_roles WHERE user_id = $1`, [narrowUserId]);
    await q(`DELETE FROM users WHERE id = $1`, [narrowUserId]);
    await q(`DELETE FROM role_permissions WHERE role_id = $1`, [narrowRoleId]);
    await q(`DELETE FROM roles WHERE id = $1`, [narrowRoleId]);
    await dataSource.destroy();
  });

  it('كل موضوع له مدخل في الخريطة — مفيش موضوع بيعدّي بالسهو', () => {
    for (const topic of ADMIN_TOPICS) {
      expect(Object.prototype.hasOwnProperty.call(TOPIC_PERMISSIONS, topic)).toBe(true);
    }
  });

  it('مفيش موضوع مفتوح لأي أدمن — كل واحد وراء صلاحية صريحة', () => {
    const open = ADMIN_TOPICS.filter((t) => TOPIC_PERMISSIONS[t] === null);
    expect(open).toEqual([]);
  });

  it('كل صلاحية مذكورة في الخريطة موجودة فعلاً في الكتالوج (اسم غلط = موضوع مقفول للأبد)', async () => {
    const required = Array.from(new Set(Object.values(TOPIC_PERMISSIONS).filter((v): v is string => v !== null)));
    const rows = await q<{ name: string }[]>(`SELECT name FROM permissions WHERE name = ANY($1::text[])`, [required]);
    const known = new Set(rows.map((r) => r.name));
    expect(required.filter((n) => !known.has(n))).toEqual([]);
  });

  it('الموضوع بيطلب نفس صلاحية الشاشة اللي بيغذّيها', () => {
    expect(TOPIC_PERMISSIONS.orders).toBe('orders.view');
    expect(TOPIC_PERMISSIONS.technicians).toBe('technicians.view');
    expect(TOPIC_PERMISSIONS.refunds).toBe('refunds.view');
    expect(TOPIC_PERMISSIONS.support).toBe('support_tickets.view');
    expect(TOPIC_PERMISSIONS.payouts).toBe('payouts.view');
    // التقييمات بتتعرض جوّه شاشة الطلب — نفس صلاحيتها بالظبط.
    expect(TOPIC_PERMISSIONS.ratings).toBe('orders.view');
  });

  it('قاعدة الاشتقاق بتوصل للسوكِت زي الـREST بالظبط (مصدر واحد)', async () => {
    const permissions = await loadEffectivePermissionNames(dataSource, narrowUserId);
    const allows = (topic: (typeof ADMIN_TOPICS)[number]): boolean => {
      const required = TOPIC_PERMISSIONS[topic];
      return required === null || permissions.has(required);
    };

    // عنده `support_tickets.manage` بس → بياخد `support_tickets.view` بالاشتقاق، فموضوع
    // الدعم مسموح. من غير المصدر المشترك كان هيتقفل هنا رغم إنه مفتوح على الـREST.
    expect(allows('support')).toBe(true);
    // ومابيتخطّاش المورد: الطلبات والمدفوعات والأمان مقفولين.
    expect(allows('orders')).toBe(false);
    expect(allows('payments')).toBe(false);
    expect(allows('security')).toBe(false);
    expect(allows('settings')).toBe(false);
  });
});
