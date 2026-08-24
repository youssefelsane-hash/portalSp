import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../../audit/audit-log.service';
import { SETTING_UPDATED_EVENT, SettingUpdatedEvent } from '../../../common/events/setting-updated.event';
import { RedisCacheService } from '../../../common/cache/redis-cache.service';
import { Setting } from '../../settings/entities/setting.entity';
import { toSettingResponseDto } from '../../settings/dto/setting-response.dto';
import { SettingsService } from '../../settings/settings.service';
import { PaymobProvider } from './paymob-provider.service';

describe('PaymobProvider — encrypted admin-managed configuration (PostgreSQL)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let settings: SettingsService;
  let provider: PaymobProvider;
  let adminUserId: string;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const keys = {
    api: 'payments.paymob.api_key',
    secret: 'payments.paymob.secret_key',
    public: 'payments.paymob.public_key',
    integration: 'payments.paymob.integration_id_card',
    hmac: 'payments.paymob.hmac_secret',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Setting],
    });
    await dataSource.initialize();
    const [admin] = await dataSource.query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2015${runId}`.slice(0, 14), `Paymob config test ${runId}`],
    );
    adminUserId = admin.id as string;

    const values = new Map<string, string>();
    const cache = {
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: string) => { values.set(key, value); },
      del: async (key: string) => { values.delete(key); },
    } as unknown as RedisCacheService;
    const config = {
      get: (key: string) => key === 'security.settingsEncryptionKey'
        ? 'test-only-paymob-settings-encryption-key-32'
        : key === 'payments.paymob.baseUrl'
          ? 'https://accept.paymob.com'
          : undefined,
    } as ConfigService;
    const events = new EventEmitter2();
    settings = new SettingsService(
      dataSource.getRepository(Setting),
      { record: jest.fn() } as unknown as AuditLogService,
      cache,
      events,
      config,
    );
    provider = new PaymobProvider(config, settings);
    events.on(SETTING_UPDATED_EVENT, (event: SettingUpdatedEvent) => provider.handleSettingUpdated(event));
    await provider.onModuleInit();
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    for (const key of Object.values(keys)) await settings.update(adminUserId, key, '');
    await dataSource.query(`UPDATE settings SET updated_by_user_id=NULL WHERE updated_by_user_id=$1`, [adminUserId]);
    await dataSource.query(`DELETE FROM users WHERE id=$1`, [adminUserId]);
    await dataSource.destroy();
  });

  it('activates immediately only after every required value is saved', async () => {
    expect(provider.isConfigured).toBe(false);
    await settings.update(adminUserId, keys.api, `api-${runId}`);
    await settings.update(adminUserId, keys.secret, `secret-${runId}`);
    await settings.update(adminUserId, keys.public, `public-${runId}`);
    await settings.update(adminUserId, keys.integration, '123456');
    expect(provider.isConfigured).toBe(false);
    await settings.update(adminUserId, keys.hmac, `hmac-${runId}`);
    expect(provider.isConfigured).toBe(true);
    expect(provider.supportsTokenization).toBe(true);
  });

  it('stores secret values encrypted and never returns them through the admin DTO', async () => {
    const setting = await dataSource.getRepository(Setting).findOneByOrFail({ key: keys.secret });
    expect(setting.value).not.toContain(`secret-${runId}`);
    expect(setting.value).toMatch(/^enc:v1:/);
    expect(toSettingResponseDto(setting).value).toBe('********');
  });
});
