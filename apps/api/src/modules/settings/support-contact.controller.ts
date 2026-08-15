import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SettingsService } from './settings.service';

// أرقام دولية بس (زي اتفاقية WhatsApp Click-to-Chat الرسمية) — أي حاجة تانية (فراغات/رموز) بترفض
// بأمان (بترجع null) بدل ما تتبني في رابط deep-link ممكن يبقى غير آمن.
const DIGITS_ONLY = /^[0-9]{6,20}$/;

export interface SupportContactResponseDto {
  enabled: boolean;
  phone_number: string | null;
  whatsapp_number: string | null;
  /** رابط wa.me جاهز، محسوب من whatsapp_number بعد تحقق أمان — null لو الرقم مش موجود/غير صالح. */
  whatsapp_url: string | null;
  email: string | null;
  /** لازم يبدأ https:// — أي حاجة تانية (زي javascript:) بترجع null. */
  help_url: string | null;
}

/**
 * بيانات تواصل خدمة العملاء (docs/08 §22 بند 15-19) — @Public() عمداً، نفس فلسفة BrandingController
 * بالحرف: العميل/الفني محتاجينها قبل أي تسجيل دخول أحيانًا (شاشة مساعدة عامة). التعديل عبر
 * /admin/settings/:key الموجود بالفعل (صلاحية settings.manage + MFA step-up + audit log —
 * صفر كود إضافي مطلوب هناك). التحقق الأمني (whatsapp digits-only، help_url https فقط) هنا عمدًا
 * مش في الأدمن — القراءة العامة هي المسار اللي فعليًا بيبني deep link يتنفّذ على جهاز المستخدم.
 */
@Controller('settings')
export class SupportContactController {
  constructor(private readonly settingsService: SettingsService) {}

  @Public()
  @Get('support-contact')
  async getSupportContact(): Promise<SupportContactResponseDto> {
    const [enabled, phoneNumber, whatsappNumber, email, helpUrl] = await Promise.all([
      this.settingsService.getBoolean('support.enabled', false),
      this.settingsService.getString('support.phone_number', ''),
      this.settingsService.getString('support.whatsapp_number', ''),
      this.settingsService.getString('support.email', ''),
      this.settingsService.getString('support.help_url', ''),
    ]);

    const validWhatsapp = DIGITS_ONLY.test(whatsappNumber) ? whatsappNumber : null;
    const validHelpUrl = helpUrl.startsWith('https://') ? helpUrl : null;

    return {
      enabled,
      phone_number: phoneNumber || null,
      whatsapp_number: validWhatsapp,
      whatsapp_url: validWhatsapp ? `https://wa.me/${validWhatsapp}` : null,
      email: email || null,
      help_url: validHelpUrl,
    };
  }
}
