import { DataSource } from 'typeorm';
import { ApiException } from '../../common/exceptions/api.exception';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditLogService } from '../audit/audit-log.service';
import {
  PaymentPolicy,
  PaymentPolicyAcceptance,
  PaymentPolicyVersion,
} from './entities/payment-policy.entity';
import { purgeAuditLogs } from '../../common/db/audit-purge.testing';
import { PaymentPoliciesService } from './payment-policies.service';

/**
 * تدقيق T-1 — موديول `payment-policies` كان **صفر اختبارات** رغم إنه بوابة قانونية على الحجز:
 * لو `listApplicableForCheckout()` رجّعت سياسة غلط أو نسخة قديمة، العميل بيوافق على نص غير
 * اللي اتسجّل عليه — أو بيتقفل عليه حجز بسياسة مالهاش علاقة بخدمته.
 *
 * التركيز على المنطق اللي مالوش أي حارس تاني:
 *
 * - **أسبقية الاستهداف**: خدمة بعينها تتفوّق على الفئة تتفوّق على العام، وواحدة بس لكل سياسة
 *   (`DISTINCT ON`). SQL معقّد بـ`LATERAL` + `DISTINCT ON` — mock مايختبرهوش.
 * - **النسخة الحالية دايمًا الأحدث**: عميل بيوافق على نسخة قديمة = القبول مالوش قيمة.
 * - **`assertAllRequiredAccepted`**: البوابة نفسها. غياب أي نسخة إجبارية بيرمي بأسماء واضحة.
 * - **ترقيم النسخ**: `MAX(version)+1` تحت قفل — نسختين بنفس الرقم يكسروا تتبّع الموافقات.
 */
