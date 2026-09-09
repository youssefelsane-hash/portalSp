import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { returningFirst } from '../../common/db/returning-rows';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { calculateEarningsV2 } from './earnings-calculator';
import {
  CreateTechnicianEarningAdjustmentDto,
  SimulateEarningsDto,
  UpdateEarningsLevelPolicyDto,
  UpdateEarningsSkillPolicyDto,
  UpdatePlatformCommissionDto,
  UpdateServiceLevelEarningsOverrideDto,
  UpdateServiceSkillEarningsOverrideDto,
} from './dto/earnings-policy.dto';

@Injectable()
export class AdminEarningsPolicyService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
  ) {}

  async overview() {
    const [
      levels,
      skills,
      services,
      serviceLevelOverrides,
      serviceSkillOverrides,
      technicians,
      adjustments,
      auditHistory,
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT id, level, display_name_ar, earning_weight_bps, assistant_ratio_bps,
                order_priority_weight, can_lead_team
           FROM technician_level_config ORDER BY order_priority_weight`,
      ),
      this.dataSource.query(`SELECT skill_level, factor_bps, updated_at FROM earnings_skill_policy ORDER BY skill_level`),
      this.dataSource.query(
        `SELECT id, name_ar, slug, is_active, ROUND(commission_percentage * 100)::integer AS platform_commission_bps
           FROM services WHERE deleted_at IS NULL ORDER BY is_active DESC, name_ar`,
      ),
      this.dataSource.query(`SELECT * FROM service_earnings_level_overrides ORDER BY service_id, technician_level`),
      this.dataSource.query(`SELECT * FROM service_earnings_skill_overrides ORDER BY service_id, skill_level`),
      this.dataSource.query(
        `SELECT tp.id, u.full_name, tp.technician_kind, tp.current_level
           FROM technician_profiles tp
           JOIN users u ON u.id = tp.user_id
          WHERE tp.deleted_at IS NULL AND u.deleted_at IS NULL
          ORDER BY u.full_name`,
      ),
      this.dataSource.query(
        `SELECT tea.id, tea.technician_id, u.full_name, tp.technician_kind,
                tp.current_level, tea.service_id, s.name_ar AS service_name_ar,
                tea.adjustment_bps, tea.reason, tea.effective_from, tea.effective_until,
                tea.created_at
           FROM technician_earning_adjustments tea
           JOIN technician_profiles tp ON tp.id = tea.technician_id
           JOIN users u ON u.id = tp.user_id
           LEFT JOIN services s ON s.id = tea.service_id
          WHERE tea.disabled_at IS NULL
          ORDER BY tea.created_at DESC`,
      ),
      this.dataSource.query(
        `SELECT al.action, al.entity_type, al.entity_id, al.old_values, al.new_values,
                al.created_at, u.full_name AS actor_name
           FROM audit_logs al
           LEFT JOIN users u ON u.id = al.actor_user_id
          WHERE al.action LIKE 'earnings_policy.%'
          ORDER BY al.created_at DESC
          LIMIT 30`,
      ),
    ]);
    const activeServices = services.filter((service: { is_active: boolean }) => service.is_active);
    return {
      readiness: {
        ready: true,
        configured_active_services: activeServices.length,
        active_services: activeServices.length,
        missing_services: [],
      },
      levels,
      skills,
      services,
      service_level_overrides: serviceLevelOverrides,
      service_skill_overrides: serviceSkillOverrides,
      technicians,
      technician_adjustments: adjustments,
      audit_history: auditHistory,
    };
  }

  async updateServiceCommission(
    adminUserId: string,
    serviceId: string,
    dto: UpdatePlatformCommissionDto,
    meta?: AuditActorMeta,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `UPDATE services SET commission_percentage = $2::numeric / 100, updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING id, name_ar, ROUND(commission_percentage * 100)::integer AS platform_commission_bps`,
        [serviceId, dto.platform_commission_bps],
      );
      if (!rows[0]) throw new ApiException(ErrorCode.VAL_001, 'الخدمة غير موجودة', HttpStatus.NOT_FOUND);
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'earnings_policy.service_commission_updated',
          entityType: 'service',
          entityId: serviceId,
          newValues: { platform_commission_bps: dto.platform_commission_bps, reason: dto.reason },
          meta,
        },
        manager,
      );
      return rows[0];
    });
  }

  async updateLevel(
    adminUserId: string,
    level: string,
    dto: UpdateEarningsLevelPolicyDto,
    meta?: AuditActorMeta,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const previous = await manager.query(
        `SELECT id, earning_weight_bps, assistant_ratio_bps FROM technician_level_config WHERE level = $1`,
        [level],
      );
      if (!previous[0]) throw new ApiException(ErrorCode.VAL_001, 'المستوى غير موجود', HttpStatus.NOT_FOUND);
      const [updated] = await manager.query(
        `UPDATE technician_level_config
            SET earning_weight_bps = $2, assistant_ratio_bps = $3, updated_at = now()
          WHERE level = $1
          RETURNING id, level, display_name_ar, earning_weight_bps, assistant_ratio_bps`,
        [level, dto.earning_weight_bps, dto.assistant_ratio_bps],
      );
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'earnings_policy.level_updated',
          entityType: 'technician_level_config',
          entityId: updated.id,
          oldValues: previous[0],
          newValues: { ...updated, reason: dto.reason },
          meta,
        },
        manager,
      );
      return updated;
    });
  }

  async updateSkill(
    adminUserId: string,
    skillLevel: string,
    dto: UpdateEarningsSkillPolicyDto,
    meta?: AuditActorMeta,
  ) {
    const allowed = new Set(['beginner', 'standard', 'expert']);
    if (!allowed.has(skillLevel)) {
      throw new ApiException(ErrorCode.VAL_001, 'مستوى المهارة غير صحيح', HttpStatus.BAD_REQUEST);
    }
    // `returningFirst` مش `const [updated] =`: TypeORM بترجّع `UPDATE … RETURNING` كـ
    // `[rows, affectedCount]`، فالتفكيك المباشر كان بيحط **مصفوفة الصفوف** في `updated`
    // فيتكتب صف تدقيق مشوّه (`newValues: { "0": {...} }`) بدل قيم السياسة الجديدة.
    const updated = returningFirst<Record<string, unknown>>(await this.dataSource.query(
      `UPDATE earnings_skill_policy
          SET factor_bps = $2, updated_by_user_id = $3, updated_at = now()
        WHERE skill_level = $1
        RETURNING skill_level, factor_bps, updated_at`,
      [skillLevel, dto.factor_bps, adminUserId],
    ));
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'earnings_policy.skill_updated',
      entityType: 'earnings_skill_policy',
      entityId: adminUserId,
      newValues: { ...updated, reason: dto.reason },
      meta,
    });
    return updated;
  }

  simulate(dto: SimulateEarningsDto) {
    return calculateEarningsV2(
      dto.order_total_cents,
      Math.round((dto.order_total_cents * dto.platform_commission_bps) / 10_000),
      dto.participants.map((participant) => ({
        technicianId: participant.technician_id,
        earningRole: participant.earning_role,
        isLeader: participant.is_leader,
        technicianKindSnapshot: participant.technician_kind,
        technicianLevel: participant.technician_level,
        levelWeightBps: participant.level_weight_bps,
        assistantRatioBps: participant.assistant_ratio_bps,
        serviceSkill: participant.service_skill,
        serviceSkillFactorBps: participant.service_skill_factor_bps,
        individualAdjustmentBps: participant.individual_adjustment_bps ?? 0,
        orderAdjustmentBps: participant.order_adjustment_bps ?? 0,
      })),
    );
  }

  async createTechnicianAdjustment(
    adminUserId: string,
    technicianId: string,
    dto: CreateTechnicianEarningAdjustmentDto,
    meta?: AuditActorMeta,
  ) {
    return this.dataSource.transaction(async (manager) => {
      // One administrator may replace an adjustment at a time for this exact scope.
      // Without this transaction-scoped lock, two near-simultaneous saves could each
      // observe no active row and create competing earnings policies.
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `earnings-adjustment:${technicianId}:${dto.service_id ?? 'all-services'}`,
      ]);

      const technician = await manager.query(
        `SELECT id FROM technician_profiles WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [technicianId],
      );
      if (!technician[0]) {
        throw new ApiException(ErrorCode.VAL_001, 'الفني أو المساعد غير موجود', HttpStatus.NOT_FOUND);
      }

      if (dto.service_id) {
        const service = await manager.query(
          `SELECT id FROM services WHERE id = $1 AND deleted_at IS NULL`,
          [dto.service_id],
        );
        if (!service[0]) {
          throw new ApiException(ErrorCode.VAL_001, 'الخدمة المحددة غير موجودة', HttpStatus.NOT_FOUND);
        }
      }

      const existing = await manager.query(
        `SELECT id FROM technician_earning_adjustments
          WHERE technician_id = $1 AND service_id IS NOT DISTINCT FROM $2 AND disabled_at IS NULL`,
        [technicianId, dto.service_id ?? null],
      );
      for (const row of existing) {
        await manager.query(`UPDATE technician_earning_adjustments SET disabled_at = now() WHERE id = $1`, [row.id]);
      }
      const [created] = await manager.query(
        `INSERT INTO technician_earning_adjustments
          (technician_id, service_id, adjustment_bps, reason, effective_from, effective_until,
           created_by_user_id, updated_by_user_id)
         VALUES ($1,$2,$3,$4,COALESCE($5::timestamptz, now()),$6::timestamptz,$7,$7)
         RETURNING *`,
        [
          technicianId,
          dto.service_id ?? null,
          dto.adjustment_bps,
          dto.reason,
          dto.effective_from ?? null,
          dto.effective_until ?? null,
          adminUserId,
        ],
      );
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'earnings_policy.technician_adjustment_created',
          entityType: 'technician_earning_adjustment',
          entityId: created.id,
          newValues: created,
          meta,
        },
        manager,
      );
      return created;
    });
  }

  async upsertServiceLevelOverride(
    adminUserId: string,
    serviceId: string,
    level: string,
    dto: UpdateServiceLevelEarningsOverrideDto,
    meta?: AuditActorMeta,
  ) {
    if (!new Set(['new', 'verified', 'professional', 'premium', 'team_leader']).has(level)) {
      throw new ApiException(ErrorCode.VAL_001, 'المستوى غير صحيح', HttpStatus.BAD_REQUEST);
    }
    return this.dataSource.transaction(async (manager) => {
      const [row] = await manager.query(
        `INSERT INTO service_earnings_level_overrides
          (service_id, technician_level, assistant_ratio_bps, updated_by_user_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (service_id, technician_level) DO UPDATE
           SET assistant_ratio_bps = EXCLUDED.assistant_ratio_bps,
               updated_by_user_id = EXCLUDED.updated_by_user_id,
               updated_at = now()
         RETURNING *`,
        [serviceId, level, dto.assistant_ratio_bps, adminUserId],
      );
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'earnings_policy.service_level_override_upserted',
          entityType: 'service_earnings_level_override',
          entityId: row.id,
          newValues: { ...row, reason: dto.reason },
          meta,
        },
        manager,
      );
      return row;
    });
  }

  async upsertServiceSkillOverride(
    adminUserId: string,
    serviceId: string,
    skill: string,
    dto: UpdateServiceSkillEarningsOverrideDto,
    meta?: AuditActorMeta,
  ) {
    if (!new Set(['beginner', 'standard', 'expert']).has(skill)) {
      throw new ApiException(ErrorCode.VAL_001, 'مستوى المهارة غير صحيح', HttpStatus.BAD_REQUEST);
    }
    return this.dataSource.transaction(async (manager) => {
      const [row] = await manager.query(
        `INSERT INTO service_earnings_skill_overrides
          (service_id, skill_level, factor_bps, updated_by_user_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (service_id, skill_level) DO UPDATE
           SET factor_bps = EXCLUDED.factor_bps,
               updated_by_user_id = EXCLUDED.updated_by_user_id,
               updated_at = now()
         RETURNING *`,
        [serviceId, skill, dto.factor_bps, adminUserId],
      );
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'earnings_policy.service_skill_override_upserted',
          entityType: 'service_earnings_skill_override',
          entityId: row.id,
          newValues: { ...row, reason: dto.reason },
          meta,
        },
        manager,
      );
      return row;
    });
  }

  async resetServiceOverride(
    adminUserId: string,
    table: 'service_earnings_level_overrides' | 'service_earnings_skill_overrides',
    serviceId: string,
    policyKey: string,
    reason: string,
    meta?: AuditActorMeta,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const keyColumn = table === 'service_earnings_level_overrides' ? 'technician_level' : 'skill_level';
      // نفس السبب فوق: `const [deleted] =` كان بياخد **مصفوفة** الصفوف، ومصفوفة فاضية قيمتها
      // truthy — يعني حارس «لا يوجد استثناء لإزالته» **ماكانش بيشتغل أبدًا**، وحذف استثناء
      // مش موجود كان بيرجّع نجاح ويكتب صف تدقيق بـ`entityId: undefined`.
      const deleted = returningFirst<Record<string, unknown> & { id: string }>(await manager.query(
        `DELETE FROM ${table} WHERE service_id = $1 AND ${keyColumn} = $2 RETURNING *`,
        [serviceId, policyKey],
      ));
      if (!deleted) throw new ApiException(ErrorCode.VAL_001, 'لا يوجد استثناء لإزالته', HttpStatus.NOT_FOUND);
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'earnings_policy.service_override_reset',
          entityType: table,
          entityId: deleted.id,
          oldValues: deleted,
          newValues: { reset_to_global: true, reason },
          meta,
        },
        manager,
      );
      return { reset_to_global: true };
    });
  }
}
