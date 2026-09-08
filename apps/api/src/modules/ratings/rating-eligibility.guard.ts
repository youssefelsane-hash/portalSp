import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { RatingsService } from './ratings.service';

/**
 * فحص هوية وحالة الطلب يسبق ValidationPipe الخاص بجسم التقييم. ده مهم لأن العميل لو أرسل
 * body قديمًا أو خاطئًا لطلب ملغي، السبب المفيد له هو أن الطلب لا يُقيَّم أصلًا، لا اسم حقل
 * تقني في body. الخدمة تعيد الفحص عند التنفيذ لحماية السباق بين الحارس والحفظ.
 */
@Injectable()
export class CustomerRatingEligibilityGuard implements CanActivate {
  constructor(private readonly ratingsService: RatingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await this.ratingsService.assertCustomerCanRate(request.user.sub, request.params.id);
    return true;
  }
}
