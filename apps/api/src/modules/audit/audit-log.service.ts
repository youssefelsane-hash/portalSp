import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, FindOptionsWhere, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

export interface AuditActorMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface RecordAuditLogParams {
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  meta?: AuditActorMeta;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(@InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>) {}

  /**
   * Calls that pass a transaction manager make the audit row part of the business transaction.
   * Those failures must propagate so a sensitive operation can never commit without its audit.
   * Legacy/non-sensitive standalone callers retain best-effort logging behavior.
   */
  async record(params: RecordAuditLogParams, manager?: EntityManager): Promise<void> {
    try {
      const repository = manager ? manager.getRepository(AuditLog) : this.auditLogs;
      const entry = repository.create({
        actorUserId: params.actorUserId,
        actorRole: params.actorRole,
        actorIp: params.meta?.ip ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        oldValues: params.oldValues ?? null,
        newValues: params.newValues ?? null,
        userAgent: params.meta?.userAgent ?? null,
        requestId: params.meta?.requestId ?? null,
      });
      await repository.save(entry);
    } catch (err) {
      if (manager) throw err;
      this.logger.error(
        `فشل تسجيل audit log للعملية ${params.action} على ${params.entityType}:${params.entityId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  async list(query: ListAuditLogsQueryDto): Promise<{ items: AuditLog[]; meta: { page: number; per_page: number; total: number } }> {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 20;
    const where: FindOptionsWhere<AuditLog> = {};
    if (query.entity_type) where.entityType = query.entity_type;
    if (query.entity_id) where.entityId = query.entity_id;
    if (query.actor_user_id) where.actorUserId = query.actor_user_id;
    if (query.action) where.action = query.action;
    if (query.from && query.to) {
      where.createdAt = Between(new Date(query.from), new Date(query.to));
    } else if (query.from) {
      where.createdAt = MoreThanOrEqual(new Date(query.from));
    } else if (query.to) {
      where.createdAt = LessThanOrEqual(new Date(query.to));
    }

    const [items, total] = await this.auditLogs.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });
    return { items, meta: { page, per_page: perPage, total } };
  }
}
