import { ApiException } from '../../common/exceptions/api.exception';
import { CustomerRatingEligibilityGuard } from './rating-eligibility.guard';
import { RatingsService } from './ratings.service';

describe('CustomerRatingEligibilityGuard', () => {
  const request = { user: { sub: 'customer-user-id' }, params: { id: 'order-id' } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;

  it('checks order eligibility before body validation is reached', async () => {
    const ratings = { assertCustomerCanRate: jest.fn().mockResolvedValue(undefined) } as unknown as RatingsService;
    const guard = new CustomerRatingEligibilityGuard(ratings);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(ratings.assertCustomerCanRate).toHaveBeenCalledWith('customer-user-id', 'order-id');
  });

  it('keeps a meaningful cancelled-order error ahead of malformed rating fields', async () => {
    const ratings = {
      assertCustomerCanRate: jest.fn().mockRejectedValue(new ApiException('ORDR_003' as never, 'الطلب ده اتلغى ومينفعش يتقيّم', 409)),
    } as unknown as RatingsService;
    const guard = new CustomerRatingEligibilityGuard(ratings);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 409,
      message: 'الطلب ده اتلغى ومينفعش يتقيّم',
    });
  });
});
