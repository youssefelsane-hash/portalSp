import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { containsLikelyContactInfo } from './contact-info-detector';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatMessage, ChatMessageType } from './entities/chat-message.entity';
import { ChatThread, ChatThreadType } from './entities/chat-thread.entity';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(ChatThread) private readonly threads: Repository<ChatThread>,
    @InjectRepository(ChatMessage) private readonly messages: Repository<ChatMessage>,
    @InjectRepository(CustomerProfile) private readonly customerProfiles: Repository<CustomerProfile>,
    @InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>,
  ) {}

  /** بيتصل بيها لما فني يقبل طلب — idempotent، مش هتعمل تريد لو الخيط موجود قبل كده. */
  async createThreadForOrder(orderId: string, customerId: string, technicianId: string): Promise<ChatThread> {
    const existing = await this.threads.findOne({ where: { orderId } });
    if (existing) return existing;

    const thread = this.threads.create({
      orderId,
      threadType: ChatThreadType.ORDER_CHAT,
      customerId,
      technicianId,
      isActive: true,
    });
    await this.threads.save(thread);
    this.logger.log(`chat thread اتعمل لطلب ${orderId}`);
    return thread;
  }

  /** بيرجّع (userId, isParticipant) — مش بيرمي، عشان يتستخدم في guard الـ WebSocket كمان. */
  async resolveParticipant(userId: string, thread: ChatThread): Promise<boolean> {
    const [customerProfile, technicianProfile] = await Promise.all([
      this.customerProfiles.findOne({ where: { userId } }),
      this.technicianProfiles.findOne({ where: { userId } }),
    ]);
    return (
      (customerProfile !== null && thread.customerId === customerProfile.id) ||
      (technicianProfile !== null && thread.technicianId === technicianProfile.id)
    );
  }

  async findThreadOrThrow(threadId: string): Promise<ChatThread> {
    const thread = await this.threads.findOne({ where: { id: threadId } });
    if (!thread) {
      throw new ApiException(ErrorCode.VAL_001, 'المحادثة غير موجودة', HttpStatus.NOT_FOUND);
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

  async sendMessage(userId: string, threadId: string, dto: SendMessageDto): Promise<ChatMessage> {
    const thread = await this.getThreadForParticipant(userId, threadId);

    if (!thread.isActive || (thread.closesAt && thread.closesAt.getTime() < Date.now())) {
      throw new ApiException(ErrorCode.VAL_001, 'المحادثة دي مقفولة', HttpStatus.CONFLICT);
    }

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

    return message;
  }
}
