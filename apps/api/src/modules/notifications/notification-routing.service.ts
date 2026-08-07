import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { CreateRoutingRuleDto } from './dto/create-routing-rule.dto';
import { UpdateRoutingRuleDto } from './dto/update-routing-rule.dto';
import { NotificationRoutingRule } from './entities/notification-routing-rule.entity';
import { NotificationsService } from './notifications.service';

export interface RouteToRolePayload {
  notificationType: string;
  titleAr: string;
  bodyAr: string;
  referenceType?: string;
  referenceId?: string;
  deepLink?: string;
}

@Injectable()
export class NotificationRoutingService {
  private readonly logger = new Logger(NotificationRoutingService.name);

  constructor(
    @InjectRepository(NotificationRoutingRule) private readonly rules: Repository<NotificationRoutingRule>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(): Promise<NotificationRoutingRule[]> {
    return this.rules.find({ order: { eventType: 'ASC', roleName: 'ASC' } });
  }

  private async assertRoleExists(roleName: string): Promise<void> {
    const [{ exists }] = await this.dataSource.query<{ exists: boolean }[]>(
      `SELECT EXISTS(SELECT 1 FROM roles WHERE name = $1 AND deleted_at IS NULL) AS exists`,
      [roleName],
    );
    if (!exists) {
      throw new ApiException(ErrorCode.VAL_001, 'الدور غير موجود', HttpStatus.NOT_FOUND);
    }
  }

  async create(adminUserId: string, dto: CreateRoutingRuleDto, meta?: AuditActorMeta): Promise<NotificationRoutingRule> {
    await this.assertRoleExists(dto.role_name);
    const existing = await this.rules.findOne({ where: { eventType: dto.event_type, roleName: dto.role_name } });
    if (existing) {
      throw new ApiException(ErrorCode.VAL_001, 'القاعدة دي موجودة بالفعل — عدّلها بدل ما تنشئ واحدة تانية', HttpStatus.CONFLICT);
    }

    const rule = this.rules.create({
      eventType: dto.event_type,
      roleName: dto.role_name,
      channels: dto.channels,
      isActive: true,
    });
    await this.rules.save(rule);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'notification_routing_rule.created',
      entityType: 'notification_routing_rule',
      entityId: rule.id,
      newValues: { event_type: rule.eventType, role_name: rule.roleName, channels: rule.channels },
      meta,
    });
    return rule;
  }

  private async findOrThrow(id: string): Promise<NotificationRoutingRule> {
    const rule = await this.rules.findOne({ where: { id } });
    if (!rule) {
      throw new ApiException(ErrorCode.VAL_001, 'قاعدة التوجيه غير موجودة', HttpStatus.NOT_FOUND);
    }
    return rule;
  }

  async update(adminUserId: string, id: string, dto: UpdateRoutingRuleDto, meta?: AuditActorMeta): Promise<NotificationRoutingRule> {
    const rule = await this.findOrThrow(id);
    const oldValues = { channels: rule.channels, is_active: rule.isActive };

    if (dto.channels !== undefined) rule.channels = dto.channels;
    if (dto.is_active !== undefined) rule.isActive = dto.is_active;
    await this.rules.save(rule);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'notification_routing_rule.updated',
      entityType: 'notification_routing_rule',
      entityId: rule.id,
      oldValues,
      newValues: { channels: rule.channels, is_active: rule.isActive },
      meta,
    });
    return rule;
  }

  async delete(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const rule = await this.findOrThrow(id);
    await this.rules.delete(id);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'notification_routing_rule.deleted',
      entityType: 'notification_routing_rule',
      entityId: rule.id,
      oldValues: { event_type: rule.eventType, role_name: rule.roleName },
      meta,
    });
  }

  /**
   * المصدر الحقيقي الوحيد لـ"مين يوصله إيه" — بيتفحص وقت كل حدث، مش بيتخزن كـ subscription
   * ثابتة، فتغيير القاعدة عبر الـ API بيأثّر فوراً على الحدث الجاي من غير أي restart.
   * مبيرميش أبداً — فشل التوجيه مايكسرش العملية الحقيقية اللي ولّدت الحدث.
   */
  async routeToRole(eventType: string, payload: RouteToRolePayload): Promise<void> {
    try {
      const activeRules = await this.rules.find({ where: { eventType, isActive: true } });
      if (activeRules.length === 0) return;

      for (const rule of activeRules) {
        const users = await this.dataSource.query<{ user_id: string }[]>(
          `SELECT DISTINCT u.id AS user_id
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id AND r.name = $1 AND r.deleted_at IS NULL
           JOIN users u ON u.id = ur.user_id AND u.is_blocked = false AND u.deleted_at IS NULL`,
          [rule.roleName],
        );

        for (const { user_id } of users) {
          await this.notificationsService.notifyMultiChannel(
            {
              userId: user_id,
              notificationType: payload.notificationType,
              titleAr: payload.titleAr,
              bodyAr: payload.bodyAr,
              referenceType: payload.referenceType,
              referenceId: payload.referenceId,
              deepLink: payload.deepLink,
            },
            rule.channels,
          );
        }
      }
    } catch (err) {
      this.logger.error(`فشل توجيه إشعار الحدث ${eventType}`, err instanceof Error ? err.stack : err);
    }
  }
}
