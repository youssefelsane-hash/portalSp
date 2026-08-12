import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { DomesticWorkersService } from './domestic-workers.service';
import { DomesticWorkerVerificationStatus } from './entities/domestic-worker-profile.entity';
import { ReviewWorkerDto } from './dto/review-worker.dto';
import { toWorkerResponseDto } from './dto/worker-response.dto';

// إدارة قطاع الخدمات المنزلية (docs/08 §12، ADR-0004) — نفس صلاحية technicians.review_documents
// (قرار مراجعة approve/reject على مقدّم خدمة قبل ما يبان للعميل، نفس نوع القرار بالظبط).
@Controller('admin/domestic-workers')
@Roles(UserType.ADMIN)
export class AdminDomesticWorkersController {
  constructor(private readonly workersService: DomesticWorkersService) {}

  @Get()
  async list(@Query('status') status?: string) {
    if (status !== undefined && !Object.values(DomesticWorkerVerificationStatus).includes(status as DomesticWorkerVerificationStatus)) {
      throw new BadRequestException('status غير صحيحة');
    }
    const workers = await this.workersService.listForAdmin(status as DomesticWorkerVerificationStatus | undefined);
    return workers.map(toWorkerResponseDto);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.review_documents')
  async review(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewWorkerDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toWorkerResponseDto(await this.workersService.review(admin.sub, id, dto, audit));
  }
}
