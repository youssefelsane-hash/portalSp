import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { BrandingService } from './branding.service';

/**
 * الاستهلاك العام (Customer/Technician apps + Admin panel) — @Public() عمداً، البراندنج مش بيانات
 * حساسة، والعكس صح: لازم تكون متاحة قبل أي تسجيل دخول (شاشة splash/login نفسها محتاجاها).
 */
@Controller('branding')
export class BrandingController {
  constructor(private readonly brandingService: BrandingService) {}

  @Public()
  @Get()
  async getBranding() {
    return this.brandingService.getPublicPayload();
  }
}
