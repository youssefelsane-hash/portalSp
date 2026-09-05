import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource, QueryFailedError } from 'typeorm';
import { purgeAuditLogs } from '../../common/db/audit-purge.testing';
import { AuditLog } from './entities/audit-log.entity';
import { AuditLogService } from './audit-log.service';

/**
 * تدقيق T-1 — موديول `audit` كان **صفر اختبارات**، وهو الموديول اللي بقية النظام بيتّكل عليه
 * كدليل على مين عمل إيه. فيه تلات حاجات محتاجة إثبات:
 *
 * 1. **الوعد اللي `record()` بيقطعه**: نداء بـ`manager` (جوّه ترانزاكشن عمل حسّاس) لازم يرمي
 *    الخطأ عشان العملية نفسها ماتـcommitش من غير سجلها؛ ونداء من غير `manager` best-effort
 *    مايكسرش العملية. التصرّفين متعاكسين تمامًا ومكتوبين في تعليق بس.
 * 2. **عدم قابلية السجل للتعديل**: `0011` كتب `REVOKE UPDATE, DELETE ... FROM PUBLIC` والكود
 *    بيتّكل على ده صراحةً، بس التطبيق بيتصل بدور **مالك** الجداول واللي مابيتأثرش بالـREVOKE.
 *    الاختبار ده أثبت إن الوعد ماكانش موجود، والإصلاح تريجر (migration 0271).
 * 3. **حارس بنيوي للمخرج**: لو أي ملف إنتاج ذكر مفتاح `app.audit_purge` يبقى المخرج اتسرّب من
 *    أدوات الاختبار للكود الحقيقي — الاختبار بيفشل ساعتها.
 */
