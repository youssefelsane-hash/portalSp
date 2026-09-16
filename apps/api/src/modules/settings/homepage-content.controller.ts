import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SettingsService } from './settings.service';
import { bookingWindowMessageAr, resolveBookingWindowSetting } from '../orders/booking-window';

/** كارت "نصايح مفيدة" الواحد — طلب مالك صريح 2026-08-23: الأدمن يقدر يحط لينك صورة جاهزة (مش
 * رفع ملف حقيقي، فجوة موثّقة بديلة أبسط) بدل الـplaceholder اللوني الثابت. `image_url: null` =
 * لسه ما اتحطش رابط، الـfrontend بيرجع للتدرّج اللوني الافتراضي (نفس الشكل القديم بالحرف). */
export interface HomepageTipDto {
  title: string;
  body: string;
  image_url: string | null;
}

export interface HomepageSearchContentDto {
  eyebrow: string;
  title: string;
  description: string;
  placeholder: string;
}

const DEFAULT_SEARCH_CONTENT: HomepageSearchContentDto = {
  eyebrow: 'أساعدك إزاي؟',
  title: 'محتاج مساعدة في إيه؟',
  description: 'قول لينا مشكلتك بكلامك العادي، أو تصفّح الفئات تحت',
  placeholder: 'وصّف مشكلتك... زي "المياه بتنزل من تحت الحوض"',
};

export interface HomepageContentResponseDto {
  /** رسالة الثقة/الضمان المعروضة في hero الصفحة الرئيسية — نص قابل للتعديل من الأدمن، مش ثابت
   * في الكود (طلب مالك صريح 2026-08-22: "الكلام ده بيتغير، مش مستحسن يكون ثابت"). */
  trust_message: string;
  /** صور الـhero المرتبة من الأدمن. قائمة فارغة تعني الرجوع لصورة branding splash القديمة. */
  hero_images: string[];
  /** نصوص مدخل البحث الرئيسية، كلها قابلة للتعديل من لوحة الإدارة كمجموعة واحدة. */
  search: HomepageSearchContentDto;
  /** "نصايح مفيدة" — كانت `HOME_TIPS` ثابتة في كود الـfrontend (customer-web/customer-app)،
   * بلا أي مكان يديها الأدمن يعدّلها أو يحط صور حقيقية (بلاغ مالك صريح 2026-08-23: "مش لاقي له
   * مكان أرفع منه الصور"). بقت `homepage.tips` (setting, value_type='json') — نفس نمط
   * `homepage.trust_message` بالحرف، إدارة كاملة من `/homepage-content` في apps/admin. */
  tips: HomepageTipDto[];
  /** قسم «ابدأ مشروعك» (تشطيب الشقق) ظاهر ولا لأ — زرار إخفاء/إظهار واحد عند الأدمن
   * (docs/08 §146). العرض بس: المشاريع القايمة بتفضل شغّالة وصفحاتها بتفتح بالرابط. */
  projects_enabled: boolean;
}

/**
 * محتوى الصفحة الرئيسية لـ customer-web/customer-app (طلب مالك صريح 2026-08-22/23) — @Public()
 * عمداً، نفس فلسفة SupportContactController بالحرف (نفس الملف/الموديول). التعديل عبر
 * /admin/settings/:key الموجود بالفعل — صفر endpoint إضافي مطلوب (`homepage-content` (admin)
 * page بتستخدمه مباشرة).
 */
/**
 * نافذة اختيار الموعد (ADR-0097) — `@Public()` زي باقي محتوى الإعدادات هنا.
 *
 * الواجهات بتقرا الرقمين من هنا بدل ما تكتبهم في كودها: لو الأدمن غيّر النافذة، التطبيق
 * والموقع بيتغيّروا من غير نشر، والأهم إن المنتقي مستحيل يسمح بوقت السيرفر بيرفضه.
 */
export interface BookingWindowResponseDto {
  start_hour: number;
  end_hour: number;
  /** نص جاهز للعرض — مصدر واحد للصياغة بدل ما كل واجهة تركّبها. */
  message_ar: string;
}

@Controller('settings')
export class HomepageContentController {
  constructor(private readonly settingsService: SettingsService) {}

  @Public()
  @Get('booking-window')
  async getBookingWindow(): Promise<BookingWindowResponseDto> {
    const window = await resolveBookingWindowSetting(this.settingsService);
    return {
      start_hour: window.startHour,
      end_hour: window.endHour,
      message_ar: bookingWindowMessageAr(window),
    };
  }

  @Public()
  @Get('homepage-content')
  async getHomepageContent(): Promise<HomepageContentResponseDto> {
    const trustMessage = await this.settingsService.getString('homepage.trust_message', '');
    const tips = await this.settingsService.getJson<HomepageTipDto[]>('homepage.tips', []);
    const projectsEnabled = await this.settingsService.getBoolean('homepage.projects_enabled', true);
    const configuredSearch = await this.settingsService.getJson<unknown>('homepage.search_content', {});
    const configuredHeroImages = await this.settingsService.getJson<unknown[]>('homepage.hero_images', []);
    const heroImages = configuredHeroImages
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.startsWith('https://') || value.startsWith('/uploads/'))
      .slice(0, 4);
    const searchRecord = configuredSearch && typeof configuredSearch === 'object' && !Array.isArray(configuredSearch)
      ? configuredSearch as Record<string, unknown>
      : {};
    const readSearchText = (key: keyof HomepageSearchContentDto, maxLength: number): string => {
      const value = searchRecord[key];
      return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : DEFAULT_SEARCH_CONTENT[key];
    };
    const search: HomepageSearchContentDto = {
      eyebrow: readSearchText('eyebrow', 80),
      title: readSearchText('title', 120),
      description: readSearchText('description', 240),
      placeholder: readSearchText('placeholder', 180),
    };
    return {
      trust_message: trustMessage,
      hero_images: heroImages,
      search,
      tips,
      projects_enabled: projectsEnabled,
    };
  }
}
