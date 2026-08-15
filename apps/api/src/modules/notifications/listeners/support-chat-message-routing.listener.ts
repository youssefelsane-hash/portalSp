import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  SUPPORT_CHAT_MESSAGE_RECEIVED_EVENT,
  SupportChatMessageReceivedEvent,
} from '../../../common/events/support-chat-message-received.event';
import { NotificationRoutingService } from '../notification-routing.service';

// §24 — كانت فجوة موثّقة صراحة: صفر إشعار لأدمن لما عميل يبعت رسالة في شات الدعم العام —
// نفس نمط complaint-filed-routing.listener.ts بالحرف، migration 0111 بتزرع القاعدة الافتراضية
// (support_agent، in_app).
@Injectable()
export class SupportChatMessageRoutingListener {
  private readonly logger = new Logger(SupportChatMessageRoutingListener.name);

  constructor(private readonly routingService: NotificationRoutingService) {}

  @OnEvent(SUPPORT_CHAT_MESSAGE_RECEIVED_EVENT)
  async handleSupportChatMessageReceived(event: SupportChatMessageReceivedEvent): Promise<void> {
    try {
      await this.routingService.routeToRole(SUPPORT_CHAT_MESSAGE_RECEIVED_EVENT, {
        notificationType: 'support_chat_message_received',
        titleAr: `رسالة دعم جديدة من ${event.customerFullName}`,
        bodyAr: event.messagePreview,
        referenceType: 'chat_thread',
        referenceId: event.threadId,
        deepLink: `/support-chat/${event.threadId}`,
      });
    } catch (err) {
      this.logger.error(`فشل توجيه إشعار رسالة الدعم للخيط ${event.threadId}`, err instanceof Error ? err.stack : err);
    }
  }
}
