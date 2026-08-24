import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';

/** endpoint واحد يرجّع كل بيانات المشروع — timeline + quotes + milestones + payments. */
@Controller('me/projects')
@Roles(UserType.CUSTOMER)
export class ProjectRoomController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get(':id/room')
  async projectRoom(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const [profile] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM customer_profiles WHERE user_id = $1`, [user.sub],
    );
    const [project] = await this.dataSource.query<Record<string, unknown>[]>(
      `SELECT p.* FROM projects p
       JOIN customer_profiles cp ON cp.id = p.customer_id
       WHERE p.id = $1 AND cp.user_id = $2 AND p.deleted_at IS NULL`,
      [id, profile?.id ?? null],
    );
    if (!project) return { error: 'المشروع غير موجود' };

    const quotes = await this.dataSource.query(
      `SELECT id, version, status, total_cents, duration_days FROM project_quotes WHERE project_id = $1 ORDER BY version DESC`, [id],
    );
    const milestones = await this.dataSource.query(
      `SELECT id, sequence_number, name_ar, amount_cents, execution_status, approval_status, payment_status, payout_status, is_down_payment
       FROM project_milestones WHERE project_id = $1 ORDER BY sequence_number ASC`, [id],
    );
    const orders = await this.dataSource.query(
      `SELECT o.id, o.order_number, o.order_status::text AS status, o.total_amount_cents
       FROM orders o WHERE o.project_id = $1 AND o.deleted_at IS NULL ORDER BY o.created_at ASC`, [id],
    );
    const warranties = await this.dataSource.query(
      `SELECT cw.id, cw.name_ar, cw.coverage_months, cw.expires_at, cw.claims_used
       FROM customer_warranties cw WHERE cw.project_id = $1 ORDER BY cw.created_at DESC`, [id],
    );

    return {
      project,
      quotes,
      milestones,
      orders,
      warranties,
      summary: {
        total_financed_cents: Number(project.approved_quote_total_cents ?? 0),
        paid_cents: Number(project.paid_cents ?? 0),
        remaining_cents: Number(project.remaining_cents ?? 0),
        milestone_count: milestones.length,
      },
    };
  }
}
