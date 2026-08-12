import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AddressesService } from '../customers/addresses.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CatalogService } from '../catalog/catalog.service';
import { GeoService } from '../geo/geo.service';
import { PromoApplicationResult, PromoCodesService } from './promo-codes.service';

@Injectable()
export class PromotionsService {
  constructor(
    private readonly promoCodesService: PromoCodesService,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly addressesService: AddressesService,
    private readonly catalogService: CatalogService,
    private readonly geoService: GeoService,
  ) {}

  /**
   * نفس منطق تحديد المنطقة/التسعير في orders.service.ts بالظبط — معاينة قبل إنشاء الطلب، بدون قفل ولا تسجيل استخدام.
   * fieldValues لازمة لخدمات pricing_model=formula بس (نفس منطق CreateOrderDto.field_values) — لو
   * الخدمة formula وفيها حقول مطلوبة ومتبعتش، PricingEngineService.evaluate() هيرمي نفس خطأ
   * "الحقل مطلوب" اللي POST /orders هيرميه بالظبط — سلوك متسق عمداً، مش ثغرة سعر تانية.
   */
  async previewForOrder(
    userId: string,
    code: string,
    serviceId: string,
    addressId: string,
    fieldValues?: Record<string, string | number | boolean>,
  ): Promise<PromoApplicationResult> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const address = await this.addressesService.findOwnedOrThrow(userId, addressId);
    const service = await this.catalogService.findServiceOrThrow(serviceId);

    if (!address.cityId) {
      throw new ApiException(ErrorCode.ORDR_001, 'العنوان مش مربوط بمدينة', HttpStatus.BAD_REQUEST);
    }
    const zone = await this.geoService.findZoneForCity(address.cityId);
    if (!zone) {
      throw new ApiException(ErrorCode.ORDR_001, 'الخدمة غير متاحة في منطقتك لسه', HttpStatus.BAD_REQUEST);
    }

    const estimate = await this.catalogService.estimate(service.id, zone.id, undefined, false, fieldValues);
    // مش customerProfile.totalOrdersCount — بَقّة حقيقية موثّقة في customer-profiles.service.ts's
    // isNewCustomer()، العمود ده بيتحدّث async بعد commit إنشاء الطلب مش لحظيًا.
    const isNewCustomer = await this.customerProfiles.isNewCustomer(customerProfile.id);

    return this.promoCodesService.preview(code, userId, {
      serviceId: service.id,
      zoneId: zone.id,
      totalBeforeDiscountCents: estimate.estimated_total_cents + estimate.inspection_fee_cents,
      inspectionFeeCents: estimate.inspection_fee_cents,
      isNewCustomer,
    });
  }
}
