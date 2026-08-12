import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { TechniciansService } from '../technicians/technicians.service';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { OrderTeamMemberRow } from './dto/team-member-response.dto';
import { BookingMode, Order } from './entities/order.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';

const MAX_TEAM_MEMBERS_PER_ORDER = 15;

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
              otm.role_label AS "roleLabel", otm.created_at AS "createdAt"
       FROM order_team_members otm
       JOIN technician_profiles tp ON tp.id = otm.technician_id
       JOIN users u ON u.id = tp.user_id
       WHERE otm.order_id = $1
       ORDER BY otm.created_at ASC`,
      [orderId],
    );
  }
}