describe('AuditLogService + عدم قابلية سجل التدقيق للتعديل (تدقيق T-1) — حي', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: AuditLogService;

  const runId = Date.now().toString(36);
  const entityType = `t1_audit_${runId}`.slice(0, 60);
  let actorId = '';

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => dataSource.query(sql, params) as Promise<T>;

  const entityId = (suffix: string): string => `01a00000-0000-7000-8000-000000000${suffix}`;

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [AuditLog],
    }).initialize();

    service = new AuditLogService(dataSource.getRepository(AuditLog));

    const [user] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+20au${runId}`.slice(0, 15), `أدمن تدقيق ${runId}`],
    );
    actorId = user.id;
  });

  afterAll(async () => {
    await purgeAuditLogs(dataSource, `DELETE FROM audit_logs WHERE entity_type = $1 OR actor_user_id = $2`, [
      entityType,
      actorId,
    ]);
    await q(`DELETE FROM users WHERE id = $1`, [actorId]);
    await dataSource.destroy();
  });

  describe('record — الوعد بيتغيّر حسب وجود الترانزاكشن', () => {
    it('بيكتب كل الحقول زي ما اتبعتت (مش بعضها)', async () => {
      await service.record({
        actorUserId: actorId,
        actorRole: 'admin',
        action: 'test.recorded',
        entityType,
        entityId: entityId('001'),
        oldValues: { status: 'a' },
        newValues: { status: 'b' },
        meta: { ip: '10.1.2.3', userAgent: 'jest', requestId: `req-${runId}` },
      });

      const [row] = await q<Record<string, unknown>[]>(
        `SELECT actor_user_id, actor_role, host(actor_ip) AS actor_ip, action, old_values, new_values, user_agent, request_id
         FROM audit_logs WHERE entity_type = $1 AND entity_id = $2`,
        [entityType, entityId('001')],
      );
      expect(row).toMatchObject({
        actor_user_id: actorId,
        actor_role: 'admin',
        actor_ip: '10.1.2.3',
        action: 'test.recorded',
        old_values: { status: 'a' },
        new_values: { status: 'b' },
        user_agent: 'jest',
        request_id: `req-${runId}`,
      });
    });

    it('نداء standalone بصف فاسد بيبتلع الخطأ (best-effort) ومايكسرش العملية اللي نادته', async () => {
      await expect(
        service.record({
          actorUserId: actorId,
          actorRole: 'admin',
          // `action` عندها VARCHAR(80) — النص ده بيتجاوزها فالإدخال بيفشل على مستوى القاعدة.
          action: 'x'.repeat(200),
          entityType,
          entityId: entityId('002'),
        }),
      ).resolves.toBeUndefined();
    });

    it('**العكس بالظبط** جوّه ترانزاكشن: الخطأ بيتمرّر عشان العملية الحسّاسة ماتـcommitش من غير سجلها', async () => {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await expect(
          service.record(
            {
              actorUserId: actorId,
              actorRole: 'admin',
              action: 'x'.repeat(200),
              entityType,
              entityId: entityId('003'),
            },
            runner.manager,
          ),
        ).rejects.toBeDefined();
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });

    it('صف السجل بيتلغي مع الترانزاكشن لو العملية نفسها فشلت بعده', async () => {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await service.record(
        { actorUserId: actorId, actorRole: 'admin', action: 'test.rolled_back', entityType, entityId: entityId('004') },
        runner.manager,
      );
      await runner.rollbackTransaction();
      await runner.release();

      const [row] = await q<{ count: string }[]>(
        `SELECT count(*) FROM audit_logs WHERE entity_type = $1 AND entity_id = $2`,
        [entityType, entityId('004')],
      );
      expect(Number(row.count)).toBe(0);
    });
  });

  describe('عدم قابلية السجل للتعديل (migration 0271)', () => {
    beforeAll(async () => {
      await service.record({
        actorUserId: actorId,
        actorRole: 'admin',
        action: 'test.immutable',
        entityType,
        entityId: entityId('010'),
      });
    });

    it('UPDATE على صف موجود بيترفض من القاعدة نفسها', async () => {
      await expect(
        q(`UPDATE audit_logs SET action = 'tampered' WHERE entity_type = $1 AND entity_id = $2`, [
          entityType,
          entityId('010'),
        ]),
      ).rejects.toBeInstanceOf(QueryFailedError);
    });

    it('DELETE بيترفض برضه — الرفض مش بالصلاحيات (التطبيق مالك الجداول) لكن بتريجر', async () => {
      await expect(
        q(`DELETE FROM audit_logs WHERE entity_type = $1 AND entity_id = $2`, [entityType, entityId('010')]),
      ).rejects.toBeInstanceOf(QueryFailedError);

      const [row] = await q<{ count: string }[]>(
        `SELECT count(*) FROM audit_logs WHERE entity_type = $1 AND entity_id = $2`,
        [entityType, entityId('010')],
      );
      expect(Number(row.count)).toBe(1);
    });

    it('TRUNCATE بيترفض حتى مع مفتاح المخرج (مفيش سبب مشروع لمسح الجدول كله)', async () => {
      await expect(purgeAuditLogs(dataSource, `TRUNCATE audit_logs`)).rejects.toBeInstanceOf(QueryFailedError);
    });

    it('المخرج المقصود شغّال للصيانة/الاختبار — وبيرجع يقفل بعد الترانزاكشن', async () => {
      const id = entityId('011');
      await service.record({ actorUserId: actorId, actorRole: 'admin', action: 'test.purge', entityType, entityId: id });

      await purgeAuditLogs(dataSource, `DELETE FROM audit_logs WHERE entity_type = $1 AND entity_id = $2`, [
        entityType,
        id,
      ]);
      const [row] = await q<{ count: string }[]>(
        `SELECT count(*) FROM audit_logs WHERE entity_type = $1 AND entity_id = $2`,
        [entityType, id],
      );
      expect(Number(row.count)).toBe(0);

      // نفس الاتصال بعد ما الترانزاكشن قفل: الحماية رجعت.
      await expect(q(`DELETE FROM audit_logs WHERE entity_type = $1`, [entityType])).rejects.toBeInstanceOf(
        QueryFailedError,
      );
    });

    it('**حارس بنيوي**: مفيش ملف إنتاج بيفعّل مفتاح المخرج — لو تسرّب، الضمانة بتبطل بالكامل', () => {
      // بندوّر على **تفعيل** المفتاح مش مجرد ذكره: التعليقات اللي بتشرح الآلية مسموحة، اللي
      // ممنوع هو `set_config('app.audit_purge', ...)` أو `SET [LOCAL] app.audit_purge`.
      const enables = /set_config\(\s*['"`]app\.audit_purge|\bSET\s+(LOCAL\s+)?app\.audit_purge/i;
      const root = join(__dirname, '..', '..');
      const offenders: string[] = [];
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) {
            walk(full);
            continue;
          }
          if (!full.endsWith('.ts')) continue;
          if (full.endsWith('.spec.ts') || full.endsWith('.testing.ts')) continue;
          if (enables.test(readFileSync(full, 'utf8'))) offenders.push(full.slice(root.length + 1));
        }
      };
      walk(root);
      expect(offenders).toEqual([]);
    });
  });

  describe('list — الفلترة والترقيم', () => {
    const listed = [entityId('020'), entityId('021'), entityId('022')];

    beforeAll(async () => {
      for (const [index, id] of listed.entries()) {
        await service.record({
          actorUserId: actorId,
          actorRole: 'admin',
          action: index === 0 ? 'test.alpha' : 'test.beta',
          entityType,
          entityId: id,
        });
      }
    });

    it('بيفلتر بنوع الكيان وبيرجع الأحدث الأول', async () => {
      const { items, meta } = await service.list({ entity_type: entityType, page: 1, per_page: 100 });
      const mine = items.filter((i) => listed.includes(i.entityId));
      expect(mine).toHaveLength(3);
      expect(mine.map((i) => i.entityId)).toEqual([...listed].reverse());
      expect(meta.total).toBeGreaterThanOrEqual(3);
    });

    it('بيفلتر بالفعل وبالكيان بعينه', async () => {
      const byAction = await service.list({ entity_type: entityType, action: 'test.alpha', per_page: 50 });
      expect(byAction.items.map((i) => i.entityId)).toEqual([listed[0]]);

      const byEntity = await service.list({ entity_type: entityType, entity_id: listed[2], per_page: 50 });
      expect(byEntity.items).toHaveLength(1);
    });

    it('الترقيم بيقسّم النتايج والـtotal بيفضل الإجمالي مش حجم الصفحة', async () => {
      const first = await service.list({ entity_type: entityType, action: 'test.beta', page: 1, per_page: 1 });
      const second = await service.list({ entity_type: entityType, action: 'test.beta', page: 2, per_page: 1 });

      expect(first.items).toHaveLength(1);
      expect(second.items).toHaveLength(1);
      expect(first.items[0].id).not.toBe(second.items[0].id);
      expect(first.meta.total).toBe(2);
    });

    it('مدى تاريخي مقفول من الطرفين بيستبعد اللي برّه', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const farFuture = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const empty = await service.list({ entity_type: entityType, from: future, to: farFuture, per_page: 50 });
      expect(empty.items).toEqual([]);
      expect(empty.meta.total).toBe(0);
    });
  });
});
