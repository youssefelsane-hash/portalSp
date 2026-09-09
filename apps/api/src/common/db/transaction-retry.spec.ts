import { isRetryableTransactionConflict, withTransactionRetry } from './transaction-retry';

/**
 * ج-٢ — الحارس اللي بيمنع رجوع البَقّة المقاسة حيًا: عميل رصيده يكفي طلب واحد وبعت دفعتين
 * متزامنتين، الخاسر شاف `500` سببه `deadlock detected` طالع من `WalletsService.doubleEntry()`.
 * الفلوس كانت سليمة؛ اللي كان مكسور هو رد الـAPI.
 */
describe('withTransactionRetry — تعارض التزامن مايوصلش للمستخدم', () => {
  const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
  const serialization = Object.assign(new Error('could not serialize access'), { code: '40001' });
  // TypeORM بيلفّ خطأ السائق في `QueryFailedError` وبيسيب الأصلي في `driverError`.
  const wrapped = Object.assign(new Error('deadlock detected'), { driverError: { code: '40P01' } });

  it('بيعرف أكواد التعارض القابلة لإعادة المحاولة، ومابيخلطهاش بغيرها', () => {
    expect(isRetryableTransactionConflict(deadlock)).toBe(true);
    expect(isRetryableTransactionConflict(serialization)).toBe(true);
    expect(isRetryableTransactionConflict(wrapped)).toBe(true);
    expect(isRetryableTransactionConflict(Object.assign(new Error('dup'), { code: '23505' }))).toBe(false);
    expect(isRetryableTransactionConflict(new Error('أي خطأ تاني'))).toBe(false);
    expect(isRetryableTransactionConflict(null)).toBe(false);
  });

  it('deadlock في المحاولة الأولى بيتعاد وينجح — المستخدم مايشوفش خطأ', async () => {
    const run = jest.fn<Promise<string>, []>()
      .mockRejectedValueOnce(deadlock)
      .mockResolvedValueOnce('اتم');

    await expect(withTransactionRetry('اختبار', run)).resolves.toBe('اتم');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('خطأ مش تعارض تزامن بيتصاعد فورًا من غير أي إعادة محاولة', async () => {
    const businessError = Object.assign(new Error('رصيد غير كافٍ'), { code: '23505' });
    const run = jest.fn().mockRejectedValue(businessError);

    await expect(withTransactionRetry('اختبار', run)).rejects.toBe(businessError);
    // الأهم في التأكيد ده: خطأ عمل حقيقي مايتعادش، وإلا هنكرر أثر جانبي بلا داعي.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('تعارض متكرر بيتوقف عند سقف المحاولات وبيرمي آخر خطأ زي ما هو', async () => {
    const run = jest.fn().mockRejectedValue(deadlock);

    await expect(withTransactionRetry('اختبار', run, 3)).rejects.toBe(deadlock);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('نجاح من أول مرة مابيعملش أي تأخير ولا محاولة زيادة', async () => {
    const run = jest.fn().mockResolvedValue(7);
    await expect(withTransactionRetry('اختبار', run)).resolves.toBe(7);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
