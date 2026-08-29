import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SettingsService } from './settings.service';

/** أرقام دولية بس — نفس قاعدة `SupportContactController` بالحرف، عشان الرقم ينفع يتحط في `tel:` بأمان. */
const PHONE_SAFE = /^[0-9+\s-]{6,24}$/;
/** فحص إيميل متحفّظ — الغرض منع قيمة مكسورة تتعرض في مستند قانوني، مش تحقق RFC كامل. */
const EMAIL_SAFE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LegalEntityResponseDto {
  platform_name_ar: string;
  platform_name_en: string;
  company_name_ar: string;
  company_name_en: string;
  /** كل الحقول دي `null` لو لسه ما اتملتش — الواجهة بتخفي السطر بدل ما تعرضه فاضي. */
  legal_address: string | null;
  support_email: string | null;
  privacy_email: string | null;
  support_phone: string | null;
  website_url: string | null;
  commercial_register: string | null;
  tax_id: string | null;
}

/**
 * بيانات الجهة المشغّلة الرسمية (docs/08 §100، قرار مالك 2026-08-29).
 *
 * **@Public() عمدًا** — نفس فلسفة `SupportContactController`/`BrandingController`: الصفحات
 * القانونية (`/legal/terms`, `/legal/privacy`, `/legal/account-deletion`) والفوتر لازم يقروا
 * البيانات دي **قبل أي تسجيل دخول**؛ Google Play بيفتح الروابط دي كزائر مجهول، فلو الـendpoint
 * محمي المتطلَّب مايتحققش أصلاً.
 *
 * **التحرير** عبر `PATCH /admin/settings/:key` الموجود بالفعل — صلاحية `settings.manage` +
 * step-up MFA + تسجيل في `audit_logs`، صفر كود إضافي هنا. ده بالظبط اللي المالك طلبه: «مكان
 * واضح في الـAdmin يقدر يدخلها أو يغيرها بسهولة… وأي تعديل يتسجل في الـAudit Log».
 *
 * **التنظيف هنا مش في الأدمن** عمدًا: ده المسار اللي فعليًا بيبني `mailto:`/`tel:`/رابط موقع
 * بيتنفّذ على جهاز المستخدم، فالتحقق لازم يقع على القراءة مش على الكتابة (نفس درس
 * `SupportContactController`).
 */
@Controller('legal-entity')
export class LegalEntityController {
  constructor(private readonly settingsService: SettingsService) {}

  @Public()
  @Get()
  async get(): Promise<LegalEntityResponseDto> {
    const [
      platformNameAr,
      platformNameEn,
      companyNameAr,
      companyNameEn,
      legalAddress,
      supportEmail,
      privacyEmail,
      supportPhone,
      websiteUrl,
      commercialRegister,
      taxId,
    ] = await Promise.all([
      this.settingsService.getString('legal.platform_name_ar', 'أسطى'),
      this.settingsService.getString('legal.platform_name_en', 'OSTA'),
      this.settingsService.getString('legal.company_name_ar', 'الصانع جروب'),
      this.settingsService.getString('legal.company_name_en', 'ELSANE Group'),
      this.settingsService.getString('legal.legal_address', ''),
      this.settingsService.getString('legal.support_email', ''),
      this.settingsService.getString('legal.privacy_email', ''),
      this.settingsService.getString('legal.support_phone', ''),
      this.settingsService.getString('legal.website_url', ''),
      this.settingsService.getString('legal.commercial_register', ''),
      this.settingsService.getString('legal.tax_id', ''),
    ]);

    const cleanEmail = (value: string) => (EMAIL_SAFE.test(value.trim()) ? value.trim() : null);
    const cleanText = (value: string) => (value.trim().length > 0 ? value.trim() : null);
    const validSupportEmail = cleanEmail(supportEmail);

    return {
      // اسم المنصة والشركة ليهم قيم افتراضية معتمدة، فعمرهم ما يرجعوا فاضيين ويسيبوا الفوتر بلا هوية.
      platform_name_ar: platformNameAr.trim() || 'أسطى',
      platform_name_en: platformNameEn.trim() || 'OSTA',
      company_name_ar: companyNameAr.trim() || 'الصانع جروب',
      company_name_en: companyNameEn.trim() || 'ELSANE Group',
      legal_address: cleanText(legalAddress),
      support_email: validSupportEmail,
      // بريد الخصوصية بيرجع لبريد الدعم لو مش متحدد — أصحاب البيانات لازم يلاقوا قناة، مش سطر فاضي.
      privacy_email: cleanEmail(privacyEmail) ?? validSupportEmail,
      support_phone: PHONE_SAFE.test(supportPhone.trim()) ? supportPhone.trim() : null,
      // https بس — أي حاجة تانية (زي javascript:) بترجع null، نفس حارس help_url في support-contact.
      website_url: websiteUrl.trim().startsWith('https://') ? websiteUrl.trim() : null,
      commercial_register: cleanText(commercialRegister),
      tax_id: cleanText(taxId),
    };
  }
}
