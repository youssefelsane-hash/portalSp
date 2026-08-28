import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SettingsService } from './settings.service';

const NEAR_TERM_HOURS_FALLBACK = 48;
// نفس fallback الموجود في `catalog.service.ts` بالحرف — لو الاتنين اتفرقوا، التنبيه اللي العميل
// بيشوفه هيقول نسبة غير اللي هتتحصّل منه فعلاً.
const EMERGENCY_SURCHARGE_PERCENTAGE_FALLBACK = 20;

/**
 * سياسة المواعيد المعروضة للعميل (docs/08 §61.3، طلب مالك صريح).
 *
 * `@Public()` عمداً — نفس فلسفة `SupportContactController`/`HomepageContentController`: معلومة
 * عامة بحتة (مفيش أي بيانات شخصية)، والعميل بيشوف التنبيه قبل ما يسجّل دخول أصلاً في تدفق الحجز
 * السريع.
 *
 * **العتبة بترجع من الإعدادات مش ثابتة في نص التطبيق**: `matching.near_term_request_hours` هي
 * نفس القيمة اللي `MatchingService.isNearTermOrder()` بيقرا منها (ADR-0035). لو التطبيق كتب "48"
 * ثابتة، أول ما الأدمن يغيّر العتبة يبقى النص اللي العميل شايفه **كذب** — والتنبيه ده غرضه
 * الأساسي إنه يبني توقّع صح.
 */
@Controller('booking-policy')
export class BookingPolicyController {
  constructor(private readonly settingsService: SettingsService) {}

  @Public()
  @Get()
  async get() {
    const nearTermHours = await this.settingsService.getNumber(
      'matching.near_term_request_hours',
      NEAR_TERM_HOURS_FALLBACK,
    );
    // ADR-0048 — نسبة رسوم الاستعجال لازم توصل للعميل **قبل** ما يختار النهارده، مش بعد ما
    // يتحاسب. التنبيه الأحمر في شاشة الميعاد بيقراها من هنا، ومن نفس المفتاح اللي التسعير
    // بيستخدمه (`pricing.emergency_surcharge_percentage`) — رقم واحد، مصدر واحد.
    const emergencySurchargePercentage = await this.settingsService.getNumber(
      'pricing.emergency_surcharge_percentage',
      EMERGENCY_SURCHARGE_PERCENTAGE_FALLBACK,
    );
    return {
      near_term_request_hours: nearTermHours,
      // 0 = التعطيل (كل غير الطوارئ يتعيّن تلقائي) — وقتها مفيش تنبيه يتعرض أصلاً.
      near_term_confirmation_required: nearTermHours > 0,
      emergency_surcharge_percentage: emergencySurchargePercentage,
    };
  }
}
