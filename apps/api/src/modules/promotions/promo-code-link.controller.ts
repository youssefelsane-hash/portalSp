import { Controller, Get, Headers, HttpStatus, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { PromoCodeLinksService } from './promo-code-links.service';

/** رابط QR عام لكود خصم: يسجل الزيارة ثم يفتح رحلة العميل نفسها بالكود في سياقها. */
@Controller('p')
export class PromoCodeLinkController {
  constructor(private readonly links: PromoCodeLinksService) {}

  @Get(':code')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async follow(
    @Param('code') code: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const platform = this.links.detectPlatform(userAgent);
    const promo = await this.links.findActiveByCode(code);
    if (promo) await this.links.recordHit(promo.id, platform);

    // كود منتهي/موقوف لا يترك الزائر في صفحة خطأ؛ نفتح المنصة فقط بلا كود معروض.
    const destination = await this.links.resolveDestination(platform, promo?.code ?? '');
    res.redirect(HttpStatus.FOUND, destination);
  }
}
