import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';
import { SettingsService } from './settings.service';

const WARRANTY_DEFAULT_DAYS_FALLBACK = 14;

/**
 * معلومات الثقة اللي بتتعرض للعميل في الواجهة (docs/08 §75-ج).
 *
 * **ليه endpoint مش نص ثابت في التطبيق؟** طلب المالك بالحرف: «ومش بس ضمان 14 يوم… طالما إحنا
 * عندنا ضمان بالسنة، فما تكتبش 14 يوم». الدرس هنا أوسع من الرقم نفسه: أي وعد بيتكتب في
 * الواجهة كنص ثابت بيتحوّل لكذب أول ما الإعدادات تتغيّر، ومحدش بيفتكر يرجع يعدّل التطبيق.
 *
 * فالتطبيق بيسأل السيرفر عن **القيمة الحقيقية النافذة دلوقتي**، والسيرفر بيقراها من نفس
 * المكان اللي الضمان الفعلي بيتحسب منه (`warranty.default_days` + `services.warranty_days`).
 * يعني لو الإدارة رفعت الضمان لسنة، النص في التطبيق بيتغيّر لوحده بلا أي نشر جديد.
 *
 * `@Public()` عمدًا — نفس فلسفة `BookingPolicyController`: معلومة تسويقية عامة بحتة بلا أي
 * بيانات شخصية، والعميل بيشوفها قبل تسجيل الدخول في الصفحة الرئيسية.
 */
@Controller('trust-info')
export class TrustInfoController {
  constructor(
    private readonly settingsService: SettingsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Public()
  @Get()
  async get() {
    const defaultDays = await this.settingsService.getNumber(
      'warranty.default_days',
      WARRANTY_DEFAULT_DAYS_FALLBACK,
    );

    // أطول ضمان معروض فعلاً على أي خدمة نشطة — عشان الواجهة تقدر تقول "لحد كذا" بصدق بدل ما
    // تعمّم القيمة الافتراضية على خدمات ضمانها أطول.
    const [row] = await this.dataSource.query<{ max_days: number | null }[]>(
      `SELECT MAX(warranty_days) AS max_days
         FROM services
        WHERE is_active = true AND deleted_at IS NULL AND warranty_days > 0`,
    );
    const maxServiceDays = Number(row?.max_days ?? 0);

    const effectiveDays = Math.max(defaultDays, maxServiceDays);

    return {
      warranty_days: effectiveDays,
      // نص جاهز للعرض — **بيتولّد من الرقم الحقيقي**، فمفيش أي احتمال إن الواجهة تقول رقم
      // والنظام ينفّذ رقم تاني. التحويل لشهور/سنين بيحصل هنا مرة واحدة بدل ما كل واجهة
      // (تطبيق العميل، الويب، لو اتضاف تطبيق تالت) تعيد نفس المنطق وتختلف في الصياغة.
      warranty_label_ar: warrantyLabel(effectiveDays),
    };
  }
}

/**
 * صياغة عربية طبيعية لمدة الضمان. بتتجنّب «365 يوم» و«14 يوم» المحرجين لصالح صياغة بشرية.
 */
export function warrantyLabel(days: number): string {
  if (days <= 0) return 'ضمان على الشغل';
  if (days >= 365) {
    const years = Math.floor(days / 365);
    return years === 1 ? 'ضمان سنة كاملة' : `ضمان ${years} سنين`;
  }
  if (days >= 30) {
    const months = Math.floor(days / 30);
    return months === 1 ? 'ضمان شهر' : `ضمان ${months} شهور`;
  }
  if (days === 1) return 'ضمان يوم';
  if (days === 2) return 'ضمان يومين';
  return `ضمان ${days} يوم`;
}
