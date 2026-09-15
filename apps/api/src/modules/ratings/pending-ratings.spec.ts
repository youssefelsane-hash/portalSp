import { RatingsService } from './ratings.service';
import { RatingType } from './entities/rating.entity';

describe('RatingsService pending customer ratings', () => {
  const query = jest.fn();
  const findOne = jest.fn();
  const save = jest.fn();
  const create = jest.fn((value) => ({ id: 'rating-id', createdAt: new Date(), ...value }));
  const events = { emit: jest.fn() };

  const service = new RatingsService(
    { manager: { query }, findOne, save, create } as never,
    {} as never,
    {} as never,
    { findByUserIdOrThrow: jest.fn().mockResolvedValue({ id: 'customer-profile-id' }) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    events as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('only excludes an existing customer-to-technician rating', async () => {
    query.mockResolvedValue([]);

    await service.listPendingForCustomer('customer-user-id');

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("r.rating_type = 'customer_to_technician'");
    expect(sql).toContain("o.order_status = 'completed'");
    expect(sql).toContain('LIMIT 10');
    expect(params).toEqual(['customer-profile-id']);
  });

  it('checks uniqueness per rating direction instead of blocking the other party', async () => {
    findOne.mockResolvedValue(null);
    save.mockImplementation(async (rating) => rating);

    await (service as unknown as { createRating: (...args: unknown[]) => Promise<unknown> }).createRating(
      'order-id',
      'customer-user-id',
      'technician-user-id',
      RatingType.CUSTOMER_TO_TECHNICIAN,
      { overall_rating: 5 },
    );
    await (service as unknown as { createRating: (...args: unknown[]) => Promise<unknown> }).createRating(
      'order-id',
      'technician-user-id',
      'customer-user-id',
      RatingType.TECHNICIAN_TO_CUSTOMER,
      { overall_rating: 4 },
    );

    expect(findOne).toHaveBeenNthCalledWith(1, {
      where: { orderId: 'order-id', ratingType: RatingType.CUSTOMER_TO_TECHNICIAN },
    });
    expect(findOne).toHaveBeenNthCalledWith(2, {
      where: { orderId: 'order-id', ratingType: RatingType.TECHNICIAN_TO_CUSTOMER },
    });
    expect(save).toHaveBeenCalledTimes(2);
  });
});
