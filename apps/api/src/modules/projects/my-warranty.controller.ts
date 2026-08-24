import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';

/** مسارات الضمان للعميل — فتح Claim ومتابعة مطالباته وضماناته. */
@Controller('me/warranties')
@Roles(UserType.CUSTOMER)
export class MyWarrantyController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  async myWarranties(@CurrentUser() user: JwtPayload) {
    const [profile] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM customer_profiles WHERE user_id = $1`, [user.sub],
    );
    if (!profile) return [];
    return this.dataSource.query(
      `SELECT cw.*, wc.id AS active_claim_id, wc.status::text AS claim_status
       FROM customer_warranties cw
       LEFT JOIN warranty_claims wc ON wc.warranty_id = cw.id AND wc.status NOT IN ('resolved','closed')
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
    const [profile] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM customer_profiles WHERE user_id = $1`, [user.sub],
    );
    if (!profile) throw new Error('بروفايل غير موجود');

    // التحقق من ملكية الضمان
    const [warranty] = await this.dataSource.query<{ id: string; expires_at: string; claims_used: number; max_claims: number; order_id: string | null; project_id: string | null }[]>(
      `SELECT id, expires_at, claims_used, max_claims, order_id, project_id FROM customer_warranties WHERE id = $1 AND customer_id = $2`,
      [warrantyId, profile.id],
    );
    if (!warranty) throw new Error('الضمان غير موجود');
    if (new Date(warranty.expires_at) < new Date()) throw new Error('انتهت صلاحية الضمان');
    if (warranty.claims_used >= warranty.max_claims) throw new Error('تم استهلاك كل المطالبات المسموحة لهذا الضمان');

    const [claim] = await this.dataSource.query<{ id: string }[]>(
      `INSERT INTO warranty_claims (warranty_id, order_id, project_id, customer_id, defect_description, defect_discovered_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [warrantyId, warranty.order_id, warranty.project_id, profile.id, dto.defect_description, dto.defect_discovered_at ?? null],
    );
    await this.dataSource.query(`UPDATE customer_warranties SET claims_used = claims_used + 1 WHERE id = $1`, [warrantyId]);
    return { id: claim.id, status: 'open' };
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
