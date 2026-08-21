import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { SettingsService } from '../settings/settings.service';
import {
  PREFERRED_CREW_INVITED_EVENT,
  PREFERRED_CREW_ACCEPTED_EVENT,
  PreferredCrewInvitedEvent,
  PreferredCrewAcceptedEvent,
} from '../../common/events/preferred-crew.event';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { PreferredCrewMemberStatus, TechnicianPreferredCrewMember } from './entities/technician-preferred-crew-member.entity';

const MAX_SIZE_FALLBACK = 10;

export interface PreferredCrewRow {
  id: string;
  technicianId: string;
  technicianCode: string;
  fullName: string;
  status: PreferredCrewMemberStatus;
  invitedAt: Date;
  respondedAt: Date | null;
}

/**
 * الفريق المفضّل (docs/08 §36.16، ADR-0022) — شبكة تفضيل نظير-لنظير دائمة. اتجاه واحد بس
 * (owner→member)، صفر موافقة أدمن (العلاقة تفضيل شخصي بحت، مش توظيف). منفصلة تمامًا عن
 * OrderTeamService (طاقم مؤقت لطلب واحد)، TechnicianCompany (توظيف رسمي)، وrequestAssistant()
 * (علاقة غير متماثلة واحد-لواحد محتاجة موافقة أدمن) في TechniciansService.
 */
@Injectable()
export class PreferredCrewService {
  constructor(
    @InjectRepository(TechnicianPreferredCrewMember) private readonly members: Repository<TechnicianPreferredCrewMember>,
    @InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>,
    private readonly settingsService: SettingsService,
    private readonly events: EventEmitter2,
  ) {}

