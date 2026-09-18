import { Controller, Get, Headers, HttpStatus, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import {
  appendLinkParams,
  resolveSmartLinkTarget,
  type SmartLinkPlatform,
} from '../../common/marketing/smart-link-destination';
import { SettingsService } from '../settings/settings.service';

const USER_AGENT_SCAN_LIMIT = 512;

/**
 * **رابط QR ترشيح الفني** (docs/08 §165، بلاغ مالك 2026-09-18).
 *
 * > «لو حد سكن أي QR كود طالع من الموقع عندنا، لو ما عندوش الأبلكيشن يروح أوتوماتيك محوّله على
 * > جوجل بلاي عشان ينزله، أو على الأقل بيحوله على الويب سايت بتاعتنا. بلاش إن حد يسكن QR كود
 * > يروح جامب على الرقم.»
 *
 * الـQR في تطبيق الفني كان بيشفّر **التوكن الخام** (`QrImageView(data: summary.referralToken)`)،
 * فالعميل اللي بيصوّره بكاميرا الموبايل العادية بيشوف نص زي `TECH-000004` ومايعرفش يعمل بيه
 * إيه. أكواد الخصم كانت معمولة صح من الأول (`/p/:code`) — ده تعميم لنفس النمط، مش نمط جديد.
 *
 * **فرق واحد مقصود عن `/p/:code`**: مفيش تسجيل زيارات هنا. ترشيح الفني مالوش جدول زيارات،
 * وإضافة واحد مش مطلوبة للطلب ده — الغرض إن المسح يوصّل لمكان مفيد، مش يقيس حملة.
 * لو اتطلب قياس بعدين، مكانه جدول زي `promo_code_link_hits` بنفس الشكل.
 */
@Controller('t')
export class TechnicianReferralLinkController {
  constructor(private readonly settings: SettingsService) {}

  private detectPlatform(userAgent: string | undefined): SmartLinkPlatform {
    const ua = (userAgent ?? '').slice(0, USER_AGENT_SCAN_LIMIT).toLowerCase();
    if (!ua) return 'other';
    if (ua.includes('android')) return 'android';
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    if (/mozilla|chrome|safari|firefox|edg\//.test(ua)) return 'web';
    return 'other';
  }

  /**
   * **الرد بيتكتب على `Response` مباشرةً مش بـ`@Redirect`** — نفس سبب `/r/:code` و`/p/:code`:
   * `ResponseInterceptor` بيلفّ أي قيمة راجعة في `{ success, data, … }`، فـ`@Redirect` بيلاقي
   * `url` مش موجود على المستوى الأول ويطلّع 302 بهيدر `Location` فاضي.
   *
   * **التوكن مابيتفحصش هنا**: الوجهة واحدة سواء الكود صح أو غلط، والفحص الحقيقي بيحصل وقت
   * ما العميل يحفظ الكود (`POST /me/technician-referral`). فحص هنا معناه استعلام على كل مسح
   * بلا فايدة، وكشف إن التوكن ده موجود ولا لأ لأي حد بيجرّب.
   */
  @Get(':token')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async follow(
    @Param('token') token: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const platform = this.detectPlatform(userAgent);
    const target = await resolveSmartLinkTarget(this.settings, platform);
    const clean = (token ?? '').trim().slice(0, 64);
    res.redirect(HttpStatus.FOUND, clean ? appendLinkParams(target, { tref: clean }) : target);
  }
}
