import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { NotificationChannel } from './entities/notification.entity';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { UpdateNotificationTypeConfigDto } from './dto/update-notification-type-config.dto';
import { NotificationTypeConfig } from './entities/notification-type-config.entity';

// إدارة الأولوية/الصوت/القناة/actionable لكل notification_type — كان دلوقتي عبر psql/migration
// بس (ADR-0012)، ده أول endpoint حقيقي يقرا/يعدّل الجدول ده. مفيش create/delete عمداً — صف
// notification_type_configs بيتولّد لما نوع إشعار جديد يتضاف في الكود نفسه (migration seed)،
// مش حاجة الأدمن يخترعها بنفسه من غير أي كود بيصدرها.
@Injectable()
export class NotificationTypeConfigService {
  constructor(
    @InjectRepository(NotificationTypeConfig) private readonly configs: Repository<NotificationTypeConfig>,
    private readonly auditLog: AuditLogService,
  ) {}

  list(): Promise<NotificationTypeConfig[]> {
    return this.configs.find({ order: { notificationType: 'ASC' } });
  }

  private async findOrThrow(notificationType: string): Promise<NotificationTypeConfig> {
    const config = await this.configs.findOne({ where: { notificationType } });
    if (!config) {
      throw new ApiException(ErrorCode.VAL_001, 'نوع الإشعار ده غير موجود', HttpStatus.NOT_FOUND);
    }
    return config;
  }

  /**
   * **`in_app` مش قناة اختيارية — هي السجل نفسه.**
   *
   * شاشة `/admin/notification-types` بتخلّي الأدمن يختار القنوات، وكان ينفع يشيل `in_app`
   * ويسيب `push` بس. النتيجة إن الإشعار مابيتسجّلش جوّه التطبيق خالص: الصندوق بيفضل فاضي
   * حتى لو الحدث حصل فعلاً، ولو الـpush فشل (بيئة بلا مزوّد، جهاز بلا توكن، المستخدم قافل
   * الإشعارات) الحدث بيختفي من الوجود.
   *
   * ده مكانش احتمال نظري: ٣٦ نوع من ٣٧ على قاعدة التطوير كانوا كده بالظبط.
   *
   * فالحفظ بيرجّع `in_app` تلقائيًا بدل ما يرفض — الأدمن قصده يضيف/يشيل **توصيل**، ورفض
   * الحفظ كان هيبقى عائق بلا فايدة.
   */
  static normalizeChannels(channels: NotificationChannel[]): NotificationChannel[] {
    return Array.from(new Set([...channels, NotificationChannel.IN_APP])).sort();
  }

  async update(
    adminUserId: string,
    notificationType: string,
    dto: UpdateNotificationTypeConfigDto,
    meta?: AuditActorMeta,
  ): Promise<NotificationTypeConfig> {
    const config = await this.findOrThrow(notificationType);
    const oldValues = {
      priority_tier: config.priorityTier,
      default_channels: config.defaultChannels,
      sound_key: config.soundKey,
      is_actionable: config.isActionable,
      action_labels: config.actionLabels,
      requires_acknowledgment: config.requiresAcknowledgment,
    };

    if (dto.priority_tier !== undefined) config.priorityTier = dto.priority_tier;
    if (dto.default_channels !== undefined) {
      config.defaultChannels = NotificationTypeConfigService.normalizeChannels(dto.default_channels);
    }
    if (dto.sound_key !== undefined) config.soundKey = dto.sound_key;
    if (dto.is_actionable !== undefined) config.isActionable = dto.is_actionable;
    if (dto.action_labels !== undefined) config.actionLabels = dto.action_labels;
    if (dto.requires_acknowledgment !== undefined) config.requiresAcknowledgment = dto.requires_acknowledgment;
    await this.configs.save(config);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'notification_type_config.updated',
      entityType: 'notification_type_config',
      entityId: config.id,
      oldValues,
      newValues: {
        priority_tier: config.priorityTier,
        default_channels: config.defaultChannels,
        sound_key: config.soundKey,
        is_actionable: config.isActionable,
        action_labels: config.actionLabels,
        requires_acknowledgment: config.requiresAcknowledgment,
      },
      meta,
    });
    return config;
  }
}
