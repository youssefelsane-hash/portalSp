import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { NotificationCampaign } from './entities/notification-campaign.entity';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';
import { KNOWN_TEMPLATE_VARIABLES, renderCampaignTemplate, unknownTemplateVariables } from './campaign-template.util';

export interface CampaignWithStats {
  campaign: NotificationCampaign;
  /** إرسالات آخر 30 يوم — الرقم اللي بيقول للأدمن الحملة دي شغالة فعلاً ولا نايمة. */
  sends30d: number;
  lastSentAt: Date | null;
  /** معاينة النص بأسماء وهمية — الأدمن يشوف الشكل النهائي قبل ما يفعّل. */
  previewTitle: string;
  previewBody: string;
  /** متغيّرات مكتوبة غلط — تحذير، مش رفض. */
  unknownVariables: string[];
}

const PREVIEW_VARIABLES = {
  service_name: 'تسليك مواسير',
  category_name: 'سباكة',
  customer_name: 'أحمد',
};

/** إدارة الحملات من لوحة الأدمن (ADR-0046 §2) — «الأدمن يبقى عنده access يقول إيه اللي يظهر». */
@Injectable()
export class AdminCampaignsService {
  constructor(
    @InjectRepository(NotificationCampaign) private readonly campaigns: Repository<NotificationCampaign>,
    private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(): Promise<CampaignWithStats[]> {
    const rows = await this.campaigns.find({ where: { deletedAt: IsNull() }, order: { priority: 'DESC' } });
    if (rows.length === 0) return [];

    // استعلام تجميع واحد لكل الحملات — مش استعلام لكل صف (N+1).
    const stats = await this.dataSource.query<{ campaign_id: string; sends_30d: string; last_sent_at: Date | null }[]>(
      `SELECT campaign_id,
              COUNT(*) FILTER (WHERE sent_at >= now() - interval '30 days') AS sends_30d,
              MAX(sent_at) AS last_sent_at
         FROM notification_campaign_sends
        WHERE campaign_id = ANY($1::uuid[])
        GROUP BY campaign_id`,
      [rows.map((r) => r.id)],
    );
    const statsById = new Map(stats.map((s) => [s.campaign_id, s]));

    return rows.map((campaign) => {
      const stat = statsById.get(campaign.id);
      return {
        campaign,
        sends30d: stat ? Number(stat.sends_30d) : 0,
        lastSentAt: stat?.last_sent_at ?? null,
        previewTitle: renderCampaignTemplate(campaign.titleTemplateAr, PREVIEW_VARIABLES),
        previewBody: renderCampaignTemplate(campaign.bodyTemplateAr, PREVIEW_VARIABLES),
        unknownVariables: [
          ...unknownTemplateVariables(campaign.titleTemplateAr),
          ...unknownTemplateVariables(campaign.bodyTemplateAr),
        ],
      };
    });
  }

  /** المتغيّرات المتاحة — الواجهة بتعرضها للأدمن وهو بيكتب القالب. */
  availableVariables(): readonly string[] {
    return KNOWN_TEMPLATE_VARIABLES;
  }

  async create(adminUserId: string, dto: CreateCampaignDto, meta?: AuditActorMeta): Promise<NotificationCampaign> {
    this.assertTriggerDelayMatchesType(dto.campaign_type, dto.trigger_delay_minutes);

    const campaign = this.campaigns.create({
      campaignType: dto.campaign_type,
      name: dto.name,
      titleTemplateAr: dto.title_template_ar,
      bodyTemplateAr: dto.body_template_ar,
      isActive: dto.is_active ?? true,
      cooldownDays: dto.cooldown_days ?? 4,
      priority: dto.priority ?? 100,
      triggerDelayMinutes: dto.trigger_delay_minutes ?? null,
      categoryId: dto.category_id ?? null,
    });
    await this.campaigns.save(campaign);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'campaign.created',
      entityType: 'notification_campaign',
      entityId: campaign.id,
      newValues: { name: campaign.name, campaign_type: campaign.campaignType, is_active: campaign.isActive },
      meta,
    });
    return campaign;
  }

  async update(adminUserId: string, id: string, dto: UpdateCampaignDto, meta?: AuditActorMeta): Promise<NotificationCampaign> {
    const campaign = await this.findOrThrow(id);
    const before = {
      name: campaign.name,
      is_active: campaign.isActive,
      priority: campaign.priority,
      cooldown_days: campaign.cooldownDays,
    };

    if (dto.trigger_delay_minutes !== undefined) {
      this.assertTriggerDelayMatchesType(campaign.campaignType, dto.trigger_delay_minutes);
      campaign.triggerDelayMinutes = dto.trigger_delay_minutes;
    }
    if (dto.name !== undefined) campaign.name = dto.name;
    if (dto.title_template_ar !== undefined) campaign.titleTemplateAr = dto.title_template_ar;
    if (dto.body_template_ar !== undefined) campaign.bodyTemplateAr = dto.body_template_ar;
    if (dto.is_active !== undefined) campaign.isActive = dto.is_active;
    if (dto.cooldown_days !== undefined) campaign.cooldownDays = dto.cooldown_days;
    if (dto.priority !== undefined) campaign.priority = dto.priority;

    await this.campaigns.save(campaign);
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'campaign.updated',
      entityType: 'notification_campaign',
      entityId: campaign.id,
      oldValues: before,
      newValues: {
        name: campaign.name,
        is_active: campaign.isActive,
        priority: campaign.priority,
        cooldown_days: campaign.cooldownDays,
      },
      meta,
    });
    return campaign;
  }

  /**
   * حذف ناعم — سجل الإرسال بيفضل مربوط بالحملة عشان التحليل التاريخي يفضل مفهوم. حذف صلب كان
   * هيكسر المفتاح الأجنبي أو يمسح تاريخ إرسال حقيقي.
   */
  async remove(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const campaign = await this.findOrThrow(id);
    await this.campaigns.softRemove(campaign);
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'campaign.deleted',
      entityType: 'notification_campaign',
      entityId: campaign.id,
      oldValues: { name: campaign.name },
      meta,
    });
  }

  private async findOrThrow(id: string): Promise<NotificationCampaign> {
    const campaign = await this.campaigns.findOne({ where: { id, deletedAt: IsNull() } });
    if (!campaign) throw new ApiException(ErrorCode.VAL_001, 'الحملة غير موجودة', HttpStatus.NOT_FOUND);
    return campaign;
  }

  /**
   * `trigger_delay_minutes` معناه «بعد كام دقيقة من الزناد» — والزناد ده موجود لـ
   * `abandoned_intent` بس. تحديده على حملة دورية بيبان كإعداد شغال وهو متجاهل تمامًا.
   */
  private assertTriggerDelayMatchesType(type: string, delay: number | undefined): void {
    if (delay !== undefined && type !== 'abandoned_intent') {
      throw new ApiException(
        ErrorCode.VAL_001,
        'مهلة الزناد بتتحدد لحملات استرجاع الاهتمام المتروك بس — الحملات الدورية بتتحكم بفاصل الأيام',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
