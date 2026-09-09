import { Controller, Get, Headers, HttpStatus, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { MarketingService } from './marketing.service';

/**
 * رابط الاكتساب الذكي — نقطة الدخول اللي الـQR بيوصّل لها (ADR-0082 §2، docs/08 §135).
 *
 * ## ليه رابط واحد بدل QR لكل متجر
 *
 * الملصق بيتطبع مرة واحدة ويعيش شهور على حيطة. لو الـQR بيوصل لجوجل بلاي مباشرةً، أي تغيير —
 * متجر جديد، صفحة هبوط جديدة، حملة اتوقفت — معناه **إعادة طباعة كل الملصقات**. رابط واحد ثابت
 * والتوزيع في السيرفر معناه إن الملصق يفضل صالح والوجهة تتغيّر من الإعدادات في ثانية.
 *
 * ## عام بلا مصادقة عن قصد
 *
 * الزائر ده لسه مش عميل — دي أول لحظة في الرحلة كلها. أي مصادقة هنا معناها إن الرابط مايشتغلش.
 *
 * ## مسار قصير `‎/r/:code` بدل `‎/api/v1/...`
 *
 * الرابط ده بيتكتب تحت QR على ورق وبيتقرا بالعين ويتكتب بالإيد. `‎/r/AB12CD` قابل للكتابة،
 * و`‎/api/v1/marketing/links/AB12CD` لأ. الاستثناء ده متسجّل في `main.ts` مع باقي المسارات
 * اللي برّه البادئة.
 */
@Controller('r')
export class MarketingLinkController {
  constructor(private readonly marketing: MarketingService) {}

  /**
   * حد الطلبات عالي عن قصد (١٢٠/دقيقة للـIP): الملصق ممكن يتصوّر من مجموعة واقفة مع بعض على
   * نفس شبكة الواي-فاي، ورفض زائر حقيقي أسوأ بكتير من تسجيل زيارة زيادة.
   */
  /**
   * **الرد بيتكتب على `Response` مباشرةً مش بـ`@Redirect`** — وده مش تفضيل، ده إجبار.
   *
   * `ResponseInterceptor` عام على التطبيق كله وبيلفّ **أي** قيمة راجعة في
   * `{ success, data, meta, error, request_id }`. مع `@Redirect`، الإطار بيقرا `url` من القيمة
   * الراجعة — واللي بيوصله بعد اللفّ هو `{ success, data: { url } }`، فمفيش `url` على المستوى
   * الأول والنتيجة **302 بهيدر `Location` فاضي**: المتصفح بيقف على صفحة بيضا والزائر بيضيع.
   *
   * اتقاس حيًّا (`scripts/marketing-attribution-audit.js`، م-٢/أ): `HTTP=302 → ` بلا وجهة.
   * الكتابة المباشرة بتتخطى الـinterceptor بالكامل، وهي كمان الأصح دلاليًا — الرد ده تحويل
   * مش حمولة JSON.
   */
  @Get(':code')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async follow(
    @Param('code') code: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const platform = this.marketing.detectPlatform(userAgent);
    const source = await this.marketing.findActiveByCode(code);
    if (source) {
      // مابنستنّاش التسجيل قبل التحويل عن قصد؟ لأ — بننتظره لأنه `insert` واحد سريع وبيبلع
      // أخطاءه جوّه. الانتظار هنا بيضمن إن الزيارة مش بتضيع لو العملية اتقفلت بعد الرد.
      await this.marketing.recordHit(source.id, platform);
    }
    // كود غلط أو حملة موقوفة **مايوريش صفحة خطأ**: الزائر ده شاف إعلان حقيقي، فبنوديه للمنصة
    // من غير إسناد بدل ما نخسره تمامًا على غلطة إدارية.
    const url = await this.marketing.resolveDestination(platform, source ? source.code : '');
    res.redirect(HttpStatus.FOUND, url);
  }
}
