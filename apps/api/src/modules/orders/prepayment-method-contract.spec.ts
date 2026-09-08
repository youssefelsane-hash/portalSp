import { HttpStatus } from '@nestjs/common';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { resolvePrepaymentMethod } from './order-creation.service';

describe('عقد وسيلة الدفع المقدم عند إنشاء الطلب', () => {
  it('يعتمد الاسم الصريح الجديد', () => {
    expect(resolvePrepaymentMethod({ prepayment_method: 'card' })).toBe('card');
  });

  it('يدعم الاسم القديم مؤقتا لتطبيقات لم تتحدث بعد', () => {
    expect(resolvePrepaymentMethod({ payment_method: 'instapay' })).toBe('instapay');
  });

  it('يرفض كاش برسالة عمل قابلة للتنفيذ بدل خطأ enum تقني', () => {
    try {
      resolvePrepaymentMethod({ prepayment_method: 'cash' });
      fail('expected an ApiException');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      expect(error).toMatchObject({ code: ErrorCode.VAL_001, status: HttpStatus.BAD_REQUEST });
      expect((error as ApiException).message).toContain('سيب حقل وسيلة الدفع المسبق فاضي');
    }
  });

  it('يرفض الاسم القديم والجديد عندما يختلفان', () => {
    expect(() =>
      resolvePrepaymentMethod({ prepayment_method: 'card', payment_method: 'instapay' }),
    ).toThrow('وسيلتي دفع مقدّم مختلفتين');
  });
});
