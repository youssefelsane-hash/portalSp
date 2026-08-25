import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/exceptions/api.exception';
import { RecurringOrdersService } from './recurring-orders.service';
import { nextOccurrence } from './recurring-schedule.util';
import { RecurringOrderFrequency, RecurringOrderTemplate } from './entities/recurring-order-template.entity';
import { BookingMode } from './entities/order.entity';
import { PricingModel } from '../catalog/entities/service.entity';

// قدرة "الحجز المتكرر" لكل خدمة (migration 0176) — بوابة دخول على مستوى إنشاء القالب: خدمة
// allows_recurring_booking=false يعني مفيش قالب متكرر خالص، برفض واضح VAL_001 وقت الطلب بدل
// قالب بيتنشأ وبعدين يفشل بصمت عند كل توليد.
describe('RecurringOrdersService.create() — قدرة allows_recurring_booking + تكوين القالب', () => {
  function buildService(serviceOverrides: Record<string, unknown>) {
    const templatesRepo = {
      manager: { query: jest.fn(async () => [{ exists: true }]) },
      create: jest.fn((data: Partial<RecurringOrderTemplate>) => ({ ...data })),
      save: jest.fn(async (data: Partial<RecurringOrderTemplate>) => data),
    };
    const service = new RecurringOrdersService(
      templatesRepo as never,
      { findByUserIdOrThrow: async () => ({ id: 'profile-1', userId: 'user-1' }) } as never,
      { findOwnedOrThrow: async () => ({ id: 'address-1' }) } as never,
      {
        findServiceOrThrow: async () => ({
          id: 'service-1',
          allowsIndividual: true,
          allowsTeam: false,
          allowsEmergency: false,
          requiresPreciseSchedule: false,
          requiresStartTimeOnly: false,
          requiresHoursOnly: false,
          requiresStartAndEnd: false,
          pricingModel: PricingModel.FIXED,
          ...serviceOverrides,
        }),
      } as never,
      {} as never,
      {} as never,
      { emit: jest.fn(), emitAsync: jest.fn(async () => undefined) } as never,
    );
    return { service, templatesRepo };
  }

  const futureIso = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  it('allows_recurring_booking=false (الافتراضي): يترفض VAL_001 ومفيش أي قالب بيتحفظ', async () => {
    const { service, templatesRepo } = buildService({ allowsRecurringBooking: false });
    await expect(
      service.create('user-1', {
        service_id: 'service-1',
        address_id: 'address-1',
        frequency: RecurringOrderFrequency.WEEKLY,
        starts_at: futureIso(),
      } as never),
    ).rejects.toMatchObject({
      code: ErrorCode.VAL_001,
      status: HttpStatus.BAD_REQUEST,
    });
    expect(templatesRepo.save).not.toHaveBeenCalled();
  });

  it('allows_recurring_booking=true: القالب بيتحفظ بالمدخلات الجديدة (field_values/duration/شركة)', async () => {
    const { service, templatesRepo } = buildService({ allowsRecurringBooking: true, allowsTeam: true });
    const saved = await service.create('user-1', {
      service_id: 'service-1',
      address_id: 'address-1',
      booking_mode: BookingMode.TEAM,
      requested_technician_company_id: 'company-1',
      frequency: RecurringOrderFrequency.MONTHLY,
      starts_at: futureIso(),
      field_values: { area: 120 },
      duration_hours: undefined,
      problem_description: 'كل شهر',
      payment_method: 'card',
    } as never);
    expect(saved.requestedTechnicianCompanyId).toBe('company-1');
    expect(saved.fieldValues).toEqual({ area: 120 });
    expect(saved.paymentMethod).toBe('card');
    expect(templatesRepo.save).toHaveBeenCalledTimes(1);
  });

  it('خدمة بدقة وقت من غير duration_hours: يترفض قبل الحفظ — القالب اللي هيولّد طلبات فاشلة مينفعش ينشئ', async () => {
    const { service, templatesRepo } = buildService({ allowsRecurringBooking: true, requiresPreciseSchedule: true });
    await expect(
      service.create('user-1', {
        service_id: 'service-1',
        address_id: 'address-1',
        frequency: RecurringOrderFrequency.WEEKLY,
        starts_at: futureIso(),
      } as never),
    ).rejects.toMatchObject({ code: ErrorCode.VAL_001 });
    expect(templatesRepo.save).not.toHaveBeenCalled();
  });

  it('خدمة بدقة وقت مع duration_hours: بيتقبل ويخزّن المدة', async () => {
    const { service, templatesRepo } = buildService({ allowsRecurringBooking: true, requiresPreciseSchedule: true });
    const saved = await service.create('user-1', {
      service_id: 'service-1',
      address_id: 'address-1',
      frequency: RecurringOrderFrequency.WEEKLY,
      starts_at: futureIso(),
      duration_hours: 3,
    } as never);
    expect(saved.durationHours).toBe(3);
    expect(templatesRepo.save).toHaveBeenCalledTimes(1);
  });

  it('خدمة بالوحدة من غير كمية: تترفض قبل إنشاء قالب هيفشل عند كل نوبة', async () => {
    const { service, templatesRepo } = buildService({
      allowsRecurringBooking: true,
      pricingModel: PricingModel.PER_UNIT,
    });
    await expect(
      service.create('user-1', {
        service_id: 'service-1',
        address_id: 'address-1',
        frequency: RecurringOrderFrequency.WEEKLY,
        starts_at: futureIso(),
      } as never),
    ).rejects.toMatchObject({ code: ErrorCode.VAL_001 });
    expect(templatesRepo.save).not.toHaveBeenCalled();
  });

  it('خدمة بالوحدة تحفظ الكمية كمدخل لكل طلب متولد', async () => {
    const { service, templatesRepo } = buildService({
      allowsRecurringBooking: true,
      pricingModel: PricingModel.PER_UNIT,
    });
    const saved = await service.create('user-1', {
      service_id: 'service-1',
      address_id: 'address-1',
      frequency: RecurringOrderFrequency.MONTHLY,
      starts_at: futureIso(),
      pricing_quantity: 3.5,
    } as never);
    expect(saved.pricingQuantity).toBe('3.5');
    expect(templatesRepo.save).toHaveBeenCalledTimes(1);
  });

  it('وضع "بداية+نهاية" من غير scheduled_end_at: يترفض', async () => {
    const { service, templatesRepo } = buildService({ allowsRecurringBooking: true, requiresStartAndEnd: true });
    await expect(
      service.create('user-1', {
        service_id: 'service-1',
        address_id: 'address-1',
        frequency: RecurringOrderFrequency.WEEKLY,
        starts_at: futureIso(),
      } as never),
    ).rejects.toMatchObject({ code: ErrorCode.VAL_001 });
    expect(templatesRepo.save).not.toHaveBeenCalled();
  });

  it('شركة محددة مع وضع مش "اعتماد": يترفض (نفس قيد CreateOrderDto)', async () => {
    const { service } = buildService({ allowsRecurringBooking: true });
    await expect(
      service.create('user-1', {
        service_id: 'service-1',
        address_id: 'address-1',
        requested_technician_company_id: 'company-1',
        frequency: RecurringOrderFrequency.WEEKLY,
        starts_at: futureIso(),
      } as never),
    ).rejects.toMatchObject({ code: ErrorCode.VAL_001 });
  });

  it('أول موعد في الماضي: يترفض', async () => {
    const { service, templatesRepo } = buildService({ allowsRecurringBooking: true });
    await expect(
      service.create('user-1', {
        service_id: 'service-1',
        address_id: 'address-1',
        frequency: RecurringOrderFrequency.WEEKLY,
        starts_at: new Date(Date.now() - 60_000).toISOString(),
      } as never),
    ).rejects.toMatchObject({ code: ErrorCode.VAL_001 });
    expect(templatesRepo.save).not.toHaveBeenCalled();
  });

  // حارس رجريشن صغير — nextOccurrence (المشترك بين التوليد وإنشاء الخطة من مسار الحجز) لسه
  // بيعمل clamp صح لحالة 31 يناير → فبراير (كانت بَقّة حقيقية اتصلحت واتنقلت لـrecurring-schedule.util.ts).
  it('nextOccurrence شهري: 31 يناير → 28 فبراير (سنة عادية) بنفس التوقيت', () => {
    const jan31 = new Date(Date.UTC(2027, 0, 31, 10, 0, 0));
    const feb = nextOccurrence(jan31, RecurringOrderFrequency.MONTHLY);
    expect(feb.getUTCFullYear()).toBe(2027);
    expect(feb.getUTCMonth()).toBe(1);
    expect(feb.getUTCDate()).toBe(28);
    expect(feb.getUTCHours()).toBe(10);
  });
});
