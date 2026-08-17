import { Logger, UsePipes } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { websocketCorsOriginHandler } from '../../common/websocket/websocket-cors.util';
import { RealtimeAccessService } from '../../common/websocket/realtime-access.service';
import { RealtimeSessionRegistry } from '../../common/websocket/realtime-session-registry.service';
import { StrictWebsocketValidationPipe } from '../../common/websocket/strict-websocket-validation.pipe';
import { JwtPayload } from '../auth/types/authenticated-request';
import { ChatService } from './chat.service';
import { toMessageResponseDto } from './dto/message-response.dto';
import { JoinChatThreadDto, SocketSendMessageDto } from './dto/socket-chat.dto';

interface AuthenticatedSocket extends Socket {
  data: { user?: JwtPayload; authentication?: Promise<JwtPayload> };
}

// اتصال WebSocket لازم يحمل JWT access token في handshake.auth.token — نفس التوكن المستخدم في REST
@WebSocketGateway({ namespace: 'chat', cors: { origin: websocketCorsOriginHandler } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly realtimeAccess: RealtimeAccessService,
    private readonly sessions: RealtimeSessionRegistry,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    client.data.authentication = this.realtimeAccess.authenticate(client.handshake.auth?.token).then((payload) => {
      client.data.user = payload;
      this.sessions.register(payload.sub, client);
      return payload;
    });
    try {
      // docs/08 §19 بند 21 — كانت فجوة حقيقية: fallback لـ`handshake.query.token` (توكن في query
      // string الرابط) موجود جنب `handshake.auth.token` (آلية socket.io الرسمية للـauth). العميلين
      // الحقيقيين (customer-app/technician-app) بيبعتوا التوكن عبر `auth` بس فعليًا (chat_client.dart
      // — `.setAuth({'token': accessToken})`)، فالـquery fallback مش مستخدم، وبيوسّع سطح الهجوم بلا
      // داعي: query strings بتتسجّل في access logs/عناوين المتصفح/الـproxies بسهولة أكتر من حمولة
      // الـhandshake، فتوكن JWT كامل مش المفروض يظهر هناك خالص.
      await client.data.authentication;
    } catch {
      client.emit('error', { code: 'AUTH_001', message: 'توكن غير صالح' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.sessions.unregister(client.data.user?.sub, client);
    this.logger.debug(`disconnected: ${client.id}`);
  }

  private async activePayload(client: AuthenticatedSocket): Promise<JwtPayload | null> {
    const payload = client.data.user ?? (await client.data.authentication?.catch(() => undefined));
    if (!payload) return null;
    try {
      await this.realtimeAccess.assertActive(payload);
      return payload;
    } catch {
      this.sessions.disconnectUser(payload.sub, 'الحساب أو الجلسة غير متاحة');
      return null;
    }
  }

  @SubscribeMessage('chat:join')
  @UsePipes(new StrictWebsocketValidationPipe())
  async handleJoin(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: JoinChatThreadDto) {
    const user = await this.activePayload(client);
    if (!user) return;
    const thread = await this.chatService.findThreadOrThrow(body.thread_id);
    const isParticipant = await this.chatService.resolveParticipant(user.sub, thread);
    if (!isParticipant) {
      client.emit('error', { code: 'AUTH_001', message: 'المحادثة دي مش بتاعتك' });
      return;
    }
    await client.join(`thread:${thread.id}`);
    client.emit('chat:joined', {
      thread_id: thread.id,
      is_active: thread.isActive,
      last_message_at: thread.lastMessageAt?.toISOString() ?? null,
    });
  }

  @SubscribeMessage('chat:send')
  @UsePipes(new StrictWebsocketValidationPipe())
  async handleSend(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: SocketSendMessageDto,
  ) {
    const user = await this.activePayload(client);
    if (!user) return;
    if (!this.sessions.consumeRateLimit(client.id, 'chat:send', 30, 10_000)) {
      client.emit('error', { code: 'VAL_001', message: 'رسائل كثيرة جدًا، حاول بعد لحظة' });
      return;
    }
    const message = await this.chatService.sendMessage(user.sub, body.thread_id, {
      content: body.content,
    });
    this.server.to(`thread:${body.thread_id}`).emit('chat:message_received', toMessageResponseDto(message));
  }
}
