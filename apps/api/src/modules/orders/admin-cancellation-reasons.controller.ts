import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CreateCancellationReasonDto } from './dto/create-cancellation-reason.dto';
import { toCancellationReasonResponseDto } from './dto/cancellation-reason-response.dto';
import { UpdateCancellationReasonDto } from './dto/update-cancellation-reason.dto';
import { CancellationReasonsService } from './cancellation-reasons.service';

@Controller('admin/cancellation-reasons')
@Roles(UserType.ADMIN)
export class AdminCancellationReasonsController {
  constructor(private readonly cancellationReasonsService: CancellationReasonsService) {}

  @Get()
  async list() {
    const reasons = await this.cancellationReasonsService.listAllForAdmin();
    return reasons.map(toCancellationReasonResponseDto);
  }

  @Post()
  @RequirePermission('cancellation_reasons.manage')
  async create(@CurrentUser() admin: JwtPayload, @Body() dto: CreateCancellationReasonDto, @AuditContext() audit: AuditMeta) {
    return toCancellationReasonResponseDto(await this.cancellationReasonsService.create(admin.sub, dto, audit));
  }

  @Patch(':id')
  @RequirePermission('cancellation_reasons.manage')
  async update(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCancellationReasonDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toCancellationReasonResponseDto(await this.cancellationReasonsService.update(admin.sub, id, dto, audit));
  }
}
