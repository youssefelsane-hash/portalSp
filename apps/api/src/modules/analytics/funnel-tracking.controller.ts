import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { TrackClientFunnelEventDto } from './dto/track-funnel-event.dto';
import { resolveFunnelSession } from './funnel-request.util';
import { FunnelTrackerService } from './funnel-tracker.service';

/**
 * تسجيل مراحل الرحلة اللي **مالهاش نداء سيرفر أصلاً** (ADR-0081 §3، إحصائيات-٦).
 *
 * ## ليه الكلاينت هو اللي بيسجّلها
 *
 * «شاف الخدمة» و«بدأ الحجز» بيحصلوا **جوّه التطبيق من غير ما يكلّم السيرفر**: العميل بيفتح
 * صفحة خدمة أو يضغط «احجز» — مفيش endpoint بيتنادى. من غير التسجيل ده، أول رقم في الفنل
 * بيبقى «شاف السعر»، والسؤال «كام حد فتح الصفحة وما كمّلش؟» بيفضل بلا إجابة للأبد.
 *
 * ## اللي **مسموح** للكلاينت يسجّله
 *
 * المراحل اللي بعديها (السعر، الفنيين، تأكيد الطلب) ليها نداءات سيرفر حقيقية والسيرفر بيسجّلها
 * بنفسه (`OrdersController`). **قبولها من الكلاينت كان هيسمح لأي حد ينفخ الفنل** برقم مش وراه
 * فعل حقيقي — والأخطر إنه ينفخ المراحل الأخيرة فيبان إن الفلو سليم وهو مكسور. القايمة
 * البيضا في `CLIENT_TRACKABLE_STAGES` هي الحارس ده، والـDTO بيرفض أي حاجة برّاها بـ400.
 *
 * ## مفتوح بلا مصادقة عن قصد
 *
 * «شاف الخدمة» بيحصل قبل تسجيل الدخول — ده بالظبط أول خطوة في الرحلة. الطلب بيمرّ بلا توكن،
 * ولو فيه توكن بنربط المستخدم. والحماية من الإغراق هي الـthrottle تحت مش المصادقة.
 */
@Controller('analytics/funnel-events')
export class FunnelTrackingController {
  constructor(private readonly tracker: FunnelTrackerService) {}

  /**
   * الحد ٦٠ حدث/دقيقة للـIP: أكتر بكتير من أي استخدام بشري حقيقي (رحلة حجز كاملة فيها ٤ أحداث)،
   * وأقل بكتير من إغراق مفيد. بيرجّع 204 دايمًا — الكلاينت مالوش أي قرار بيتوقف على النتيجة،
   * وإرجاع خطأ كان هيغري الكلاينت يعيد المحاولة على حاجة إحصائية.
   */
  @Post()
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async track(
    @Body() dto: TrackClientFunnelEventDto,
    @Headers('x-funnel-session') sessionHeader: string | undefined,
    // `user` اختياري هنا عن قصد — المسار عام، والحدث ده بيحصل قبل الدخول غالبًا.
    @Req() req: Request & { user?: JwtPayload },
  ): Promise<void> {
    await this.tracker.track({
      stage: dto.stage,
      source: 'client',
      funnelSessionId: resolveFunnelSession(sessionHeader),
      // المستخدم اختياري: الحدث ده بيحصل قبل الدخول غالبًا. `req.user` بيتملى بس لو التوكن اتبعت.
      userId: req.user?.sub ?? null,
      serviceId: dto.service_id ?? null,
      cityId: dto.city_id ?? null,
      clientChannel: dto.channel,
    });
  }
}
