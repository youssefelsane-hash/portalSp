import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { WarrantyClaim } from '../projects/entities/warranty-entities';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditLogService } from '../audit/audit-log.service';

const CLAIM_TRANSITIONS: Record<string, readonly string[]> = {
  open: ['under_review', 'rejected'],
  under_review: ['inspection_scheduled', 'approved', 'rejected'],
  inspection_scheduled: ['approved', 'rejected'],
  approved: ['repair_in_progress', 'resolved'],
  repair_in_progress: ['resolved'],
  resolved: ['closed'],
  rejected: ['closed'],
  closed: [],
};

function toWarrantyClaimResponse(claim: WarrantyClaim): Record<string, unknown> {
  return {
    id: claim.id,
    warranty_id: claim.warrantyId,
    order_id: claim.orderId,
    project_id: claim.projectId,
    customer_id: claim.customerId,
    status: claim.status,
    defect_description: claim.defectDescription,
    defect_discovered_at: claim.defectDiscoveredAt,
    attachments: claim.attachments,
    resolution_notes: claim.resolutionNotes,
    rejection_reason: claim.rejectionReason,
    repair_order_id: claim.repairOrderId,
    original_provider_id: claim.originalProviderId,
    provider_deadline: claim.providerDeadline?.toISOString() ?? null,
    resolved_at: claim.resolvedAt?.toISOString() ?? null,
    closed_at: claim.closedAt?.toISOString() ?? null,
    created_at: claim.createdAt.toISOString(),
    updated_at: claim.updatedAt.toISOString(),
  };
}

@Controller('admin/warranty-claims')
@Roles(UserType.ADMIN)
export class AdminWarrantyClaimsController {
  constructor(
    @InjectRepository(WarrantyClaim) private readonly claims: Repository<WarrantyClaim>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  @RequirePermission('warranty.view')
  async list(
    @Query('status') status?: string,
    @Query('page') pageValue?: string,
    @Query('per_page') perPageValue?: string,
  ) {
    if (status && status !== 'all' && !(status in CLAIM_TRANSITIONS)) {
      throw new ApiException(ErrorCode.VAL_001, 'حالة المطالبة غير صحيحة', HttpStatus.BAD_REQUEST);
    }
    const where = status && status !== 'all' ? { status } : {};
    const page = Math.max(1, Number.parseInt(pageValue ?? '1', 10) || 1);
    const perPage = Math.min(100, Math.max(1, Number.parseInt(perPageValue ?? '20', 10) || 20));
    const [items, total] = await this.claims.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });
    return { items: items.map(toWarrantyClaimResponse), meta: { page, per_page: perPage, total } };
  }

  @Patch(':id/review')
  @RequirePermission('warranty.review')
  async review(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { status: string; resolution_notes?: string; rejection_reason?: string },
  ) {
    if (!dto.status || !(dto.status in CLAIM_TRANSITIONS)) {
      throw new ApiException(ErrorCode.VAL_001, 'حالة المطالبة غير صحيحة', HttpStatus.BAD_REQUEST);
    }
    if (dto.status === 'rejected' && !dto.rejection_reason?.trim()) {
      throw new ApiException(ErrorCode.VAL_001, 'سبب رفض المطالبة إجباري', HttpStatus.BAD_REQUEST);
    }
    return this.dataSource.transaction(async (manager) => {
      const claim = await manager
        .createQueryBuilder(WarrantyClaim, 'claim')
        .setLock('pessimistic_write')
        .where('claim.id = :id', { id })
        .getOne();
      if (!claim) throw new ApiException(ErrorCode.VAL_001, 'المطالبة غير موجودة', HttpStatus.NOT_FOUND);
      const previousStatus = claim.status;
      if (!CLAIM_TRANSITIONS[previousStatus]?.includes(dto.status)) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `لا يمكن نقل المطالبة من ${previousStatus} إلى ${dto.status}`,
          HttpStatus.CONFLICT,
        );
      }
      claim.status = dto.status;
      if (dto.resolution_notes !== undefined) claim.resolutionNotes = dto.resolution_notes.trim() || null;
      if (dto.rejection_reason !== undefined) claim.rejectionReason = dto.rejection_reason.trim() || null;
      if (dto.status === 'resolved') claim.resolvedAt = new Date();
      if (dto.status === 'closed') claim.closedAt = new Date();
      await manager.save(claim);
      await this.auditLog.record({
        actorUserId: admin.sub,
        actorRole: 'admin',
        action: 'warranty_claim.reviewed',
        entityType: 'warranty_claim',
        entityId: claim.id,
        oldValues: { status: previousStatus },
        newValues: {
          status: claim.status,
          resolution_notes: claim.resolutionNotes,
          rejection_reason: claim.rejectionReason,
        },
      }, manager);
      return toWarrantyClaimResponse(claim);
    });
  }
}
