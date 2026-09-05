import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { User, UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AuditLogService } from '../audit/audit-log.service';
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
    private readonly auditLog: AuditLogService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Post('promo-codes')
  @RequirePermission('promotions.manage')
  async create(@CurrentUser() admin: JwtPayload, @Body() dto: CreatePromoCodeDto, @AuditContext() audit: AuditMeta) {
    return toPromoCodeResponseDto(await this.promoCodesService.create(admin.sub, dto, audit));
  }

  @Get('promo-codes')
  @RequirePermission('promotions.view')
  async list(@Query() query: ListPromoCodesQueryDto) {
    const { items, meta } = await this.promoCodesService.list(query);
    return { items: items.map(toPromoCodeResponseDto), meta };
  }

  @Post('promo-codes/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('promotions.manage')
  async deactivate(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    return toPromoCodeResponseDto(await this.promoCodesService.deactivate(id, admin.sub, audit));
  }

  // نقاط ولاء يدوية (تعويض، هدية عيد ميلاد، ...) — مسار إداري بس، مفيش قاعدة تلقائية موصّلة لسه
  @Post('customers/:userId/loyalty/credit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('loyalty.manage')
  async creditLoyalty(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ManualLoyaltyCreditDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new ApiException(ErrorCode.VAL_001, 'المستخدم غير موجود', HttpStatus.NOT_FOUND);
    }
    const transaction = await this.dataSource.transaction(async (manager) => {
      const earned = await this.loyaltyService.earn(userId, dto.points, LoyaltySource.MANUAL, null, null, manager);
      await this.auditLog.record(
        {
          actorUserId: admin.sub,
          actorRole: 'admin',
          action: 'loyalty.manual_credit',
          entityType: 'customer_loyalty',
          entityId: userId,
          newValues: { points_credited: dto.points, balance_after: earned.balanceAfter },
          meta: audit,
        },
        manager,
      );
      return earned;
    });
    return { user_id: userId, points_balance: transaction.balanceAfter };
  }
}
