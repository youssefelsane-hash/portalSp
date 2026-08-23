import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SettingsService } from './settings.service';

export interface HomepageContentResponseDto {
  /** رسالة الثقة/الضمان المعروضة في hero الصفحة الرئيسية — نص قابل للتعديل من الأدمن، مش ثابت
   * في الكود (طلب مالك صريح 2026-08-22: "الكلام ده بيتغير، مش مستحسن يكون ثابت"). */
  trust_message: string;
}

/**
 * محتوى الصفحة الرئيسية لـ customer-web (طلب مالك صريح 2026-08-22) — @Public() عمداً، نفس فلسفة
 * SupportContactController بالحرف (نفس الملف/الموديول). التعديل عبر /admin/settings/:key الموجود
 * بالفعل — صفر كود إضافي مطلوب هناك.
 */
@Controller('settings')
export class HomepageContentController {
  constructor(private readonly settingsService: SettingsService) {}

  @Public()
  @Get('homepage-content')
  async getHomepageContent(): Promise<HomepageContentResponseDto> {
    const trustMessage = await this.settingsService.getString('homepage.trust_message', '');
    return { trust_message: trustMessage };
  }
}
