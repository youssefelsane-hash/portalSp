import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { WebhookEvent } from './entities/webhook-event.entity';
import { PaymentsService } from './payments.service';
import { WebhookRecoveryService } from './webhook-recovery.service';

describe('WebhookRecoveryService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const makeQueryBuilder = (events: Array<Pick<WebhookEvent, 'id'>>) => {
    const builder = {
      select: jest.fn(),
      where: jest.fn(),
      orWhere: jest.fn(),
      orderBy: jest.fn(),
      take: jest.fn(),
      getMany: jest.fn().mockResolvedValue(events),
    };
    builder.select.mockReturnValue(builder);
    builder.where.mockReturnValue(builder);
    builder.orWhere.mockReturnValue(builder);
    builder.orderBy.mockReturnValue(builder);
    builder.take.mockReturnValue(builder);
    return builder;
  };

  it('يفحص الصفوف المستحقة فقط ويمرر كل حدث إلى إعادة التحقق والمعالجة', async () => {
    const builder = makeQueryBuilder([{ id: 'event-a' }, { id: 'event-b' }]);
    const webhookEvents = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    } as unknown as Repository<WebhookEvent>;
    const settings = {
      getNumber: jest.fn(async (_key: string, fallback: number) => fallback),
    } as unknown as SettingsService;
    const payments = {
      recoverWebhookEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as PaymentsService;
    const service = new WebhookRecoveryService(webhookEvents, settings, payments, { createQueryRunner: () => ({ connect: async () => undefined, query: async () => [{ locked: true }], release: async () => undefined }) } as never);

    await expect(service.sweep()).resolves.toBe(2);

    expect(builder.where).toHaveBeenCalledWith(
      expect.stringContaining('event.nextRetryAt <= :now'),
      expect.objectContaining({ failed: 'failed' }),
    );
    expect(builder.orWhere).toHaveBeenCalledWith(
      expect.stringContaining('event.processingStartedAt < :staleBefore'),
      expect.objectContaining({ processing: 'processing' }),
    );
    expect(builder.take).toHaveBeenCalledWith(25);
    expect(payments.recoverWebhookEvent).toHaveBeenCalledTimes(2);
    expect(payments.recoverWebhookEvent).toHaveBeenNthCalledWith(1, 'event-a');
    expect(payments.recoverWebhookEvent).toHaveBeenNthCalledWith(2, 'event-b');
  });

  it('لا يوقف الدفعة عندما يفشل حدث واحد؛ الحدث التالي يظل قابلًا للاسترداد', async () => {
    const builder = makeQueryBuilder([{ id: 'event-a' }, { id: 'event-b' }]);
    const webhookEvents = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    } as unknown as Repository<WebhookEvent>;
    const settings = {
      getNumber: jest.fn(async (_key: string, fallback: number) => fallback),
    } as unknown as SettingsService;
    const payments = {
      recoverWebhookEvent: jest.fn().mockRejectedValueOnce(new Error('temporary database failure')).mockResolvedValueOnce(undefined),
    } as unknown as PaymentsService;
    const service = new WebhookRecoveryService(webhookEvents, settings, payments, { createQueryRunner: () => ({ connect: async () => undefined, query: async () => [{ locked: true }], release: async () => undefined }) } as never);

    await expect(service.sweep()).resolves.toBe(2);

    expect(payments.recoverWebhookEvent).toHaveBeenNthCalledWith(1, 'event-a');
    expect(payments.recoverWebhookEvent).toHaveBeenNthCalledWith(2, 'event-b');
  });
});
