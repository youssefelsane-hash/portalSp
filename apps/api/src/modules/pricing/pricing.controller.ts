import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { EvaluatePricingDto } from './dto/evaluate-pricing.dto';
import { toPricingEvaluationResponseDto, toPricingFieldResponseDto } from './dto/pricing-response.dto';
import { PricingEngineService } from './pricing-engine.service';
import { PricingFieldsService } from './pricing-fields.service';

// نسخة العميل من محرك التسعير — عام (مفيش تسجيل دخول لازم)، نفس نمط
// catalog.controller.ts's estimate-duration بالحرف. الحقول (بدون min_price_cents الداخلي
// أو أي حاجة إدارية) عشان apps/customer-app يرسم الفورم الديناميكي، ثم evaluate-price لحساب
// السعر الفعلي بناءً على القيم اللي العميل دخلها.
@Controller()
export class PricingController {
  constructor(
    private readonly pricingEngine: PricingEngineService,
    private readonly fieldsService: PricingFieldsService,
  ) {}

  @Public()
  @Get('services/:id/pricing-fields')
  async listFields(@Param('id', ParseUUIDPipe) id: string) {
    const fields = await this.fieldsService.listForService(id);
    return fields.filter((f) => f.isActive).map(toPricingFieldResponseDto);
  }

  @Public()
  @Post('services/:id/evaluate-price')
  async evaluatePrice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EvaluatePricingDto) {
    const result = await this.pricingEngine.evaluate(id, dto.field_values);
    return toPricingEvaluationResponseDto(result);
  }
}
