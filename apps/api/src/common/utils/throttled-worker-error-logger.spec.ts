import { Logger } from '@nestjs/common';
import { ThrottledWorkerErrorLogger } from './throttled-worker-error-logger';

/**
 * البَقّة اللي الملف ده بيحرسها حقيقية ومقاسة: انقطاع Redis كان بيولّد **٩ جيجا لوج** في نافذة
 * واحدة، والكتابة المتزامنة على stdout كانت بتخنق الـevent loop فطلب الحجز يفضل معلّق ٦٠ ثانية
 * (docs/08 §148). الاختبار بيثبت إن الإشارة الأولى مابتضيعش وإن الفيضان بيتخنق فعلاً.
 */
describe('ThrottledWorkerErrorLogger', () => {
  function makeLogger() {
    const warnings: string[] = [];
    const logger = { warn: (msg: string) => warnings.push(msg) } as unknown as Logger;
    return { logger, warnings };
  }

  it('أول ظهور بيتسجّل فورًا — الإشارة الأولى مابتضيعش', () => {
    const { logger, warnings } = makeLogger();
    new ThrottledWorkerErrorLogger(logger, 'test').record(new Error('Stream isn\'t writeable'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Stream isn't writeable");
  });

  it('ألف تكرار في نفس النافذة = سطر واحد بس (مش ألف)', () => {
    const { logger, warnings } = makeLogger();
    const throttled = new ThrottledWorkerErrorLogger(logger, 'test', 30_000);
    for (let i = 0; i < 1000; i++) throttled.record(new Error('Connection is closed'));
    expect(warnings).toHaveLength(1);
  });

  it('بعد ما النافذة تعدّي بيطلع ملخّص فيه عدد المرات', () => {
    const { logger, warnings } = makeLogger();
    const throttled = new ThrottledWorkerErrorLogger(logger, 'test', 0);
    throttled.record(new Error('boom'));
    throttled.record(new Error('boom'));
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toMatch(/اتكررت 1 مرة/);
  });

  it('رسايل مختلفة ليها خنق مستقل — عطل جديد مايتخبّاش ورا عطل قديم', () => {
    const { logger, warnings } = makeLogger();
    const throttled = new ThrottledWorkerErrorLogger(logger, 'test', 30_000);
    throttled.record(new Error('أول عطل'));
    throttled.record(new Error('أول عطل'));
    throttled.record(new Error('عطل تاني مختلف'));
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain('عطل تاني مختلف');
  });
});
