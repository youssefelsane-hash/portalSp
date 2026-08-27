import { Body, Controller, Get, HttpCode, HttpStatus, Logger, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsBoolean } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CampaignsService } from './campaigns.service';
import { RecordServiceIntentDto } from './dto/campaign.dto';

class UpdateMarketingPreferenceDto {
  @IsBoolean()
  marketing_opt_out: boolean;
}

@Controller('customer')
@Roles(UserType.CUSTOMER)
export class CustomerCampaignsController {
  private readonly logger = new Logger(CustomerCampaignsController.name);

  constructor(
    private readonly campaigns: CampaignsService,
    @InjectRepository(CustomerProfile) private readonly customerProfiles: Repository<CustomerProfile>,
  ) {}

  /**
   * «العميل فتح صفحة خدمة» (ADR-0046 §5). التطبيق بينده ده fire-and-forget.
   *
   * **بيرجّع 200 حتى لو التسجيل فشل**: ده مجرد إشارة تسويقية، وما ينفعش يظهر للعميل كخطأ وهو
   * بيتصفّح خدمة عادي. الفشل بيتسجّل تحذير للتشخيص بس.
   */
  @Post('service-intents')
  @HttpCode(HttpStatus.OK)
  async recordIntent(@CurrentUser() user: JwtPayload, @Body() dto: RecordServiceIntentDto) {
    try {
      await this.campaigns.recordIntent(user.sub, dto.service_id, dto.intent_stage ?? 'viewed_service');
    } catch (err) {
      this.logger.warn(`فشل تسجيل اهتمام العميل ${user.sub} بالخدمة ${dto.service_id}: ${String(err)}`);
    }
    return { recorded: true };
  }

  /**
   * إلغاء الاشتراك التسويقي — **مستقل تمامًا** عن تفضيلات قنوات إشعارات الطلبات (ADR-0046 §6).
   * العميل يقفل الإعلانات من غير ما يفقد «الفني في الطريق».
   */
  @Get('marketing-preference')
  async getPreference(@CurrentUser() user: JwtPayload) {
    const profile = await this.customerProfiles.findOne({ where: { userId: user.sub } });
    return { marketing_opt_out: profile?.marketingOptOut ?? false };
  }

  @Patch('marketing-preference')
  async updatePreference(@CurrentUser() user: JwtPayload, @Body() dto: UpdateMarketingPreferenceDto) {
    await this.customerProfiles.update({ userId: user.sub }, { marketingOptOut: dto.marketing_opt_out });
    return { marketing_opt_out: dto.marketing_opt_out };
  }
}
