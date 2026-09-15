import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  WARRANTY_CLAIM_CHANGED_EVENT,
  WarrantyClaimChangedEvent,
} from '../../../common/events/warranty-claim-changed.event';
import { WarrantyClaim } from '../../projects/entities/warranty-entities';
import { NotificationRoutingService } from '../notification-routing.service';

/** مطالبة الضمان المفتوحة تحتاج مراجعة الإدارة؛ إشعار العميل لتغيرات الحالة موجود في listener منفصل. */
@Injectable()
export class WarrantyClaimOpenedRoutingListener {
  private readonly logger = new Logger(WarrantyClaimOpenedRoutingListener.name);

  constructor(
    @InjectRepository(WarrantyClaim) private readonly claims: Repository<WarrantyClaim>,
    private readonly routingService: NotificationRoutingService,
  ) {}

  @OnEvent(WARRANTY_CLAIM_CHANGED_EVENT)
  async handle(event: WarrantyClaimChangedEvent): Promise<void> {
    if (event.action !== 'opened') return;

    try {
      const claim = await this.claims.findOne({ where: { id: event.claimId } });
      if (!claim) return;
      const preview = claim.defectDescription.replace(/\s+/g, ' ').trim().slice(0, 140);

      await this.routingService.routeToRole('warranty_claim.opened', {
        notificationType: 'warranty_claim_opened',
        titleAr: 'مطالبة ضمان جديدة تحتاج مراجعة',
        bodyAr: preview || 'العميل فتح مطالبة ضمان جديدة.',
        referenceType: 'warranty_claim',
        referenceId: claim.id,
        deepLink: '/warranty-claims',
      });
    } catch (err) {
      this.logger.error(`فشل توجيه إشعار مطالبة الضمان ${event.claimId}`, err instanceof Error ? err.stack : err);
    }
  }
}
