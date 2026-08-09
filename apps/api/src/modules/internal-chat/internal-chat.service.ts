import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { User, UserType } from '../auth/entities/user.entity';
import { SendInternalMessageDto } from './dto/send-internal-message.dto';
import { InternalChatThread } from './entities/internal-chat-thread.entity';
import { InternalMessage } from './entities/internal-message.entity';

export interface InternalContact {
  userId: string;
  fullName: string;
  userType: UserType;
}

// أزواج مسموحة: admin↔admin، admin↔technician. مش technician↔technician (مش مطلوب صراحة —
// النطاق الأوسع محتاج قرارات هرمية إضافية مؤجلة)، ومحدش customer بيدخل هنا خالص (منفصل تماماً
// عن support_chat في موديول chat).
function assertAllowedPair(userA: User, userB: User): void {
  const types = new Set([userA.userType, userB.userType]);
  const allowed =
    (userA.userType === UserType.ADMIN || userB.userType === UserType.ADMIN) &&
    !types.has(UserType.CUSTOMER) &&
    !(userA.userType === UserType.TECHNICIAN && userB.userType === UserType.TECHNICIAN);
  if (!allowed) {
    throw new ApiException(
      ErrorCode.VAL_001,
      'الشات الداخلي متاح بس بين موظفين، أو بين موظف وفني',
      HttpStatus.BAD_REQUEST,
    );
  }
}

@Injectable()
export class InternalChatService {
  constructor(
    @InjectRepository(InternalChatThread) private readonly threads: Repository<InternalChatThread>,
    @InjectRepository(InternalMessage) private readonly messages: Repository<InternalMessage>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async listContactsFor(userId: string): Promise<InternalContact[]> {
    const me = await this.users.findOne({ where: { id: userId } });
    if (!me) {
      throw new ApiException(ErrorCode.VAL_001, 'المستخدم غير موجود', HttpStatus.NOT_FOUND);
    }

    // أدمن: يقدر يكلم أي أدمن تاني أو أي فني. فني: يقدر يكلم أي أدمن بس (مش فني تاني).
    const allowedTypes = me.userType === UserType.ADMIN ? [UserType.ADMIN, UserType.TECHNICIAN] : [UserType.ADMIN];
    const rows = await this.users
      .createQueryBuilder('u')
      .where('u.user_type IN (:...types)', { types: allowedTypes })
      .andWhere('u.id != :userId', { userId })
      .orderBy('u.full_name', 'ASC')
      .getMany();

    return rows.map((u) => ({ userId: u.id, fullName: u.fullName, userType: u.userType }));
  }

  /** get-or-create — مرتّبين دايماً (a < b) عشان القيد على الجدول، خيط واحد لكل زوج مستخدمين. */
  async getOrCreateThread(userId: string, peerUserId: string): Promise<InternalChatThread> {
    if (userId === peerUserId) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش تعمل شات مع نفسك', HttpStatus.BAD_REQUEST);
    }
    const [me, peer] = await Promise.all([
      this.users.findOne({ where: { id: userId } }),
      this.users.findOne({ where: { id: peerUserId } }),
    ]);
    if (!me || !peer) {
      throw new ApiException(ErrorCode.VAL_001, 'المستخدم غير موجود', HttpStatus.NOT_FOUND);
    }
    assertAllowedPair(me, peer);

    // .toLowerCase() دفاعي — الترتيب لازم يطابق مقارنة uuid في الـ CHECK constraint بالظبط
    // (byte-wise، بيتطابق مع مقارنة نصية lowercase بس)، حتى لو مصدر الـ id مش موحّد الحالة.
    const [participantAUserId, participantBUserId] = [userId.toLowerCase(), peerUserId.toLowerCase()].sort();
    const existing = await this.threads.findOne({ where: { participantAUserId, participantBUserId } });
    if (existing) return existing;

    const thread = this.threads.create({ participantAUserId, participantBUserId });
    return this.threads.save(thread);
  }

  async getContact(userId: string): Promise<InternalContact> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new ApiException(ErrorCode.VAL_001, 'المستخدم غير موجود', HttpStatus.NOT_FOUND);
    }
    return { userId: user.id, fullName: user.fullName, userType: user.userType };
  }

  resolveParticipant(userId: string, thread: InternalChatThread): boolean {
    return thread.participantAUserId === userId || thread.participantBUserId === userId;
  }

  async findThreadOrThrow(threadId: string): Promise<InternalChatThread> {
    const thread = await this.threads.findOne({ where: { id: threadId } });
    if (!thread) {
      throw new ApiException(ErrorCode.VAL_001, 'المحادثة غير موجودة', HttpStatus.NOT_FOUND);
    }
    return thread;
  }

  async getThreadForParticipant(userId: string, threadId: string): Promise<InternalChatThread> {
    const thread = await this.findThreadOrThrow(threadId);
    if (!this.resolveParticipant(userId, thread)) {
      throw new ApiException(ErrorCode.AUTH_001, 'المحادثة دي مش بتاعتك', HttpStatus.FORBIDDEN);
    }
    return thread;
  }

  /** كل خيوط المستخدم، الأحدث نشاطاً الأول، مع اسم/دور الطرف التاني. */
  async listThreadsForUser(userId: string): Promise<{ thread: InternalChatThread; peer: InternalContact }[]> {
    interface ThreadRow {
      id: string;
      participant_a_user_id: string;
      participant_b_user_id: string;
      last_message_at: Date | null;
      created_at: Date;
      updated_at: Date;
      peer_id: string;
      peer_full_name: string;
      peer_user_type: UserType;
    }
    const rows = await this.threads.manager.query<ThreadRow[]>(
      `SELECT t.*, u.id AS peer_id, u.full_name AS peer_full_name, u.user_type AS peer_user_type
       FROM internal_chat_threads t
       JOIN users u ON u.id = (CASE WHEN t.participant_a_user_id = $1 THEN t.participant_b_user_id ELSE t.participant_a_user_id END)
       WHERE t.participant_a_user_id = $1 OR t.participant_b_user_id = $1
       ORDER BY t.last_message_at DESC NULLS LAST, t.created_at DESC`,
      [userId],
    );
    return rows.map((row) => ({
      thread: this.threads.create({
        id: row.id,
        participantAUserId: row.participant_a_user_id,
        participantBUserId: row.participant_b_user_id,
        lastMessageAt: row.last_message_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
      peer: { userId: row.peer_id, fullName: row.peer_full_name, userType: row.peer_user_type },
    }));
  }

  async listMessages(userId: string, threadId: string): Promise<InternalMessage[]> {
    await this.getThreadForParticipant(userId, threadId);
    return this.messages.find({ where: { threadId }, order: { createdAt: 'ASC' } });
  }

  async sendMessage(userId: string, threadId: string, dto: SendInternalMessageDto): Promise<InternalMessage> {
    const thread = await this.getThreadForParticipant(userId, threadId);

    const message = this.messages.create({
      threadId,
      senderUserId: userId,
      content: dto.content,
      isRead: false,
    });
    await this.messages.save(message);

    thread.lastMessageAt = message.createdAt;
    await this.threads.save(thread);

    return message;
  }
}
