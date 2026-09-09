import configuration from '../config/configuration';
import { DbPoolMonitorService } from './db-pool-monitor.service';

/**
 * **سعة التزامن مقفولة باختبار، مش متسايبة لافتراضي مخفي.**
 *
 * `DATABASE_POOL_MAX` كان ١٠، وده مكانش رقم أداء — ده كان **سقف على عدد العملاء اللي يقدروا
 * يحجزوا في نفس اللحظة**. القياس الحي (`scripts/concurrency-booking-safety.js --concurrency 40`)
 * على نفس البيانات ونفس الكود:
 *
 *   poolMax=10 → ١٢ طلب اتعمل، **٢٨ عميل اترفضوا بـ503**، ٢١.٥ ثانية
 *   poolMax=25 → ٤٠ طلب اتعمل، **صفر رفض**، ١٢.٦ ثانية
 *
 * الاختبار ده موجود عشان الرقم مايرجعش لقيمة صغيرة بالسهو. مش بيقفل على ٢٠ بالظبط — بيقفل على
 * إنه **يفضل كفاية لعشرات الحجوزات المتزامنة**، فالرفع لاحقًا مسموح والخفض تحت الحد لأ.
 */
describe('سعة اتصالات قاعدة البيانات', () => {
  const MIN_SAFE_POOL = 20;

  const withEnv = <T>(overrides: Record<string, string | undefined>, fn: () => T): T => {
    const saved: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(overrides)) {
      saved[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      return fn();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };

  it('الافتراضي بيسع عشرات الحجوزات المتزامنة — مش ١٠', () => {
    const config = withEnv({ DATABASE_POOL_MAX: undefined }, () => configuration());
    expect(config.database.poolMax).toBeGreaterThanOrEqual(MIN_SAFE_POOL);
  });

  it('المهلة محدودة — انتظار بلا نهاية هو اللي علّق الـAPI قبل كده', () => {
    const config = withEnv({ DATABASE_ACQUIRE_TIMEOUT_MS: undefined }, () => configuration());
    expect(config.database.acquireTimeoutMs).toBeGreaterThan(0);
    expect(Number.isFinite(config.database.acquireTimeoutMs)).toBe(true);
  });

  it('الـenv بيغلب الافتراضي (لنشر على قاعدة أصغر أو نسخ أكتر)', () => {
    const config = withEnv({ DATABASE_POOL_MAX: '7' }, () => configuration());
    expect(config.database.poolMax).toBe(7);
  });

  describe('تقرير السعة وقت الإقلاع', () => {
    const monitorFor = (opts: { poolMax: number; serverMax: string }) => {
      const dataSource = {
        driver: { master: { totalCount: 1, idleCount: 1, waitingCount: 0, options: { max: opts.poolMax } } },
        query: jest.fn().mockResolvedValue([{ max_connections: opts.serverMax }]),
      };
      return { monitor: new DbPoolMonitorService(dataSource as never), dataSource };
    };

    it('بيطبع خطأ صريح لو سقف النسخة أكبر من طاقة القاعدة كلها', async () => {
      const { monitor } = monitorFor({ poolMax: 200, serverMax: '100' });
      const error = jest.spyOn(monitor['logger'], 'error').mockImplementation(() => undefined);
      jest.spyOn(monitor['logger'], 'log').mockImplementation(() => undefined);

      await monitor['reportCapacityAtBoot']();

      expect(error).toHaveBeenCalledWith(expect.stringContaining('أكبر من اللي القاعدة تستحمله'));
    });

    it('بيقول عدد النسخ اللي القاعدة تستحملها بالسقف الحالي', async () => {
      const { monitor } = monitorFor({ poolMax: 20, serverMax: '100' });
      jest.spyOn(monitor['logger'], 'error').mockImplementation(() => undefined);
      const log = jest.spyOn(monitor['logger'], 'log').mockImplementation(() => undefined);

      await monitor['reportCapacityAtBoot']();

      // (100 − 10 محجوزة) ÷ 20 = 4 نسخ
      expect(log).toHaveBeenCalledWith(expect.stringContaining('4 نسخة'));
    });

    it('فشل القياس مايرميش — التطبيق بيقلع عادي من غيره', async () => {
      const { monitor, dataSource } = monitorFor({ poolMax: 20, serverMax: '100' });
      dataSource.query.mockRejectedValue(new Error('لا اتصال'));
      const warn = jest.spyOn(monitor['logger'], 'warn').mockImplementation(() => undefined);

      await expect(monitor['reportCapacityAtBoot']()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('تعذّر قياس سعة'));
    });
  });
});
