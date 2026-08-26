import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SettingsService } from './settings.service';

const NEAR_TERM_HOURS_FALLBACK = 48;

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
    return {
      near_term_request_hours: nearTermHours,
      // 0 = التعطيل (كل غير الطوارئ يتعيّن تلقائي) — وقتها مفيش تنبيه يتعرض أصلاً.
      near_term_confirmation_required: nearTermHours > 0,
    };
  }
}
