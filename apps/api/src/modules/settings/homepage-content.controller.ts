import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SettingsService } from './settings.service';

/** كارت "نصايح مفيدة" الواحد — طلب مالك صريح 2026-08-23: الأدمن يقدر يحط لينك صورة جاهزة (مش
 * رفع ملف حقيقي، فجوة موثّقة بديلة أبسط) بدل الـplaceholder اللوني الثابت. `image_url: null` =
 * لسه ما اتحطش رابط، الـfrontend بيرجع للتدرّج اللوني الافتراضي (نفس الشكل القديم بالحرف). */
export interface HomepageTipDto {
  title: string;
  body: string;
  image_url: string | null;
}

export interface HomepageContentResponseDto {
  /** رسالة الثقة/الضمان المعروضة في hero الصفحة الرئيسية — نص قابل للتعديل من الأدمن، مش ثابت
   * في الكود (طلب مالك صريح 2026-08-22: "الكلام ده بيتغير، مش مستحسن يكون ثابت"). */
  trust_message: string;
  /** صور الـhero المرتبة من الأدمن. قائمة فارغة تعني الرجوع لصورة branding splash القديمة. */
  hero_images: string[];
  /** "نصايح مفيدة" — كانت `HOME_TIPS` ثابتة في كود الـfrontend (customer-web/customer-app)،
   * بلا أي مكان يديها الأدمن يعدّلها أو يحط صور حقيقية (بلاغ مالك صريح 2026-08-23: "مش لاقي له
   * مكان أرفع منه الصور"). بقت `homepage.tips` (setting, value_type='json') — نفس نمط
   * `homepage.trust_message` بالحرف، إدارة كاملة من `/homepage-content` في apps/admin. */
  tips: HomepageTipDto[];
}

/**
 * محتوى الصفحة الرئيسية لـ customer-web/customer-app (طلب مالك صريح 2026-08-22/23) — @Public()
 * عمداً، نفس فلسفة SupportContactController بالحرف (نفس الملف/الموديول). التعديل عبر
 * /admin/settings/:key الموجود بالفعل — صفر endpoint إضافي مطلوب (`homepage-content` (admin)
 * page بتستخدمه مباشرة).
 */
@Controller('settings')
export class HomepageContentController {
  constructor(private readonly settingsService: SettingsService) {}

  @Public()
  @Get('homepage-content')
  async getHomepageContent(): Promise<HomepageContentResponseDto> {
    const trustMessage = await this.settingsService.getString('homepage.trust_message', '');
    const tips = await this.settingsService.getJson<HomepageTipDto[]>('homepage.tips', []);
    const configuredHeroImages = await this.settingsService.getJson<unknown[]>('homepage.hero_images', []);
    const heroImages = configuredHeroImages
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.startsWith('https://') || value.startsWith('/uploads/'))
      .slice(0, 4);
    return { trust_message: trustMessage, hero_images: heroImages, tips };
  }
}
