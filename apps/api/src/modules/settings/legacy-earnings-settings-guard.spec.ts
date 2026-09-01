import { AuditLogService } from '../audit/audit-log.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { Setting } from './entities/setting.entity';
import { isLegacyEarningsSettingKey, SettingsService } from './settings.service';

describe('legacy earnings settings cutover guard', () => {
  it.each([
    'commission_base.include_addons',
    'commission.individual_adjustment_percentage',
    'commission.team_adjustment_percentage',
    'commission.emergency_adjustment_percentage',
    'crew.assistant_share_ratio',
  ])('classifies %s as V1-only', (key) => {
    expect(isLegacyEarningsSettingKey(key)).toBe(true);
  });

  it('does not classify V2 controls or unrelated pricing settings as legacy', () => {
    expect(isLegacyEarningsSettingKey('earnings.v2_cutover_enabled')).toBe(false);
    expect(isLegacyEarningsSettingKey('pricing.auto_match_level_premium')).toBe(false);
  });

  it('rejects direct edits to V1 money settings after V2 cutover', async () => {
    const service = new SettingsService(
      {} as never,
      {} as AuditLogService,
      {} as RedisCacheService,
    );
    jest.spyOn(service, 'getOrThrow').mockResolvedValue({
      key: 'crew.assistant_share_ratio',
      valueType: 'number',
    } as Setting);
    jest.spyOn(service, 'getBoolean').mockResolvedValue(true);

    await expect(service.update('admin-id', 'crew.assistant_share_ratio', 0.7)).rejects.toMatchObject({
      status: 409,
    });
  });
});
