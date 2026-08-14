import { DataSource } from 'typeorm';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlag } from './entities/feature-flag.entity';

// اختبار حي ضد Postgres حقيقي — أول اختبار خالص لـFeatureFlagsService (docs/08 §19 بند 23):
// كانت الميزة كلها بلا أي تغطية اختبار، وبيتأكد هنا إن isEnabledForUser() (منطق الحقيقة الوحيد
// اللي أي كود مستهلك مفروض يستنّى عليه) صحيح فعليًا: kill switch، الاستهداف الصريح بيتخطّى نسبة
// التوزيع، والتوزيع الديترمينستيكي (نفس المستخدم دايمًا نفس النتيجة).
describe('FeatureFlagsService.isEnabledForUser() (docs/08 §19 بند 23)', () => {
  let dataSource: DataSource;
  let service: FeatureFlagsService;

  const runId = Date.now().toString(36);
  const userA = '01a00000-0000-7000-8000-00000000000a';
  const userB = '01a00000-0000-7000-8000-00000000000b';

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [FeatureFlag],
    });
    await dataSource.initialize();
    service = new FeatureFlagsService(dataSource.getRepository(FeatureFlag), {} as never);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM feature_flags WHERE key LIKE $1`, [`test_ff_${runId}_%`]);
    await dataSource.destroy();
  });

  async function insertFlag(opts: {
    key: string;
    isEnabled: boolean;
    rollout?: number;
    users?: string[];
    zones?: string[];
  }) {
    await dataSource.query(
      `INSERT INTO feature_flags (key, is_enabled, rollout_percentage, enabled_for_user_ids, enabled_for_zone_ids)
       VALUES ($1,$2,$3,$4,$5)`,
      [opts.key, opts.isEnabled, opts.rollout ?? 0, opts.users ?? null, opts.zones ?? null],
    );
  }

  it('فلاج مش موجود أصلاً — false (افتراضي آمن)', async () => {
    expect(await service.isEnabledForUser(`test_ff_${runId}_missing`, userA)).toBe(false);
  });

  it('is_enabled=false — kill switch بيقفل كل حاجة حتى لو rollout=100', async () => {
    const key = `test_ff_${runId}_killswitch`;
    await insertFlag({ key, isEnabled: false, rollout: 100 });
    expect(await service.isEnabledForUser(key, userA)).toBe(false);
  });

  it('is_enabled=true + rollout=0 + مفيش استهداف — مقفول لكل الناس', async () => {
    const key = `test_ff_${runId}_zero_rollout`;
    await insertFlag({ key, isEnabled: true, rollout: 0 });
    expect(await service.isEnabledForUser(key, userA)).toBe(false);
    expect(await service.isEnabledForUser(key, userB)).toBe(false);
  });

  it('is_enabled=true + rollout=100 — مفتوح لكل الناس', async () => {
    const key = `test_ff_${runId}_full_rollout`;
    await insertFlag({ key, isEnabled: true, rollout: 100 });
    expect(await service.isEnabledForUser(key, userA)).toBe(true);
    expect(await service.isEnabledForUser(key, userB)).toBe(true);
  });

  it('rollout=0 لكن userA في enabled_for_user_ids — الاستهداف الصريح بيتخطّى نسبة التوزيع', async () => {
    const key = `test_ff_${runId}_targeted_user`;
    await insertFlag({ key, isEnabled: true, rollout: 0, users: [userA] });
    expect(await service.isEnabledForUser(key, userA)).toBe(true);
    expect(await service.isEnabledForUser(key, userB)).toBe(false);
  });

  it('rollout=0 لكن المنطقة مستهدفة صراحة — نفس منطق userIds', async () => {
    const zoneId = '01a00000-0000-7000-9000-000000000001';
    const key = `test_ff_${runId}_targeted_zone`;
    await insertFlag({ key, isEnabled: true, rollout: 0, zones: [zoneId] });
    expect(await service.isEnabledForUser(key, userA, zoneId)).toBe(true);
    expect(await service.isEnabledForUser(key, userB, zoneId)).toBe(true);
    expect(await service.isEnabledForUser(key, userA, undefined)).toBe(false);
  });

  it('نفس (key, userId) دايمًا بيرجع نفس النتيجة (ديترمينستيك، مش عشوائي في كل نداء)', async () => {
    const key = `test_ff_${runId}_deterministic`;
    await insertFlag({ key, isEnabled: true, rollout: 50 });
    const first = await service.isEnabledForUser(key, userA);
    for (let i = 0; i < 5; i++) {
      expect(await service.isEnabledForUser(key, userA)).toBe(first);
    }
  });

  it('مفيش userId ومفيش استهداف — بس rollout=100 بيتقبل، أي حاجة تحتها ترفض (مينفعش نحسب bucket بلا هوية)', async () => {
    const fullKey = `test_ff_${runId}_no_user_full`;
    await insertFlag({ key: fullKey, isEnabled: true, rollout: 100 });
    expect(await service.isEnabledForUser(fullKey)).toBe(true);

    const partialKey = `test_ff_${runId}_no_user_partial`;
    await insertFlag({ key: partialKey, isEnabled: true, rollout: 50 });
    expect(await service.isEnabledForUser(partialKey)).toBe(false);
  });
});
