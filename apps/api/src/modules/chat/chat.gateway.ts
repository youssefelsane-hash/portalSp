import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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
import { JwtPayload } from '../auth/types/authenticated-request';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { toMessageResponseDto } from './dto/message-response.dto';

interface AuthenticatedSocket extends Socket {
  data: { user: JwtPayload };
}

// اتصال WebSocket لازم يحمل JWT access token في handshake.auth.token — نفس التوكن المستخدم في REST
@WebSocketGateway({ namespace: 'chat', cors: { origin: websocketCorsOriginHandler } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      // docs/08 §19 بند 21 — كانت فجوة حقيقية: fallback لـ`handshake.query.token` (توكن في query
      // string الرابط) موجود جنب `handshake.auth.token` (آلية socket.io الرسمية للـauth). العميلين
      // الحقيقيين (customer-app/technician-app) بيبعتوا التوكن عبر `auth` بس فعليًا (chat_client.dart
      // — `.setAuth({'token': accessToken})`)، فالـquery fallback مش مستخدم، وبيوسّع سطح الهجوم بلا
      // داعي: query strings بتتسجّل في access logs/عناوين المتصفح/الـproxies بسهولة أكتر من حمولة
      // الـhandshake، فتوكن JWT كامل مش المفروض يظهر هناك خالص.
      const token = client.handshake.auth?.token;
      if (!token || typeof token !== 'string') throw new Error('no token');

      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
      client.data.user = payload;
    } catch {
      client.emit('error', { code: 'AUTH_001', message: 'توكن غير صالح' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.logger.debug(`disconnected: ${client.id}`);
  }

  @SubscribeMessage('chat:join')
  async handleJoin(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: { thread_id: string }) {
    const thread = await this.chatService.findThreadOrThrow(body.thread_id);
    const isParticipant = await this.chatService.resolveParticipant(client.data.user.sub, thread);
    if (!isParticipant) {
      client.emit('error', { code: 'AUTH_001', message: 'المحادثة دي مش بتاعتك' });
      return;
    }
    await client.join(`thread:${thread.id}`);
    client.emit('chat:joined', { thread_id: thread.id });
  }

  @SubscribeMessage('chat:send')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async handleSend(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { thread_id: string } & SendMessageDto,
  ) {
    const message = await this.chatService.sendMessage(client.data.user.sub, body.thread_id, {
      content: body.content,
    });
    this.server.to(`thread:${body.thread_id}`).emit('chat:message_received', toMessageResponseDto(message));
  }
}
