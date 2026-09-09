import { reasonSignature, resetThrottleWindows, throttleMessage } from './throttled-log';

/**
 * الاختبار ده بيقفل على السلوك اللي منع **٢.١ چيجابايت لوج في ١٨ دقيقة** (قياس ج-٦): أول ظهور
 * بيتطبع، المتكرر بيتكتم، وفي أول سطر بعد النافذة بيتقال اتكتم كام.
 */
describe('throttleMessage', () => {
  beforeEach(() => resetThrottleWindows());

  it('بيطبع أول ظهور فورًا', () => {
    expect(throttleMessage('k', 'Redis error')).toBe('Redis error');
  });

  it('بيكتم التكرار داخل نفس النافذة', () => {
    throttleMessage('k', 'Redis error');
    expect(throttleMessage('k', 'Redis error')).toBeNull();
    expect(throttleMessage('k', 'Redis error')).toBeNull();
  });

  it('مفاتيح مختلفة مابتخنقش بعض', () => {
    expect(throttleMessage('a', 'X')).toBe('X');
    expect(throttleMessage('b', 'Y')).toBe('Y');
  });

  it('بعد النافذة بيطبع تاني ومعاه عدد المكتوم', () => {
    throttleMessage('k', 'Redis error', 10);
    throttleMessage('k', 'Redis error', 10);
    throttleMessage('k', 'Redis error', 10);
    const later = Date.now() + 50;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    const line = throttleMessage('k', 'Redis error', 10);
    jest.restoreAllMocks();
    expect(line).toContain('Redis error');
    expect(line).toContain('اتكتمت 2');
  });

  it('التوقيع بيتجاهل الـstack فالأخطاء المتطابقة بتتجمّع', () => {
    const a = new Error('connect ECONNREFUSED 127.0.0.1:6379');
    const b = new Error('connect ECONNREFUSED 127.0.0.1:6379');
    expect(reasonSignature(a)).toBe(reasonSignature(b));
    expect(reasonSignature(a)).toBe('Error: connect ECONNREFUSED 127.0.0.1:6379');
  });
});
