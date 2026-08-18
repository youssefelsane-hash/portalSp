import { io, Socket } from 'socket.io-client';
import { MessageDto } from './chat';

// عميل شات حي عبر WebSocket — مطابق لـapps/customer-app's chat_client.dart بالحرف (نفس الـnamespace
// /chat، نفس الأحداث chat:join/chat:joined/chat:send/chat:message_received/error). قبل كده الويب
// كان بيعتمد على بولينج كل 5 ثواني بس (فجوة موثّقة في docs/16) — العميل والفني على الموبايل بيشوفوا
// رسايل بعض فورًا عبر Socket.IO، فالويب لازم يستخدم نفس القناة الحقيقية، مش نظام شات تاني منفصل.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
const SOCKET_BASE_URL = API_URL.replace(/\/api\/v1\/?$/, '');

export class ChatSocketClient {
  private socket: Socket | null = null;

  connect(opts: {
    accessToken: string;
    threadId: string;
    onMessageReceived: (message: MessageDto) => void;
    onJoined?: () => void;
    onError?: (message: string) => void;
  }): void {
    const socket = io(`${SOCKET_BASE_URL}/chat`, {
      transports: ['websocket'],
      auth: { token: opts.accessToken },
      autoConnect: false,
      forceNew: true,
    });
    this.socket = socket;

    socket.on('connect', () => socket.emit('chat:join', { thread_id: opts.threadId }));
    socket.on('chat:joined', () => opts.onJoined?.());
    socket.on('chat:message_received', (data: MessageDto) => opts.onMessageReceived(data));
    socket.on('error', (data: { message?: string }) => opts.onError?.(data?.message ?? 'حصل خطأ في الشات'));

    socket.connect();
  }

  sendMessage(threadId: string, content: string): void {
    this.socket?.emit('chat:send', { thread_id: threadId, content });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
