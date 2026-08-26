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

interface WarrantyClaimResponse {
  id: string;
  warranty_id: string;
  order_id: string | null;
  project_id: string | null;
  customer_id: string;
  status: string;
  defect_description: string;
  defect_discovered_at: string | null;
  attachments: { storage_key: string; uploaded_at: string }[];
  resolution_notes: string | null;
  rejection_reason: string | null;
  repair_order_id: string | null;
  original_provider_id: string | null;
  provider_deadline: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

function toWarrantyClaimResponse(claim: WarrantyClaim): WarrantyClaimResponse {
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

interface WarrantyClaimAdminDetails {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  warranty_name: string | null;
  order_number: string | null;
  project_number: string | null;
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
    const details = items.length === 0
      ? []
      : await this.dataSource.query<WarrantyClaimAdminDetails[]>(
        `SELECT wc.id,
                u.full_name AS customer_name,
                u.phone_number AS customer_phone,
                cw.name_ar AS warranty_name,
                o.order_number,
                p.project_number
         FROM warranty_claims wc
         LEFT JOIN customer_profiles cp ON cp.id = wc.customer_id
         LEFT JOIN users u ON u.id = cp.user_id
         LEFT JOIN customer_warranties cw ON cw.id = wc.warranty_id
         LEFT JOIN orders o ON o.id = wc.order_id
         LEFT JOIN projects p ON p.id = wc.project_id
         WHERE wc.id = ANY($1::uuid[])`,
        [items.map((claim) => claim.id)],
      );
    const detailsById = new Map(details.map((row) => [row.id, row]));
    return {
      items: items.map((claim) => ({
        ...toWarrantyClaimResponse(claim),
        customer_name: detailsById.get(claim.id)?.customer_name ?? null,
        customer_phone: detailsById.get(claim.id)?.customer_phone ?? null,
        warranty_name: detailsById.get(claim.id)?.warranty_name ?? null,
        order_number: detailsById.get(claim.id)?.order_number ?? null,
        project_number: detailsById.get(claim.id)?.project_number ?? null,
      })),
      meta: { page, per_page: perPage, total },
    };
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
