import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  PREFERRED_CREW_INVITED_EVENT,
  PREFERRED_CREW_ACCEPTED_EVENT,
  PreferredCrewInvitedEvent,
  PreferredCrewAcceptedEvent,
} from '../../../common/events/preferred-crew.event';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationsService } from '../notifications.service';

/**
 * الفريق المفضّل (docs/08 §36.19، ADR-0022) — نفس فلسفة WorkOpportunityOfferedNotificationListener
 * بالحرف: PreferredCrewService (موديول technicians) بيصدّر الحدث بس، الموديول ده مسؤول عن
 * القناة/النص. IN_APP بس (مش عاجل زي فرصة تجنيد لطلب حقيقي — دعوة/قبول شبكة دائمة).
 */
@Injectable()
export class PreferredCrewNotificationListener {
  private readonly logger = new Logger(PreferredCrewNotificationListener.name);

  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(PREFERRED_CREW_INVITED_EVENT)
  async handleInvited(event: PreferredCrewInvitedEvent): Promise<void> {
    try {
      const [owner, member] = await Promise.all([
        this.techniciansService.findByProfileIdOrThrow(event.ownerTechnicianId),
        this.techniciansService.findByProfileIdOrThrow(event.memberTechnicianId),
      ]);
      await this.notificationsService.notify({
        userId: member.userId,
        notificationType: 'preferred_crew_invited',
        titleAr: 'دعوة انضمام لفريق مفضّل',
        bodyAr: `الفني ${owner.technicianCode} دعاك تنضم لفريقه المفضّل — راجع بروفايلك للرد.`,
        referenceType: 'technician_preferred_crew_member',
        referenceId: event.membershipId,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار دعوة فريق مفضّل ${event.membershipId}`, err instanceof Error ? err.stack : err);
    }
  }

  @OnEvent(PREFERRED_CREW_ACCEPTED_EVENT)
  async handleAccepted(event: PreferredCrewAcceptedEvent): Promise<void> {
    try {
      const [owner, member] = await Promise.all([
        this.techniciansService.findByProfileIdOrThrow(event.ownerTechnicianId),
        this.techniciansService.findByProfileIdOrThrow(event.memberTechnicianId),
      ]);
      await this.notificationsService.notify({
        userId: owner.userId,
        notificationType: 'preferred_crew_accepted',
        titleAr: 'قبول دعوة الفريق المفضّل',
        bodyAr: `الفني ${member.technicianCode} قبل دعوتك للانضمام لفريقك المفضّل.`,
        referenceType: 'technician_preferred_crew_member',
        referenceId: event.membershipId,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار قبول فريق مفضّل ${event.membershipId}`, err instanceof Error ? err.stack : err);
    }
  }
}
