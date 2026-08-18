import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { safeExtensionForFile } from '../../common/storage/file-signature-validator';
import { uploadWithOrphanCleanup } from '../../common/storage/upload-with-orphan-cleanup.util';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import {
  SUPPORT_CHAT_MESSAGE_RECEIVED_EVENT,
  SupportChatMessageReceivedEvent,
} from '../../common/events/support-chat-message-received.event';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { PermissionsService } from '../admin/permissions.service';
import { User, UserType } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { containsLikelyContactInfo } from './contact-info-detector';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatMessage, ChatMessageType } from './entities/chat-message.entity';
import { ChatThread, ChatThreadType } from './entities/chat-thread.entity';

export interface IncomingChatFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

// نفس الصلاحية اللي تذاكر الدعم العامة بتستخدمها (support_tickets.manage، migration 0037 —
// super_admin + support_agent) — إعادة استخدام مقصودة، مش صلاحية جديدة لمفهوم فرعي.
const SUPPORT_CHAT_PERMISSION = 'support_tickets.manage';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(ChatThread) private readonly threads: Repository<ChatThread>,
    @InjectRepository(ChatMessage) private readonly messages: Repository<ChatMessage>,
    @InjectRepository(CustomerProfile) private readonly customerProfiles: Repository<CustomerProfile>,
    @InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly permissionsService: PermissionsService,
    private readonly events: EventEmitter2,
  ) {}

  /** بيتصل بيها لما فني يقبل طلب — idempotent، مش هتعمل تريد لو الخيط موجود قبل كده. */
  async createThreadForOrder(orderId: string, customerId: string, technicianId: string): Promise<ChatThread> {
    const inserted = await this.threads
      .createQueryBuilder()
      .insert()
      .values({
        orderId,
        threadType: ChatThreadType.ORDER_CHAT,
        customerId,
        technicianId,
        isActive: true,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    const thread = await this.threads.findOneOrFail({ where: { orderId } });
    if ((inserted.raw as Array<{ id: string }>).length > 0) this.logger.log(`chat thread اتعمل لطلب ${orderId}`);
    return thread;
  }

  /**
   * بيرجّع (userId, isParticipant) — مش بيرمي، عشان يتستخدم في guard الـ WebSocket كمان.
   * لخيوط الدعم العام (`support_chat`) بس: أي أدمن عنده `support_tickets.manage` يعتبر طرف
   * صالح في **أي** خيط دعم (مش بس اللي مُعيّن له) — نفس منطق تذاكر الدعم العامة بالظبط، عكس
   * `order_chat` اللي مقصور على العميل/الفني بتاعت الطلب نفسه فقط، أدمن محدش بيدخله.
   */
  async resolveParticipant(userId: string, thread: ChatThread): Promise<boolean> {
    const [customerProfile, technicianProfile] = await Promise.all([
      this.customerProfiles.findOne({ where: { userId } }),
      this.technicianProfiles.findOne({ where: { userId } }),
    ]);
    if (
      (customerProfile !== null && thread.customerId === customerProfile.id) ||
      (technicianProfile !== null && thread.technicianId === technicianProfile.id)
    ) {
      return true;
    }

    if (thread.threadType === ChatThreadType.SUPPORT_CHAT) {
      const user = await this.users.findOne({ where: { id: userId } });
      if (user?.userType === UserType.ADMIN) {
        return this.permissionsService.hasPermission(userId, SUPPORT_CHAT_PERMISSION);
      }
    }
    return false;
  }

  /** get-or-create — عميل بس، خيط واحد دايم لكل عميل لكل استفسارات الدعم العامة (مش لكل طلب). */
  async getOrCreateSupportThread(userId: string): Promise<ChatThread> {
    const customerProfile = await this.customerProfiles.findOne({ where: { userId } });
    if (!customerProfile) {
      throw new ApiException(ErrorCode.VAL_001, 'حساب العميل غير موجود', HttpStatus.NOT_FOUND);
    }
    // Script 2 Part F (finding #31) — كانت "search then create" بلا حماية DB: طلبين متزامنين
    // ممكن يعدّوا الاتنين على "مفيش خيط" ويعملوا صفين. نفس نمط createThreadForOrder فوق —
    // ON CONFLICT DO NOTHING (idx_chat_threads_one_support_thread_per_customer، migration 0128)
    // ثم إعادة قراءة واحدة بغض النظر مين كسب سباق الإدخال.
    const inserted = await this.threads
      .createQueryBuilder()
      .insert()
      .values({
        orderId: null,
        threadType: ChatThreadType.SUPPORT_CHAT,
        customerId: customerProfile.id,
        technicianId: null,
        isActive: true,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    const thread = await this.threads.findOneOrFail({
      where: { customerId: customerProfile.id, threadType: ChatThreadType.SUPPORT_CHAT },
    });
    if ((inserted.raw as Array<{ id: string }>).length > 0) {
      this.logger.log(`support chat thread اتعمل للعميل ${customerProfile.id}`);
    }
    return thread;
  }

  /**
   * لواجهة الأدمن (`/admin/support-chat-threads`) — كل خيوط الدعم العام، الأحدث نشاطاً الأول،
   * مع اسم/رقم العميل (join يدوي زي نفس نمط PayoutsService.listForAdmin/AdminCustomersService).
   */
  async listSupportThreadsForAdmin(): Promise<
    { thread: ChatThread; customerName: string; customerPhone: string }[]
  > {
    interface SupportThreadRow {
      id: string;
      order_id: string | null;
      customer_id: string;
      technician_id: string | null;
      is_active: boolean;
      last_message_at: Date | null;
      closes_at: Date | null;
      created_at: Date;
      updated_at: Date;
      full_name: string;
      phone_number: string;
    }

    const rows = await this.threads.manager.query<SupportThreadRow[]>(
      `SELECT ct.*, u.full_name, u.phone_number
       FROM chat_threads ct
       JOIN customer_profiles cp ON cp.id = ct.customer_id
       JOIN users u ON u.id = cp.user_id
       WHERE ct.thread_type = 'support_chat'
       ORDER BY ct.last_message_at DESC NULLS LAST, ct.created_at DESC`,
    );
    return rows.map((row) => ({
      thread: this.threads.create({
        id: row.id,
        orderId: row.order_id,
        threadType: ChatThreadType.SUPPORT_CHAT,
        customerId: row.customer_id,
        technicianId: row.technician_id,
        isActive: row.is_active,
        lastMessageAt: row.last_message_at,
        closesAt: row.closes_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
      customerName: row.full_name,
      customerPhone: row.phone_number,
    }));
  }

  async findThreadOrThrow(threadId: string): Promise<ChatThread> {
    const thread = await this.threads.findOne({ where: { id: threadId } });
    if (!thread) {
      throw new ApiException(ErrorCode.VAL_001, 'المحادثة غير موجودة', HttpStatus.NOT_FOUND);
    }
    return thread;
  }

  // كانت فجوة موثّقة: مفيش endpoint يربط order_id بـ thread_id بتاعه — الخيط بيتعمل
  // أوتوماتيك (createThreadForOrder) وقت قبول الفني، بس مفيش طريقة للعميل/الفني يكتشفوا
  // الـ thread_id من غير ما يعرفوه مسبقاً. بترمي 404 صريح لو الطلب لسه معندوش خيط
  // (الفني لسه ما قبلش، مثلاً) بدل ما ترجع null بصمت.
  async getThreadForOrder(userId: string, orderId: string): Promise<ChatThread> {
    const thread = await this.threads.findOne({ where: { orderId } });
    if (!thread) {
      throw new ApiException(ErrorCode.VAL_001, 'مفيش محادثة للطلب ده لسه', HttpStatus.NOT_FOUND);
    }
    if (!(await this.resolveParticipant(userId, thread))) {
      throw new ApiException(ErrorCode.AUTH_001, 'المحادثة دي مش بتاعتك', HttpStatus.FORBIDDEN);
    }
    return thread;
  }

  async getThreadForParticipant(userId: string, threadId: string): Promise<ChatThread> {
    const thread = await this.findThreadOrThrow(threadId);
    if (!(await this.resolveParticipant(userId, thread))) {
      throw new ApiException(ErrorCode.AUTH_001, 'المحادثة دي مش بتاعتك', HttpStatus.FORBIDDEN);
    }
    return thread;
  }

  async listMessages(userId: string, threadId: string): Promise<ChatMessage[]> {
    await this.getThreadForParticipant(userId, threadId);
    return this.messages.find({ where: { threadId }, order: { createdAt: 'ASC' } });
  }

  /**
   * كانت فجوة موثّقة: `closes_at` كان عمود موجود ومُستخدم فعلاً في فحص `sendMessage()` تحت
   * (`thread.closesAt.getTime() < Date.now()`)، بس مفيش حاجة كانت بتحطه أصلاً — أي خيط كان
   * فاضل مفتوح للأبد. بتتنادى من `OrderCompletedChatCloseListener` على `order.status_changed`
   * لما `newStatus=completed`. Idempotent — استدعاء تاني لنفس الطلب (نادر، بس ممكن لو الحدث
   * اتصدر مرتين لأي سبب) بيمدّد المهلة بدل ما يكسر حاجة.
   */
  async scheduleCloseForOrder(orderId: string): Promise<void> {
    const thread = await this.threads.findOne({ where: { orderId } });
    if (!thread) return; // الطلب ممكن يخلص من غير ما فني يقبل أصلاً (نادر) — مفيش خيط يتقفل
    if (thread.closesAt) return;
    thread.closesAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.threads.save(thread);
  }

  private assertThreadOpen(thread: ChatThread): void {
    if (!thread.isActive || (thread.closesAt && thread.closesAt.getTime() < Date.now())) {
      throw new ApiException(ErrorCode.VAL_001, 'المحادثة دي مقفولة', HttpStatus.CONFLICT);
    }
  }

  /**
   * §24 — كانت فجوة موثّقة صراحة: صفر حدث بيتصدّر على رسالة شات جديدة (طلب/دعم على السوا)،
   * فمفيش طريقة لتوجيه إشعار زي complaint.filed/payout.requires_review. هنا نطاق ضيّق عمدًا:
   * شات الدعم العام (support_chat) بس، ولما المُرسِل هو العميل (مش رد الأدمن نفسه — عشان محدش
   * يتصدّر له إشعار لرده الشخصي). أدمن مش متابع /support-chat مباشر كان عنده صفر إشارة إن
   * عميل بينتظر رد.
   */
  private async emitIfSupportMessageFromCustomer(thread: ChatThread, senderUserId: string, preview: string): Promise<void> {
    if (thread.threadType !== ChatThreadType.SUPPORT_CHAT) return;
    const customerProfile = await this.customerProfiles.findOne({ where: { userId: senderUserId } });
    if (!customerProfile || customerProfile.id !== thread.customerId) return; // مش العميل نفسه (أدمن بيرد)

    const sender = await this.users.findOne({ where: { id: senderUserId } });
    this.events.emit(
      SUPPORT_CHAT_MESSAGE_RECEIVED_EVENT,
      new SupportChatMessageReceivedEvent(thread.id, sender?.fullName ?? 'عميل', preview),
    );
  }

  async sendMessage(userId: string, threadId: string, dto: SendMessageDto): Promise<ChatMessage> {
    const thread = await this.getThreadForParticipant(userId, threadId);
    this.assertThreadOpen(thread);

    const message = this.messages.create({
      threadId,
      senderUserId: userId,
      messageType: ChatMessageType.TEXT,
      content: dto.content,
      isRead: false,
      isFlagged: containsLikelyContactInfo(dto.content),
    });
    await this.messages.save(message);

    thread.lastMessageAt = message.createdAt;
    await this.threads.save(thread);

    await this.emitIfSupportMessageFromCustomer(thread, userId, dto.content);

    return message;
  }

  /**
   * كانت فجوة موثّقة: `chat_messages.file_url`/`message_type=image` موجودين في الـ schema
   * من أول يوم بس مفيش endpoint كان بيستخدمهم — كل رسالة كانت نص إجباري. نفس نمط رفع
   * `OrderMediaService` بالظبط (multipart مباشر لـ S3، مش presigned URL).
   */
  async sendImageMessage(userId: string, threadId: string, file: IncomingChatFile): Promise<ChatMessage> {
    const thread = await this.getThreadForParticipant(userId, threadId);
    this.assertThreadOpen(thread);

    const key = `chat/${threadId}/${randomUUID()}${safeExtensionForFile(file.buffer)}`;
    const message = await uploadWithOrphanCleanup(this.storage, key, file.buffer, file.mimetype, async (fileUrl) => {
      const msg = this.messages.create({
        threadId,
        senderUserId: userId,
        messageType: ChatMessageType.IMAGE,
        content: null,
        fileUrl,
        isRead: false,
        isFlagged: false,
      });
      await this.messages.save(msg);
      return msg;
    });

    thread.lastMessageAt = message.createdAt;
    await this.threads.save(thread);

    await this.emitIfSupportMessageFromCustomer(thread, userId, '📷 صورة');

    return message;
  }
}
