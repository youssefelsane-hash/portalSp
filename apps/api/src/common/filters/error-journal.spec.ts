import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorJournalEnabled, recordError } from './error-journal';

/**
 * **سجل الأعطال** — بلاغ مالك: «حاولت أجيب لك جزء من التيرمنال، ما لقيتش الـerror».
 *
 * التطبيق بيعرض `request_id`، والباك-إند بيطبعه — بس اللوج على الشاشة بيضيع. السجل ده بيخلّي
 * الرحلة من الكود اللي على الموبايل للسبب الحقيقي أمر واحد.
 */
describe('سجل أعطال ٥xx', () => {
  const dir = mkdtempSync(join(tmpdir(), 'baytak-journal-'));
  const path = join(dir, 'errors.log');
  const previousPath = process.env.ERROR_JOURNAL_PATH;
  const previousEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.ERROR_JOURNAL_PATH = path;
  });

  afterAll(() => {
    if (previousPath === undefined) delete process.env.ERROR_JOURNAL_PATH;
    else process.env.ERROR_JOURNAL_PATH = previousPath;
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  });

  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));

  it('بيسجّل العطل بكوده ومساره ومستخدمه والـstack', async () => {
    process.env.NODE_ENV = 'development';
    recordError({
      requestId: 'req_test-1',
      method: 'GET',
      url: '/api/v1/technician/orders/upcoming-confirmed',
      userId: 'user-9',
      message: 'انفجار متعمّد',
      stack: 'Error: انفجار متعمّد\n    at somewhere',
    });
    await flush();

    const entry = JSON.parse(readFileSync(path, 'utf8').trim().split('\n').pop() as string) as Record<string, unknown>;
    expect(entry.requestId).toBe('req_test-1');
    expect(entry.url).toBe('/api/v1/technician/orders/upcoming-confirmed');
    expect(entry.userId).toBe('user-9');
    expect(entry.stack).toContain('انفجار متعمّد');
    // الوقت لازم يبقى موجود عشان تعرف العطل ده بتاع امتى وسط عشرات.
    expect(typeof entry.at).toBe('string');
  });

  it('متوقّف في الإنتاج — الـstacks مايتكتبوش على القرص هناك', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ERROR_JOURNAL_PATH = join(dir, 'production.log');
    expect(errorJournalEnabled()).toBe(false);

    recordError({ requestId: 'req_prod', method: 'GET', url: '/x', userId: null, message: 'x', stack: null });
    await flush();

    expect(existsSync(join(dir, 'production.log'))).toBe(false);
  });
});
