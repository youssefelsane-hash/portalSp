import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AnalyticsRangeQueryDto, resolveRange } from '../analytics/dto/analytics-range-query.dto';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';
import {
  CreateMarketingSourceDto,
  MarkCommissionsPaidDto,
  UpdateMarketingSourceDto,
  toMarketingSourceResponseDto,
} from './dto/marketing-source.dto';
import { MarketingService } from './marketing.service';

/**
 * إدارة مصادر التسويق وأرقامها (ADR-0082، docs/08 §135).
 *
 * كل شيء هنا تحت صلاحية `marketing.manage` عن قصد **حتى القراءة**: الأرقام دي بتكشف الصرف
 * وهوامش الاكتساب، ومش كل موظف أدمن مفروض يشوفها.
 */
@Controller('admin/marketing')
@Roles(UserType.ADMIN)
export class AdminMarketingController {
  constructor(private readonly marketing: MarketingService) {}

  /** أساس الروابط المطبوعة — من البيئة مش متخزّن، عشان الدومين لما يتغيّر مايسيبش أكواد ميتة. */
  private baseUrl(): string {
    return process.env.PUBLIC_BASE_URL || process.env.API_PUBLIC_URL || process.env.CUSTOMER_WEB_URL || '';
  }

  @Get('sources')
  @RequirePermission('marketing.manage')
  async listSources() {
    const sources = await this.marketing.listSources();
    const base = this.baseUrl();
    return sources.map((s) => toMarketingSourceResponseDto(s, base));
  }

  @Post('sources')
  @RequirePermission('marketing.manage')
  async createSource(@CurrentUser() user: JwtPayload, @Body() dto: CreateMarketingSourceDto) {
    const source = await this.marketing.createSource({
      nameAr: dto.name_ar,
      channel: dto.channel,
      code: dto.code,
      regionLabel: dto.region_label ?? null,
      notes: dto.notes ?? null,
      payoutPerCompletedOrderCents: dto.payout_per_completed_order_cents,
      payoutContactName: dto.payout_contact_name ?? null,
      payoutContactPhone: dto.payout_contact_phone ?? null,
      createdByUserId: user.sub,
    });
    return toMarketingSourceResponseDto(source, this.baseUrl());
  }

  @Patch('sources/:id')
  @RequirePermission('marketing.manage')
  async updateSource(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMarketingSourceDto) {
    const source = await this.marketing.updateSource(id, {
      ...(dto.name_ar !== undefined ? { nameAr: dto.name_ar } : {}),
      ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
      ...(dto.region_label !== undefined ? { regionLabel: dto.region_label } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
      ...(dto.payout_per_completed_order_cents !== undefined
        ? { payoutPerCompletedOrderCents: dto.payout_per_completed_order_cents }
        : {}),
      ...(dto.payout_contact_name !== undefined ? { payoutContactName: dto.payout_contact_name } : {}),
      ...(dto.payout_contact_phone !== undefined ? { payoutContactPhone: dto.payout_contact_phone } : {}),
    });
    return toMarketingSourceResponseDto(source, this.baseUrl());
  }

  /**
   * أرقام كل مصدر في الفترة — الرد المباشر على «أزوّد في الإعلان ده ولا لأ».
   *
   * `cac_cents` بيرجع `null` على مستوى المصدر عن قصد: الصرف بيتسجّل بالقناة والشهر
   * (`marketing_spend`)، مش بالمصدر. القسمة على مستوى المصدر كانت هتخترع رقم.
   */
  @Get('performance/sources')
  @RequirePermission('marketing.manage')
  async sourcePerformance(@Query() query: AnalyticsRangeQueryDto) {
    const { from, to } = resolveRange(query);
    return { from: from.toISOString(), to: to.toISOString(), sources: await this.marketing.sourcePerformance(from, to) };
  }

  /** نفس الأرقام مجمّعة بالقناة **زائد الصرف والـCAC** — مستوى المقارنة بين بوستر وإنفلونسر. */
  @Get('performance/channels')
  @RequirePermission('marketing.manage')
  async channelPerformance(@Query() query: AnalyticsRangeQueryDto) {
    const { from, to } = resolveRange(query);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      channels: await this.marketing.channelPerformance(from, to),
    };
  }

  @Get('commissions')
  @RequirePermission('marketing.manage')
  async listCommissions(@Query('source_id') sourceId?: string, @Query('status') status?: string) {
    return this.marketing.listCommissions(sourceId, status);
  }

  /**
   * تعليم مستحقات كمدفوعة بعد الصرف الفعلي.
   *
   * الشرط `status = 'accrued'` جوّه الـUPDATE نفسه (مش فحص قبله): ضغطتين متزامنتين على نفس
   * الصف لازم واحدة بس تعدّي، والرد بيرجّع **العدد اللي اتغيّر فعلاً** مش العدد المطلوب —
   * عشان الأدمن يشوف الحقيقة لو حاجة اتدفعت قبل كده.
   */
  @Post('commissions/mark-paid')
  @RequirePermission('marketing.manage')
  async markPaid(@CurrentUser() user: JwtPayload, @Body() dto: MarkCommissionsPaidDto) {
    const updated = await this.marketing.markCommissionsPaid(dto.ids, user.sub, dto.note);
    return { updated };
  }
}