describe('PaymentPoliciesService (تدقيق T-1) — حي', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: PaymentPoliciesService;

  const runId = Date.now().toString(36);
  const createdPolicies: string[] = [];
  let adminUserId = '';
  let customerUserId = '';
  let categoryId = '';
  let serviceId = '';
  let otherServiceId = '';

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => dataSource.query(sql, params) as Promise<T>;

  async function makePolicy(
    label: string,
    opts: { isRequired?: boolean; isActive?: boolean; serviceId?: string; categoryId?: string; body?: string } = {},
  ): Promise<{ policyId: string; versionId: string }> {
    const [policy] = await q<{ id: string }[]>(
      `INSERT INTO payment_policies (slug, title_ar, applies_to, target_service_id, target_category_id, is_required, is_active)
       VALUES ($1,$2,'checkout',$3,$4,$5,$6) RETURNING id`,
      [
        `pp-${label}-${runId}`,
        `سياسة ${label} ${runId}`,
        opts.serviceId ?? null,
        opts.categoryId ?? null,
        opts.isRequired ?? true,
        opts.isActive ?? true,
      ],
    );
    createdPolicies.push(policy.id);
    const [version] = await q<{ id: string }[]>(
      `INSERT INTO payment_policy_versions (policy_id, version, body_ar) VALUES ($1, 1, $2) RETURNING id`,
      [policy.id, opts.body ?? `نص السياسة ${label} — النسخة الأولى، طويل كفاية للتحقق.`],
    );
    return { policyId: policy.id, versionId: version.id };
  }

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [PaymentPolicy, PaymentPolicyVersion, PaymentPolicyAcceptance, AuditLog],
    }).initialize();

    service = new PaymentPoliciesService(
      dataSource.getRepository(PaymentPolicy),
      dataSource.getRepository(PaymentPolicyVersion),
      dataSource.getRepository(PaymentPolicyAcceptance),
      dataSource,
      new AuditLogService(dataSource.getRepository(AuditLog)),
    );

    const [admin] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+20pp1${runId}`.slice(0, 15), `أدمن سياسات ${runId}`],
    );
    adminUserId = admin.id;
    const [customer] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+20pp2${runId}`.slice(0, 15), `عميل سياسات ${runId}`],
    );
    customerUserId = customer.id;

    const [category] = await q<{ id: string }[]>(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة سياسات ${runId}`, `Policy Cat ${runId}`, `policy-cat-${runId}`],
    );
    categoryId = category.id;
    const mkService = async (label: string): Promise<string> => {
      const [row] = await q<{ id: string }[]>(
        `INSERT INTO services (category_id, name_ar, name_en, slug, base_price_cents, pricing_model)
         VALUES ($1,$2,$3,$4,10000,'inspection_then_quote') RETURNING id`,
        [categoryId, `خدمة ${label} ${runId}`, `Service ${label} ${runId}`, `svc-${label}-${runId}`],
      );
      return row.id;
    };
    serviceId = await mkService('a');
    otherServiceId = await mkService('b');
  });

  afterEach(async () => {
    if (createdPolicies.length === 0) return;
    await q(
      `DELETE FROM payment_policy_acceptances WHERE policy_version_id IN
         (SELECT id FROM payment_policy_versions WHERE policy_id = ANY($1))`,
      [createdPolicies],
    );
    await q(`DELETE FROM payment_policy_versions WHERE policy_id = ANY($1)`, [createdPolicies]);
    await purgeAuditLogs(dataSource, `DELETE FROM audit_logs WHERE actor_user_id = $1`, [adminUserId]);
    await q(`DELETE FROM payment_policies WHERE id = ANY($1)`, [createdPolicies]);
    createdPolicies.length = 0;
  });

  afterAll(async () => {
    const ids = [serviceId, otherServiceId].filter(Boolean);
    if (ids.length > 0) await q(`DELETE FROM services WHERE id = ANY($1)`, [ids]);
    if (categoryId) await q(`DELETE FROM service_categories WHERE id = $1`, [categoryId]);
    await q(`DELETE FROM users WHERE id = ANY($1)`, [[adminUserId, customerUserId].filter(Boolean)]);
    await dataSource.destroy();
  });

  /** السياسات العامة الموجودة في القاعدة أصلاً مش تحت سيطرة الاختبار — بنفلتر على بتوعنا. */
  const mine = <T extends { slug: string }>(rows: T[]): T[] => rows.filter((r) => r.slug.includes(runId));

  describe('listApplicableForCheckout — أسبقية الاستهداف', () => {
    it('سياسة مستهدفة لخدمة بترجع لخدمتها بس', async () => {
      await makePolicy('للخدمة', { serviceId });
      const forService = mine(await service.listApplicableForCheckout({ appliesTo: 'checkout', serviceId }));
      const forOther = mine(await service.listApplicableForCheckout({ appliesTo: 'checkout', serviceId: otherServiceId }));
      expect(forService).toHaveLength(1);
      expect(forOther).toHaveLength(0);
    });

    it('سياسة مستهدفة لفئة بتطبّق على كل خدمات الفئة — والفئة بتتشتق من الخدمة لو مااتبعتتش', async () => {
      await makePolicy('للفئة', { categoryId });
      // الفئة مااتبعتتش صراحةً: لازم تتشتق من `services.category_id` بتاع الخدمة المختارة.
      const derived = mine(await service.listApplicableForCheckout({ appliesTo: 'checkout', serviceId }));
      expect(derived).toHaveLength(1);
      expect(derived[0].titleAr).toContain('للفئة');
    });

    it('العام + الفئة + الخدمة: التلاتة بيرجعوا مع بعض، كل واحد مرة واحدة', async () => {
      await makePolicy('عام');
      await makePolicy('فئة', { categoryId });
      await makePolicy('خدمة', { serviceId });
      const rows = mine(await service.listApplicableForCheckout({ appliesTo: 'checkout', serviceId }));
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((r) => r.policyId)).size).toBe(3);
    });

    it('سياسة معطّلة مابترجعش خالص', async () => {
      await makePolicy('معطّلة', { isActive: false });
      expect(mine(await service.listApplicableForCheckout({ appliesTo: 'checkout', serviceId }))).toHaveLength(0);
    });

    it('بترجع **آخر** نسخة، مش أول واحدة — الموافقة على نص قديم مالهاش قيمة', async () => {
      const { policyId } = await makePolicy('متعددة النسخ');
      await service.publishNewVersion(adminUserId, policyId, 'النسخة التانية من نص السياسة، أطول من عشرين حرف.');
      await service.publishNewVersion(adminUserId, policyId, 'النسخة التالتة من نص السياسة، أطول من عشرين حرف.');

      const [row] = mine(await service.listApplicableForCheckout({ appliesTo: 'checkout', serviceId }));
      expect(row.currentVersion).toBe(3);
      expect(row.bodyAr).toContain('التالتة');
    });

    it('listRequiredForCheckout بترجّع الإجبارية بس', async () => {
      await makePolicy('إجبارية', { isRequired: true });
      await makePolicy('اختيارية', { isRequired: false });
      const all = mine(await service.listApplicableForCheckout({ appliesTo: 'checkout', serviceId }));
      const required = mine(await service.listRequiredForCheckout({ appliesTo: 'checkout', serviceId }));
      expect(all).toHaveLength(2);
      expect(required).toHaveLength(1);
      expect(required[0].isRequired).toBe(true);
    });
  });

  describe('assertAllRequiredAccepted — البوابة نفسها', () => {
    it('كل النسخ الإجبارية متقبولة: بتعدّي', async () => {
      const { versionId } = await makePolicy('مقبولة');
      const required = mine(await service.listRequiredForCheckout({ appliesTo: 'checkout', serviceId }));
      expect(() => service.assertAllRequiredAccepted(required, new Set([versionId]))).not.toThrow();
    });

    it('نسخة إجبارية ناقصة: بترمي وبتسمّي السياسة الناقصة بالاسم', async () => {
      await makePolicy('ناقصة');
      const required = mine(await service.listRequiredForCheckout({ appliesTo: 'checkout', serviceId }));
      expect(() => service.assertAllRequiredAccepted(required, new Set())).toThrow(ApiException);
      try {
        service.assertAllRequiredAccepted(required, new Set());
      } catch (err) {
        expect((err as ApiException).message).toContain('ناقصة');
      }
    });

    it('**الحالة الخطرة**: موافقة على نسخة **قديمة** من نفس السياسة بتترفض', async () => {
      const { policyId, versionId: oldVersionId } = await makePolicy('اتحدّثت');
      await service.publishNewVersion(adminUserId, policyId, 'نسخة جديدة بعد ما العميل وافق على القديمة.');

      const required = mine(await service.listRequiredForCheckout({ appliesTo: 'checkout', serviceId }));
      // العميل ماسك النسخة الأولى، والمطلوب دلوقتي التانية.
      expect(() => service.assertAllRequiredAccepted(required, new Set([oldVersionId]))).toThrow(ApiException);
    });
  });

  describe('recordAcceptance / publishNewVersion', () => {
    it('القبول بيتسجّل مربوط بالسياق (طلب) مش مجرّد علامة', async () => {
      const { versionId } = await makePolicy('إثبات');
      await service.recordAcceptance({
        userId: customerUserId,
        policyVersionId: versionId,
        contextType: 'order',
        contextId: '01a00000-0000-7000-8000-0000000000aa',
      });
      const [row] = await q<{ context_type: string; context_id: string; user_id: string }[]>(
        `SELECT context_type, context_id, user_id FROM payment_policy_acceptances WHERE policy_version_id = $1`,
        [versionId],
      );
      expect(row).toEqual({
        context_type: 'order',
        context_id: '01a00000-0000-7000-8000-0000000000aa',
        user_id: customerUserId,
      });
    });

    it('قبول لنسخة مش موجودة بيترفض بدل ما يتسجّل إثبات وهمي', async () => {
      await expect(
        service.recordAcceptance({
          userId: customerUserId,
          policyVersionId: '01a00000-0000-7000-8000-0000000000bb',
          contextType: 'order',
          contextId: '01a00000-0000-7000-8000-0000000000cc',
        }),
      ).rejects.toBeInstanceOf(ApiException);
    });

    it('ترقيم النسخ متسلسل ومفيش تكرار', async () => {
      const { policyId } = await makePolicy('ترقيم');
      const v2 = await service.publishNewVersion(adminUserId, policyId, 'النسخة التانية من نص السياسة الطويل.');
      const v3 = await service.publishNewVersion(adminUserId, policyId, 'النسخة التالتة من نص السياسة الطويل.');
      expect([v2.version, v3.version]).toEqual([2, 3]);

      const versions = await service.listVersions(policyId);
      expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    });

    it('نص قصير بيترفض قبل ما يوصل للقاعدة', async () => {
      const { policyId } = await makePolicy('قصيرة');
      await expect(service.publishNewVersion(adminUserId, policyId, 'قصير')).rejects.toBeInstanceOf(ApiException);
    });

    it('نشر نسخة لسياسة مش موجودة بيرمي NOT_FOUND', async () => {
      await expect(
        service.publishNewVersion(adminUserId, '01a00000-0000-7000-8000-0000000000dd', 'نص طويل كفاية للتحقق منه.'),
      ).rejects.toBeInstanceOf(ApiException);
    });

    it('listAll بترجّع آخر رقم نسخة لكل سياسة', async () => {
      const { policyId } = await makePolicy('ملخّص');
      await service.publishNewVersion(adminUserId, policyId, 'نسخة تانية عشان الرقم يبقى ٢ مش ١.');
      const rows = (await service.listAll()).filter((p) => p.slug.includes(runId));
      expect(rows).toHaveLength(1);
      expect(rows[0].latest_version).toBe(2);
    });
  });
});
