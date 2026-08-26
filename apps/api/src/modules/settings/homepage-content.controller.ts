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
  /**
   * نصوص واجهة الـhero (docs/08 §64.د) — طلب المالك: «الكلام اللي تحت… عايز الأدمين ليه أكسس
   * على الكلام ده». كانت مكتوبة **ثابتة في كود التطبيقين** (customer-app وcustomer-web)، فأي
   * تعديل صغير في الصياغة كان يحتاج release كامل. القيم الافتراضية هنا هي بالظبط النص القديم،
   * فمفيش أي تغيير شكلي لو الأدمن ما لمسش حاجة.
   */
  hero_eyebrow: string;
  hero_title: string;
  hero_subtitle: string;
  search_placeholder: string;
}

// النصوص الافتراضية = اللي كان مكتوب حرفيًا في التطبيقين قبل ما يبقى قابل للتعديل.
const HERO_TEXT_DEFAULTS = {
  eyebrow: 'أساعدك إزاي؟',
  title: 'محتاج مساعدة في إيه؟',
  subtitle: 'قول لينا مشكلتك بكلامك العادي، أو تصفّح الفئات تحت',
  searchPlaceholder: 'وصّف مشكلتك... زي "المياه بتنزل من تحت الحوض"',
} as const;

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
    // نص فاضي في الإعداد = "رجّع الافتراضي"، مش "اعرض فراغ" — الأدمن ممكن يمسح الحقل بالغلط
    // ومينفعش الشاشة الرئيسية تفضل بلا عنوان.
    const textOrDefault = async (key: string, fallback: string): Promise<string> => {
      const value = await this.settingsService.getString(key, '');
      return value.trim() === '' ? fallback : value;
    };
    return {
      trust_message: trustMessage,
      hero_images: heroImages,
      tips,
      hero_eyebrow: await textOrDefault('homepage.hero_eyebrow', HERO_TEXT_DEFAULTS.eyebrow),
      hero_title: await textOrDefault('homepage.hero_title', HERO_TEXT_DEFAULTS.title),
      hero_subtitle: await textOrDefault('homepage.hero_subtitle', HERO_TEXT_DEFAULTS.subtitle),
      search_placeholder: await textOrDefault(
        'homepage.search_placeholder',
        HERO_TEXT_DEFAULTS.searchPlaceholder,
      ),
    };
  }
}
