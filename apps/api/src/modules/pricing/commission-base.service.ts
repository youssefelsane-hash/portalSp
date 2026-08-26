import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import {
  COMMISSION_BASE_SETTING_KEYS,
  CommissionBasePolicy,
  DEFAULT_COMMISSION_BASE_POLICY,
} from './commission-base';

/**
 * بيحمّل سياسة وعاء العمولة من محرك الإعدادات (ADR-0037).
 *
 * الفصل بين الملف ده و`commission-base.ts` مقصود: الحساب نفسه دوال خالصة قابلة للاختبار بلا
 * قاعدة بيانات، والملف ده مسؤوليته الوحيدة القراءة. مفيش cache محلي هنا — `SettingsService`
 * عنده الـcache بتاعه، وأي تعديل من الأدمن لازم يسري على الطلب اللي بعده على طول.
 */
@Injectable()
export class CommissionBaseService {
  constructor(private readonly settingsService: SettingsService) {}

  async getPolicy(): Promise<CommissionBasePolicy> {
    const keys = COMMISSION_BASE_SETTING_KEYS;
    const defaults = DEFAULT_COMMISSION_BASE_POLICY;
    const [
      includeLevelPremium,
      includeZoneSurge,
      includeEmergencySurcharge,
      includeInspectionFee,
      includeAddons,
      includeAdditionalItems,
      includeWarranty,
      includeInstallmentInterest,
      discountReducesTechnicianShare,
    ] = await Promise.all([
      this.settingsService.getBoolean(keys.includeLevelPremium, defaults.includeLevelPremium),
      this.settingsService.getBoolean(keys.includeZoneSurge, defaults.includeZoneSurge),
      this.settingsService.getBoolean(keys.includeEmergencySurcharge, defaults.includeEmergencySurcharge),
      this.settingsService.getBoolean(keys.includeInspectionFee, defaults.includeInspectionFee),
      this.settingsService.getBoolean(keys.includeAddons, defaults.includeAddons),
      this.settingsService.getBoolean(keys.includeAdditionalItems, defaults.includeAdditionalItems),
      this.settingsService.getBoolean(keys.includeWarranty, defaults.includeWarranty),
      this.settingsService.getBoolean(keys.includeInstallmentInterest, defaults.includeInstallmentInterest),
      this.settingsService.getBoolean(keys.discountReducesTechnicianShare, defaults.discountReducesTechnicianShare),
    ]);

    return {
      includeLevelPremium,
      includeZoneSurge,
      includeEmergencySurcharge,
      includeInspectionFee,
      includeAddons,
      includeAdditionalItems,
      includeWarranty,
      includeInstallmentInterest,
      discountReducesTechnicianShare,
    };
  }
}
