import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ORDER_CREW_CHANGED_EVENT, OrderCrewChangedEvent } from '../../common/events/order-crew-changed.event';
import { TechnicianLevel } from '../technicians/entities/technician-profile.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { OrderTeamMemberRow } from './dto/team-member-response.dto';
import { BookingMode, Order } from './entities/order.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';

export const MAX_TEAM_MEMBERS_PER_ORDER = 15;

// ترتيب رتبة الفني (docs/08 §31) — نفس ترتيب تعريف enum TechnicianLevel التصريحي بالحرف، قرار
// مقصود للبساطة (طلب المالك صراحة) بدل الاعتماد على order_priority_weight القابل للتعديل في
// technician_level_config (كان هيحتاج join إضافي بلا داعي حقيقي هنا).
const TECHNICIAN_LEVEL_RANK: Record<TechnicianLevel, number> = {
  [TechnicianLevel.NEW]: 0,
  [TechnicianLevel.VERIFIED]: 1,
  [TechnicianLevel.PROFESSIONAL]: 2,
  [TechnicianLevel.PREMIUM]: 3,
  [TechnicianLevel.TEAM_LEADER]: 4,
};

export interface RecruitCandidateRow {
  technicianId: string;
  fullName: string;
  avatarUrl: string | null;
  currentLevel: TechnicianLevel;
  averageRating: string;
  distanceKm: string | null;
}

/** (docs/08 §31) — استخراج مشترك لمنطق "الفريق ناقص" المستخدم في AdminOrdersService.removeCrewMember()
 * وهنا كمان، بدل تكراره. الـ+1 بيمثّل قائد الطلب نفسه (مش صف في order_team_members). */
export function computeCrewShortage(
  requiredTechnicians: number | null,
  teamMembersCount: number,
): { shortage: boolean; needed: number } {
  if (requiredTechnicians == null) return { shortage: false, needed: 0 };
  const currentSize = teamMembersCount + 1;
  return { shortage: currentSize < requiredTechnicians, needed: Math.max(0, requiredTechnicians - currentSize) };
}

/**
 * توزيع أدوار الفريق داخل الطلب الواحد (docs/08 §5) — إضافي بحت فوق orders.technician_id
 * ("قائد الطلب"، بيفضل زي ما هو من غير أي تغيير). مين يقدر يضيف؟ الفني المسؤول عن الطلب
 * (orders.technician_id) بس، وبس لأعضاء من **نفس الشركة/الفريق** (company_id مطابق) — عشان
 * منمنعش فني يحط أي حد عشوائي على طلب مش بتاعه. مقصود إن العضو المضاف مبيوافقش على الإضافة —
 * زي "معاه مساعد؟" (technicians/README.md) بالظبط، القرار للفني القائد مش للمضاف.
 */
