import { Body, Controller, Get, HttpStatus, Optional, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { WARRANTY_CLAIM_CHANGED_EVENT } from '../../common/events/warranty-claim-changed.event';

/** مسارات الضمان للعميل — فتح Claim ومتابعة مطالباته وضماناته. */
@Controller('me/warranties')
@Roles(UserType.CUSTOMER)
export class MyWarrantyController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  @Get()
  async myWarranties(@CurrentUser() user: JwtPayload) {
    const [profile] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM customer_profiles WHERE user_id = $1`, [user.sub],
    );
    if (!profile) return [];
    return this.dataSource.query(
      `SELECT cw.*, active_claim.id AS active_claim_id, active_claim.status AS claim_status,
              o.order_number, p.project_number
       FROM customer_warranties cw
       LEFT JOIN orders o ON o.id = cw.order_id
       LEFT JOIN projects p ON p.id = cw.project_id
       LEFT JOIN LATERAL (
         SELECT wc.id, wc.status::text AS status FROM warranty_claims wc
         WHERE wc.warranty_id = cw.id
           AND wc.status IN ('open','under_review','inspection_scheduled','approved','repair_in_progress')
         ORDER BY wc.created_at DESC LIMIT 1
       ) active_claim ON true
       WHERE cw.customer_id = $1 ORDER BY cw.created_at DESC`,
      [profile.id],
    );
  }

  @Post(':warrantyId/claims')
  async openClaim(
    @CurrentUser() user: JwtPayload,
    @Param('warrantyId', ParseUUIDPipe) warrantyId: string,
    @Body() dto: { defect_description: string; defect_discovered_at?: string; order_id?: string },
  ) {
    if (!dto.defect_description?.trim() || dto.defect_description.trim().length < 10) {
      throw new ApiException(ErrorCode.VAL_001, 'وصف العيب لازم يكون واضحًا (10 حروف على الأقل)', HttpStatus.BAD_REQUEST);
    }
    const [profile] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM customer_profiles WHERE user_id = $1`, [user.sub],
    );
    if (!profile) throw new ApiException(ErrorCode.VAL_001, 'بروفايل العميل غير موجود', HttpStatus.NOT_FOUND);

    const opened = await this.dataSource.transaction(async (manager) => {
      const [warranty] = await manager.query<{ id: string; expires_at: string; claims_used: number; max_claims: number; order_id: string | null; project_id: string | null }[]>(
        `SELECT id, expires_at, claims_used, max_claims, order_id, project_id
         FROM customer_warranties WHERE id = $1 AND customer_id = $2 FOR UPDATE`,
        [warrantyId, profile.id],
      );
      if (!warranty) throw new ApiException(ErrorCode.VAL_001, 'الضمان غير موجود', HttpStatus.NOT_FOUND);
      if (new Date(warranty.expires_at).getTime() <= Date.now()) {
        throw new ApiException(ErrorCode.VAL_001, 'انتهت صلاحية الضمان', HttpStatus.CONFLICT);
      }
      if (warranty.claims_used >= warranty.max_claims) {
        throw new ApiException(ErrorCode.VAL_001, 'تم استهلاك كل المطالبات المسموحة لهذا الضمان', HttpStatus.CONFLICT);
      }
      if (dto.order_id && dto.order_id !== warranty.order_id) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير تابع لهذا الضمان', HttpStatus.BAD_REQUEST);
      }
      const [active] = await manager.query<{ id: string }[]>(
        `SELECT id FROM warranty_claims WHERE warranty_id=$1
         AND status IN ('open','under_review','inspection_scheduled','approved','repair_in_progress') LIMIT 1`,
        [warrantyId],
      );
      if (active) throw new ApiException(ErrorCode.VAL_001, 'فيه مطالبة نشطة على الضمان بالفعل', HttpStatus.CONFLICT);

      const [claim] = await manager.query<{ id: string }[]>(
        `INSERT INTO warranty_claims (warranty_id, order_id, project_id, customer_id, defect_description, defect_discovered_at)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [warrantyId, warranty.order_id, warranty.project_id, profile.id, dto.defect_description.trim(), dto.defect_discovered_at ?? null],
      );
      const updated = await manager.query(
        `UPDATE customer_warranties SET claims_used = claims_used + 1
         WHERE id = $1 AND claims_used < max_claims RETURNING id`, [warrantyId],
      );
      if (!updated[0]) throw new ApiException(ErrorCode.VAL_001, 'تم استهلاك المطالبات المسموحة', HttpStatus.CONFLICT);
      return { id: claim.id, status: 'open' };
    });
    this.events?.emit(WARRANTY_CLAIM_CHANGED_EVENT, { claimId: opened.id, action: 'opened' });
    return opened;
  }

  @Get('claims')
  async myClaims(@CurrentUser() user: JwtPayload) {
    const [profile] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM customer_profiles WHERE user_id = $1`, [user.sub],
    );
    if (!profile) return [];
    return this.dataSource.query(
      `SELECT wc.id, wc.status::text AS status, wc.defect_description, wc.created_at,
              w.name_ar AS warranty_name, o.order_number
       FROM warranty_claims wc
       JOIN customer_warranties w ON w.id = wc.warranty_id
       LEFT JOIN orders o ON o.id = wc.order_id
       WHERE wc.customer_id = $1 ORDER BY wc.created_at DESC`,
      [profile.id],
    );
  }
}
