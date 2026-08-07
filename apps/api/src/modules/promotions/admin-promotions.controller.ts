import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { User, UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';
import { ListPromoCodesQueryDto } from './dto/list-promo-codes-query.dto';
import { ManualLoyaltyCreditDto } from './dto/manual-loyalty-credit.dto';
import { toPromoCodeResponseDto } from './dto/promo-code-response.dto';
import { LoyaltySource } from './entities/loyalty-transaction.entity';
import { LoyaltyService } from './loyalty.service';
import { PromoCodesService } from './promo-codes.service';

@Controller('admin')
@Roles(UserType.ADMIN)
export class AdminPromotionsController {
  constructor(
    private readonly promoCodesService: PromoCodesService,
    private readonly loyaltyService: LoyaltyService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  @Post('promo-codes')
  async create(@CurrentUser() admin: JwtPayload, @Body() dto: CreatePromoCodeDto) {
    return toPromoCodeResponseDto(await this.promoCodesService.create(admin.sub, dto));
  }

  @Get('promo-codes')
  async list(@Query() query: ListPromoCodesQueryDto) {
    const { items, meta } = await this.promoCodesService.list(query);
    return { items: items.map(toPromoCodeResponseDto), meta };
  }

  @Post('promo-codes/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return toPromoCodeResponseDto(await this.promoCodesService.deactivate(id));
  }

  // نقاط ولاء يدوية (تعويض، هدية عيد ميلاد، ...) — مسار إداري بس، مفيش قاعدة تلقائية موصّلة لسه
  @Post('customers/:userId/loyalty/credit')
  @HttpCode(HttpStatus.OK)
  async creditLoyalty(@Param('userId', ParseUUIDPipe) userId: string, @Body() dto: ManualLoyaltyCreditDto) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new ApiException(ErrorCode.VAL_001, 'المستخدم غير موجود', HttpStatus.NOT_FOUND);
    }
    const transaction = await this.loyaltyService.earn(userId, dto.points, LoyaltySource.MANUAL);
    return { user_id: userId, points_balance: transaction.balanceAfter };
  }
}