@Injectable()
export class OrderTeamService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderTeamMember) private readonly teamMembers: Repository<OrderTeamMember>,
    private readonly techniciansService: TechniciansService,
    private readonly events: EventEmitter2,
  ) {}

  private async findOwnedOrderOrThrow(userId: string, orderId: string): Promise<{ order: Order; leaderProfileId: string }> {
    const leaderProfile = await this.techniciansService.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, technicianId: leaderProfile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
    }
    return { order, leaderProfileId: leaderProfile.id };
  }

  async addMember(userId: string, orderId: string, dto: AddTeamMemberDto): Promise<void> {
    const { order, leaderProfileId } = await this.findOwnedOrderOrThrow(userId, orderId);

    if (order.bookingMode !== BookingMode.TEAM) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'توزيع أعضاء الفريق متاح بس للطلبات اللي حجزها "اعتماد" (فريق)',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.technician_id === leaderProfileId) {
      throw new ApiException(ErrorCode.VAL_001, 'أنت أصلاً المسؤول عن الطلب ده', HttpStatus.BAD_REQUEST);
    }

    const leaderProfile = await this.techniciansService.findByProfileIdOrThrow(leaderProfileId);
    const memberProfile = await this.techniciansService.findByProfileIdOrThrow(dto.technician_id);
    if (!leaderProfile.companyId || memberProfile.companyId !== leaderProfile.companyId) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده مش في نفس فريقك/شركتك', HttpStatus.BAD_REQUEST);
    }

    const existingCount = await this.teamMembers.count({ where: { orderId } });
    if (existingCount >= MAX_TEAM_MEMBERS_PER_ORDER) {
      throw new ApiException(ErrorCode.VAL_001, `أقصى عدد أعضاء فريق للطلب هو ${MAX_TEAM_MEMBERS_PER_ORDER}`, HttpStatus.BAD_REQUEST);
    }
    const alreadyAdded = await this.teamMembers.findOne({ where: { orderId, technicianId: dto.technician_id } });
    if (alreadyAdded) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده مضاف بالفعل لفريق الطلب ده', HttpStatus.CONFLICT);
    }

    const member = this.teamMembers.create({
      orderId,
      technicianId: dto.technician_id,
      roleLabel: dto.role_label,
      addedByTechnicianId: leaderProfileId,
    });
    await this.teamMembers.save(member);
  }

  async removeMember(userId: string, orderId: string, memberId: string): Promise<void> {
    await this.findOwnedOrderOrThrow(userId, orderId);
    const member = await this.teamMembers.findOne({ where: { id: memberId, orderId } });
    if (!member) {
      throw new ApiException(ErrorCode.VAL_001, 'عضو الفريق ده غير موجود', HttpStatus.NOT_FOUND);
    }
    await this.teamMembers.remove(member);
  }

  /** عام عمداً (بدون فحص ملكية) — بيتنادى من واجهة الفني (القائد) والعميل والأدمن كلهم لعرض نفس القايمة. */
  async listForOrder(orderId: string): Promise<OrderTeamMemberRow[]> {
    return this.teamMembers.manager.query<OrderTeamMemberRow[]>(
      `SELECT otm.id, otm.technician_id AS "technicianId", u.full_name AS "fullName", u.avatar_url AS "avatarUrl",
              otm.role_label AS "roleLabel", otm.member_type AS "memberType", otm.created_at AS "createdAt"
       FROM order_team_members otm
       JOIN technician_profiles tp ON tp.id = otm.technician_id
       JOIN users u ON u.id = tp.user_id
       WHERE otm.order_id = $1
       ORDER BY otm.created_at ASC`,
      [orderId],
    );
  }

  /** "الفريق ناقص؟" (docs/08 §31) — نفس السؤال اللي apps/admin بيسأله، هنا للفني القائد على طلبه هو. */
  async getShortageForOrder(orderId: string, requiredTechnicians: number | null): Promise<{ shortage: boolean; needed: number }> {
    const count = await this.teamMembers.count({ where: { orderId } });
    return computeCrewShortage(requiredTechnicians, count);
  }

  /**
   * مرشّحين للتجنيد الذاتي (docs/08 §31) — نفس نمط TechniciansService.listForServiceBooking()
   * بالحرف (نفس الجداول/شرط الأهلية بالفئة، ADR-0018 §8)، بس **بدون** technicianAvailabilityCondition
   * (بتفحص تعارض جدول *مستقبلي*؛ التجنيد هنا "تعال دلوقتي" مش حجز مستقبلي — بساطة العميل تنطبق
   * برضه هنا، طلب مالك صريح). فرق جوهري عن addMember(): صفر فحص شركة، مجمع كل الفنيين المتاحين.
   */
  async listRecruitCandidates(userId: string, orderId: string): Promise<RecruitCandidateRow[]> {
    const { order, leaderProfileId } = await this.findOwnedOrderOrThrow(userId, orderId);
    if (order.bookingMode !== BookingMode.TEAM) {
      throw new ApiException(ErrorCode.VAL_001, 'تجنيد فريق متاح بس للطلبات اللي حجزها "اعتماد" (فريق)', HttpStatus.BAD_REQUEST);
    }
    const leaderProfile = await this.techniciansService.findByProfileIdOrThrow(leaderProfileId);
    const leaderRank = TECHNICIAN_LEVEL_RANK[leaderProfile.currentLevel];

    return this.teamMembers.manager.query<RecruitCandidateRow[]>(
      `
      SELECT tp.id AS "technicianId", u.full_name AS "fullName", u.avatar_url AS "avatarUrl",
             tp.current_level AS "currentLevel", tp.average_rating AS "averageRating",
             ST_Distance(tp.current_location, a.location) / 1000.0 AS "distanceKm"
      FROM technician_profiles tp
      JOIN users u ON u.id = tp.user_id
      JOIN orders o ON o.id = $1
      JOIN services svc ON svc.id = o.service_id
      LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = o.service_id
        AND ts.is_active = true AND ts.verification_status = 'approved'
      CROSS JOIN LATERAL (SELECT location FROM addresses WHERE id = o.address_id) a
      WHERE tp.verification_status = 'approved' AND tp.deleted_at IS NULL
        AND tp.is_available = true
        AND tp.current_location IS NOT NULL
        AND tp.id != $2
        AND (
          ts.id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM technician_categories tc
            WHERE tc.technician_id = tp.id AND tc.category_id = svc.category_id
              AND tc.is_active = true AND tc.verification_status = 'approved'
          )
        )
        AND NOT EXISTS (SELECT 1 FROM order_team_members otm WHERE otm.order_id = $1 AND otm.technician_id = tp.id)
        AND CASE tp.current_level
              WHEN 'new' THEN 0 WHEN 'verified' THEN 1 WHEN 'professional' THEN 2
              WHEN 'premium' THEN 3 WHEN 'team_leader' THEN 4 END <= $3
      ORDER BY "distanceKm" ASC NULLS LAST, tp.average_rating DESC
      LIMIT 30
      `,
      [orderId, leaderProfileId, leaderRank],
    );
  }

  /**
   * تجنيد فوري (docs/08 §31) — بلا موافقة من المُضاف (زي addMember() بالظبط)، بس بيعيد التحقق
   * الكامل تاني وقت الإضافة الفعلية (القايمة اللي المستخدم شافها ممكن تبقى قديمة — تعارض حقيقي
   * لو فني اتشغل/اتضاف لطلب تاني بين ما القائد فتح القايمة ودوس على مرشّح).
   */
  async recruitMember(userId: string, orderId: string, technicianId: string, roleLabel?: string): Promise<void> {
    const { order, leaderProfileId } = await this.findOwnedOrderOrThrow(userId, orderId);
    if (order.bookingMode !== BookingMode.TEAM) {
      throw new ApiException(ErrorCode.VAL_001, 'تجنيد فريق متاح بس للطلبات اللي حجزها "اعتماد" (فريق)', HttpStatus.BAD_REQUEST);
    }
    if (technicianId === leaderProfileId) {
      throw new ApiException(ErrorCode.VAL_001, 'أنت أصلاً المسؤول عن الطلب ده', HttpStatus.BAD_REQUEST);
    }

    const leaderProfile = await this.techniciansService.findByProfileIdOrThrow(leaderProfileId);
    const candidateProfile = await this.techniciansService.findByProfileIdOrThrow(technicianId);
    if (TECHNICIAN_LEVEL_RANK[candidateProfile.currentLevel] > TECHNICIAN_LEVEL_RANK[leaderProfile.currentLevel]) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده رتبته أعلى منك — مينفعش تجنّده', HttpStatus.FORBIDDEN);
    }
    if (!candidateProfile.isAvailable || !candidateProfile.currentLocation) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده مش متاح دلوقتي', HttpStatus.CONFLICT);
    }

    const existingCount = await this.teamMembers.count({ where: { orderId } });
    if (existingCount >= MAX_TEAM_MEMBERS_PER_ORDER) {
      throw new ApiException(ErrorCode.VAL_001, `أقصى عدد أعضاء فريق للطلب هو ${MAX_TEAM_MEMBERS_PER_ORDER}`, HttpStatus.BAD_REQUEST);
    }
    const alreadyAdded = await this.teamMembers.findOne({ where: { orderId, technicianId } });
    if (alreadyAdded) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده مضاف بالفعل لفريق الطلب ده', HttpStatus.CONFLICT);
    }

    const member = this.teamMembers.create({
      orderId,
      technicianId,
      roleLabel: roleLabel && roleLabel.trim().length > 0 ? roleLabel.trim() : 'عضو فريق',
      addedByTechnicianId: leaderProfileId,
    });
    await this.teamMembers.save(member);

    this.events.emit(ORDER_CREW_CHANGED_EVENT, new OrderCrewChangedEvent(orderId, 'added', technicianId, null, 'technician'));
  }
}
