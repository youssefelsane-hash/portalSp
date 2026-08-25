import { Logger, UsePipes } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { Server, Socket } from 'socket.io';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import {
  TECHNICIAN_PRESENCE_CHANGED_EVENT,
  TechnicianPresenceChangedEvent,
} from '../../common/events/technician-presence-changed.event';
import { websocketCorsOriginHandler } from '../../common/websocket/websocket-cors.util';
import { RealtimeAccessService } from '../../common/websocket/realtime-access.service';
import { RealtimeSessionRegistry } from '../../common/websocket/realtime-session-registry.service';
import { StrictWebsocketValidationPipe } from '../../common/websocket/strict-websocket-validation.pipe';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { TechniciansService } from '../technicians/technicians.service';
import { Order } from './entities/order.entity';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES } from './order-state-machine';
import { JoinTrackingOrderDto, TechnicianLocationEventDto } from './dto/tracking-socket.dto';

interface AuthenticatedSocket extends Socket {
  data: { user?: JwtPayload; authentication?: Promise<JwtPayload> };
}

const ACTIVE_TRACKING_STATUSES = ACTIVE_TECHNICIAN_ORDER_STATUSES;

// تتبع موقع الفني لحظياً — بيوقف تلقائي بمجرد ما الطلب يخرج من الحالات الفعّالة (اكتمل/اتلغى)،
// عشان الفني ميفضلش متتبّع بعد ما يخلص شغل (§6 في الماستر بلان: "يقف بعد اكتمال الطلب")
@WebSocketGateway({ namespace: 'tracking', cors: { origin: websocketCorsOriginHandler } })
export class OrderTrackingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(OrderTrackingGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly realtimeAccess: RealtimeAccessService,
    private readonly sessions: RealtimeSessionRegistry,
    private readonly events: EventEmitter2,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    client.data.authentication = this.realtimeAccess.authenticate(client.handshake.auth?.token).then((payload) => {
      client.data.user = payload;
      const wasOnline = this.sessions.isUserOnline(payload.sub);
      this.sessions.register(payload.sub, client);
      if (payload.userType === UserType.TECHNICIAN && !wasOnline) {
        this.events.emit(
          TECHNICIAN_PRESENCE_CHANGED_EVENT,
          new TechnicianPresenceChangedEvent(payload.sub, true),
        );
      }
      return payload;
    });
    try {
      // docs/08 §19 بند 21 — نفس إصلاح ChatGateway.handleConnection() بالحرف: شيل query-string
      // fallback (tracking_client.dart بيستخدم `auth` بس فعليًا)، JWT كامل مالوش داعي يظهر في
      // access logs/عناوين المتصفح.
      await client.data.authentication;
    } catch {
      client.emit('error', { code: 'AUTH_001', message: 'توكن غير صالح' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    const payload = client.data.user;
    this.sessions.unregister(payload?.sub, client);
    if (
      payload?.userType === UserType.TECHNICIAN &&
      !this.sessions.isUserOnline(payload.sub)
    ) {
      this.events.emit(
        TECHNICIAN_PRESENCE_CHANGED_EVENT,
        new TechnicianPresenceChangedEvent(payload.sub, false),
      );
    }
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

  @SubscribeMessage('tracking:join')
  @UsePipes(new StrictWebsocketValidationPipe())
  async handleJoin(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: JoinTrackingOrderDto) {
    const payload = await this.activePayload(client);
    if (!payload) return;
    const order = await this.orders.findOne({ where: { id: body.order_id } });
    if (!order) {
      client.emit('error', { code: 'VAL_001', message: 'الطلب غير موجود' });
      return;
    }

    if (!ACTIVE_TRACKING_STATUSES.includes(order.orderStatus)) {
      client.emit('error', { code: 'VAL_001', message: 'التتبع غير متاح في حالة الطلب الحالية' });
      return;
    }

    const userId = payload.sub;
    const isCustomer =
      payload.userType === UserType.CUSTOMER &&
      (await this.customerProfiles.findByUserIdOrThrow(userId).catch(() => null))?.id === order.customerId;
    const isTechnician =
      payload.userType === UserType.TECHNICIAN &&
      (await this.techniciansService.findByUserIdOrThrow(userId).catch(() => null))?.id === order.technicianId;

    if (!isCustomer && !isTechnician) {
      client.emit('error', { code: 'AUTH_001', message: 'الطلب ده مش بتاعك' });
      return;
    }

    await client.join(`order:${order.id}`);
    client.emit('tracking:joined', {
      order_id: order.id,
      order_status: order.orderStatus,
      state_version: order.updatedAt.toISOString(),
    });
  }

  @SubscribeMessage('technician:location')
  @UsePipes(new StrictWebsocketValidationPipe())
  async handleLocation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: TechnicianLocationEventDto,
  ) {
    const payload = await this.activePayload(client);
    if (!payload) return;
    if (payload.userType !== UserType.TECHNICIAN) {
      client.emit('error', { code: 'AUTH_001', message: 'تحديث الموقع متاح للفني فقط' });
      return;
    }
    if (!this.sessions.consumeRateLimit(client.id, 'technician:location', 10, 10_000)) {
      client.emit('error', { code: 'VAL_001', message: 'تحديثات موقع كثيرة جدًا، الحد تحديث واحد في الثانية' });
      return;
    }

    const profile = await this.techniciansService.findByUserIdOrThrow(payload.sub);
    await this.techniciansService.updateLocation(payload.sub, body);

    // بَقّة حقيقية اتلقطت (docs/08 §165، بعد ADR-0017): نفس بَقّة orders.service.ts's
    // findActiveForTechnician() بالحرف — فني ممكن يكون عنده طلب ASAP شغال فعليًا وطلب مجدول
    // مستقبلي `ACCEPTED` (مؤكّد تلقائيًا) في نفس الوقت. من غير الفلتر ده، findOne كان ممكن
    // يرجّع الطلب المجدول الغلط ويبعت تحديث الموقع لغرفة الطلب اللي مش شغال عليه فعليًا دلوقتي.
    const now = new Date();
    const activeOrder = await this.orders.findOne({
      where: [
        { technicianId: profile.id, orderStatus: In(ACTIVE_TRACKING_STATUSES), scheduledAt: IsNull() },
        { technicianId: profile.id, orderStatus: In(ACTIVE_TRACKING_STATUSES), scheduledAt: LessThanOrEqual(now) },
      ],
    });
    if (!activeOrder) return;

    this.server.to(`order:${activeOrder.id}`).emit('order:location_updated', {
      order_id: activeOrder.id,
      latitude: body.latitude,
      longitude: body.longitude,
      observed_at: new Date().toISOString(),
    });
  }

  // بث لحظي لأي تغيير حالة طلب (docs/08 §15) — كانت فجوة موثّقة صراحة: العميل بيوافق/يرفض عرض
  // السعر (order-items.service.ts) وبيوصل للفني إشعار push/in-app بس، شاشة تنفيذ الطلب المفتوحة
  // فعلاً عند الفني (لو مفتوحة) كانت بتفضل عارضة الحالة القديمة (awaiting_quote_approval) لحد ما
  // يخرج ويرجع يدوي أو يعمل pull-to-refresh. بنستخدم نفس غرفة `order:${orderId}` بتاعة تتبع
  // الموقع (namespace /tracking) بدل قناة جديدة — كلا الطرفين (عميل/فني) بينضموا لها أصلاً وقت
  // أي حالة نشطة، فمفيش بنية تحتية إضافية. حدث عام (مش خاص بعرض السعر بس) عشان أي تغيير حالة
  // تاني (مثلاً إلغاء الأدمن وهو الفني فاتح الشاشة) يتصلح بنفس الآلية من غير تكرار.
  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handleOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    const order = await this.orders.findOne({ where: { id: event.orderId } });
    // Ignore a late in-process event if the authoritative row has already moved on.
    if (!order || order.orderStatus !== event.newStatus) return;
    this.server.to(`order:${event.orderId}`).emit('order:status_changed', {
      order_id: event.orderId,
      previous_status: event.previousStatus,
      new_status: event.newStatus,
      state_version: order.updatedAt.toISOString(),
    });
    if (!ACTIVE_TRACKING_STATUSES.includes(order.orderStatus)) {
      this.server.in(`order:${event.orderId}`).socketsLeave(`order:${event.orderId}`);
    }
  }
}