  private async findProfileByUserIdOrThrow(userId: string): Promise<TechnicianProfile> {
    const profile = await this.technicianProfiles.findOne({ where: { userId } });
    if (!profile) {
      throw new ApiException(ErrorCode.TECH_001, 'حسابك غير معتمد بعد', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  /** قايمة الفريق المفضّل بتاع الفني (بصفته owner) — invited/accepted بس (removed/declined مش لازمة تظهر). */
  async listMine(userId: string): Promise<PreferredCrewRow[]> {
    const owner = await this.findProfileByUserIdOrThrow(userId);
    const rows = await this.members.manager.query<
      { id: string; technician_id: string; technician_code: string; full_name: string; status: PreferredCrewMemberStatus; invited_at: Date; responded_at: Date | null }[]
    >(
      `SELECT pcm.id, tp.id AS technician_id, tp.technician_code, u.full_name, pcm.status, pcm.invited_at, pcm.responded_at
       FROM technician_preferred_crew_members pcm
       JOIN technician_profiles tp ON tp.id = pcm.member_technician_id
       JOIN users u ON u.id = tp.user_id
       WHERE pcm.owner_technician_id = $1 AND pcm.deleted_at IS NULL AND pcm.status IN ('invited','accepted')
       ORDER BY pcm.invited_at DESC`,
      [owner.id],
    );
    return rows.map((r) => ({
      id: r.id,
      technicianId: r.technician_id,
      technicianCode: r.technician_code,
      fullName: r.full_name,
      status: r.status,
      invitedAt: r.invited_at,
      respondedAt: r.responded_at,
    }));
  }

  /** دعوات وصلت للفني (بصفته member) لسه معلّقة (invited). */
  async listInvitationsReceived(userId: string): Promise<PreferredCrewRow[]> {
    const member = await this.findProfileByUserIdOrThrow(userId);
    const rows = await this.members.manager.query<
      { id: string; technician_id: string; technician_code: string; full_name: string; status: PreferredCrewMemberStatus; invited_at: Date; responded_at: Date | null }[]
    >(
      `SELECT pcm.id, tp.id AS technician_id, tp.technician_code, u.full_name, pcm.status, pcm.invited_at, pcm.responded_at
       FROM technician_preferred_crew_members pcm
       JOIN technician_profiles tp ON tp.id = pcm.owner_technician_id
       JOIN users u ON u.id = tp.user_id
       WHERE pcm.member_technician_id = $1 AND pcm.deleted_at IS NULL AND pcm.status = 'invited'
       ORDER BY pcm.invited_at DESC`,
      [member.id],
    );
    return rows.map((r) => ({
      id: r.id,
      technicianId: r.technician_id,
      technicianCode: r.technician_code,
      fullName: r.full_name,
      status: r.status,
      invitedAt: r.invited_at,
      respondedAt: r.responded_at,
    }));
  }

  /**
   * فرق مفضّلة أنا عضو مقبول فيها (بصفتي member) — منفصلة عمدًا عن listInvitationsReceived()
   * (بترجّع status='invited' بس، تختفي منها بمجرد القبول). بَقّة حقيقية اتلقطت وقت بناء UI
   * التطبيق (§36.18): بلا الدالة دي، leave() كانت موجودة بالباك-إند بلا أي مسار يوصّل الفني
   * لعضويته الفعلية عشان يقدر يستخدمها أصلاً.
   */
  async listMyMemberships(userId: string): Promise<PreferredCrewRow[]> {
    const member = await this.findProfileByUserIdOrThrow(userId);
    const rows = await this.members.manager.query<
      { id: string; technician_id: string; technician_code: string; full_name: string; status: PreferredCrewMemberStatus; invited_at: Date; responded_at: Date | null }[]
    >(
      `SELECT pcm.id, tp.id AS technician_id, tp.technician_code, u.full_name, pcm.status, pcm.invited_at, pcm.responded_at
       FROM technician_preferred_crew_members pcm
       JOIN technician_profiles tp ON tp.id = pcm.owner_technician_id
       JOIN users u ON u.id = tp.user_id
       WHERE pcm.member_technician_id = $1 AND pcm.deleted_at IS NULL AND pcm.status = 'accepted'
       ORDER BY pcm.responded_at DESC`,
      [member.id],
    );
    return rows.map((r) => ({
      id: r.id,
      technicianId: r.technician_id,
      technicianCode: r.technician_code,
      fullName: r.full_name,
      status: r.status,
      invitedAt: r.invited_at,
      respondedAt: r.responded_at,
    }));
  }

  /** دعوة زميل بكود موظفه — نفس نمط requestAssistant() بالحرف (البحث بـtechnician_code). */
  async invite(userId: string, memberTechnicianCode: string): Promise<TechnicianPreferredCrewMember> {
    const owner = await this.findProfileByUserIdOrThrow(userId);
    const member = await this.technicianProfiles.findOne({ where: { technicianCode: memberTechnicianCode } });
    if (!member) {
      throw new ApiException(ErrorCode.VAL_001, 'كود الفني غير موجود', HttpStatus.NOT_FOUND);
    }
    if (member.id === owner.id) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش تدعو نفسك', HttpStatus.BAD_REQUEST);
    }

    const existing = await this.members.findOne({
      where: { ownerTechnicianId: owner.id, memberTechnicianId: member.id },
      order: { createdAt: 'DESC' },
    });
    if (existing && (existing.status === PreferredCrewMemberStatus.INVITED || existing.status === PreferredCrewMemberStatus.ACCEPTED)) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده مدعو بالفعل أو عضو فعلاً في فريقك المفضّل', HttpStatus.CONFLICT);
    }

    const maxSize = await this.settingsService.getNumber('matching.preferred_crew_max_size', MAX_SIZE_FALLBACK);
    const acceptedCount = await this.members.count({
      where: { ownerTechnicianId: owner.id, status: PreferredCrewMemberStatus.ACCEPTED },
    });
    if (acceptedCount >= maxSize) {
      throw new ApiException(ErrorCode.VAL_001, `فريقك المفضّل وصل الحد الأقصى (${maxSize} عضو)`, HttpStatus.BAD_REQUEST);
    }

    const invitation = this.members.create({
      ownerTechnicianId: owner.id,
      memberTechnicianId: member.id,
      status: PreferredCrewMemberStatus.INVITED,
      invitedAt: new Date(),
    });
    const saved = await this.members.save(invitation);
    this.events.emit(PREFERRED_CREW_INVITED_EVENT, new PreferredCrewInvitedEvent(saved.id, owner.id, member.id));
    return saved;
  }

  private async findOwnedInvitationOrThrow(memberUserId: string, invitationId: string): Promise<TechnicianPreferredCrewMember> {
    const member = await this.findProfileByUserIdOrThrow(memberUserId);
    const invitation = await this.members.findOne({ where: { id: invitationId, memberTechnicianId: member.id } });
    if (!invitation || invitation.status !== PreferredCrewMemberStatus.INVITED) {
      throw new ApiException(ErrorCode.VAL_001, 'الدعوة دي مش متاحة لك دلوقتي', HttpStatus.CONFLICT);
    }
    return invitation;
  }

  async accept(memberUserId: string, invitationId: string): Promise<TechnicianPreferredCrewMember> {
    const invitation = await this.findOwnedInvitationOrThrow(memberUserId, invitationId);
    invitation.status = PreferredCrewMemberStatus.ACCEPTED;
    invitation.respondedAt = new Date();
    const saved = await this.members.save(invitation);
    this.events.emit(
      PREFERRED_CREW_ACCEPTED_EVENT,
      new PreferredCrewAcceptedEvent(saved.id, saved.ownerTechnicianId, saved.memberTechnicianId),
    );
    return saved;
  }

  async decline(memberUserId: string, invitationId: string): Promise<void> {
    const invitation = await this.findOwnedInvitationOrThrow(memberUserId, invitationId);
    invitation.status = PreferredCrewMemberStatus.DECLINED;
    invitation.respondedAt = new Date();
    await this.members.save(invitation);
  }

  /** الـowner بيشيل عضو (مقبول أو دعوة لسه معلّقة) من فريقه — قرار من جانب واحد، صفر موافقة مطلوبة. */
  async remove(ownerUserId: string, memberId: string): Promise<void> {
    const owner = await this.findProfileByUserIdOrThrow(ownerUserId);
    const row = await this.members.findOne({ where: { id: memberId, ownerTechnicianId: owner.id } });
    if (!row || row.status === PreferredCrewMemberStatus.REMOVED) {
      throw new ApiException(ErrorCode.VAL_001, 'العضو ده مش موجود في فريقك المفضّل', HttpStatus.NOT_FOUND);
    }
    row.status = PreferredCrewMemberStatus.REMOVED;
    await this.members.save(row);
  }

  /** الفني العضو بيمشي من تلقاء نفسه من فريق مفضّل لفني تاني (بلا حاجة لموافقة الـowner). */
  async leave(memberUserId: string, membershipId: string): Promise<void> {
    const member = await this.findProfileByUserIdOrThrow(memberUserId);
    const row = await this.members.findOne({ where: { id: membershipId, memberTechnicianId: member.id } });
    if (!row || row.status !== PreferredCrewMemberStatus.ACCEPTED) {
      throw new ApiException(ErrorCode.VAL_001, 'العضوية دي مش موجودة', HttpStatus.NOT_FOUND);
    }
    row.status = PreferredCrewMemberStatus.REMOVED;
    await this.members.save(row);
  }

  /**
   * مجموعة الأعضاء المقبولين لقائد معيّن — بتُستخدم من OrderTeamService.listRecruitCandidates()
   * (docs/08 §36.17) كمستوى أولوية إضافي فوق isLeaderTeamMember الموجود، صفر تأثير على الاستبعاد.
   */
  async getAcceptedMemberIds(ownerTechnicianId: string): Promise<Set<string>> {
    const rows = await this.members.find({
      where: { ownerTechnicianId, status: PreferredCrewMemberStatus.ACCEPTED },
      select: ['memberTechnicianId'],
    });
    return new Set(rows.map((r) => r.memberTechnicianId));
  }
}
