import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
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
import { In, Repository } from 'typeorm';
import { Server, Socket } from 'socket.io';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { TechniciansService } from '../technicians/technicians.service';
import { Order, OrderStatus } from './entities/order.entity';

interface AuthenticatedSocket extends Socket {
  data: { user: JwtPayload };
}

const ACTIVE_TRACKING_STATUSES = [
  OrderStatus.ACCEPTED,
  OrderStatus.TECHNICIAN_ON_WAY,
  OrderStatus.TECHNICIAN_ARRIVED,
  OrderStatus.IN_PROGRESS,
];

// تتبع موقع الفني لحظياً — بيوقف تلقائي بمجرد ما الطلب يخرج من الحالات الفعّالة (اكتمل/اتلغى)،
// عشان الفني ميفضلش متتبّع بعد ما يخلص شغل (§6 في الماستر بلان: "يقف بعد اكتمال الطلب")
@WebSocketGateway({ namespace: 'tracking', cors: { origin: '*' } })
export class OrderTrackingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(OrderTrackingGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token = client.handshake.auth?.token ?? client.handshake.query?.token;
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

  @SubscribeMessage('tracking:join')
  async handleJoin(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: { order_id: string }) {
    const order = await this.orders.findOne({ where: { id: body.order_id } });
    if (!order) {
      client.emit('error', { code: 'VAL_001', message: 'الطلب غير موجود' });
      return;
    }

    const userId = client.data.user.sub;
    const isCustomer =
      client.data.user.userType === UserType.CUSTOMER &&
      (await this.customerProfiles.findByUserIdOrThrow(userId).catch(() => null))?.id === order.customerId;
    const isTechnician =
      client.data.user.userType === UserType.TECHNICIAN &&
      (await this.techniciansService.findByUserIdOrThrow(userId).catch(() => null))?.id === order.technicianId;

    if (!isCustomer && !isTechnician) {
      client.emit('error', { code: 'AUTH_001', message: 'الطلب ده مش بتاعك' });
      return;
    }

    await client.join(`order:${order.id}`);
    client.emit('tracking:joined', { order_id: order.id });
  }

  @SubscribeMessage('technician:location')
  async handleLocation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { latitude: number; longitude: number },
  ) {
    if (client.data.user.userType !== UserType.TECHNICIAN) return;

    const profile = await this.techniciansService.findByUserIdOrThrow(client.data.user.sub);
    await this.techniciansService.updateLocation(client.data.user.sub, body);

    const activeOrder = await this.orders.findOne({
      where: { technicianId: profile.id, orderStatus: In(ACTIVE_TRACKING_STATUSES) },
    });
    if (!activeOrder) return;

    this.server.to(`order:${activeOrder.id}`).emit('order:location_updated', {
      order_id: activeOrder.id,
      latitude: body.latitude,
      longitude: body.longitude,
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
  handleOrderStatusChanged(event: OrderStatusChangedEvent): void {
    this.server.to(`order:${event.orderId}`).emit('order:status_changed', {
      order_id: event.orderId,
      previous_status: event.previousStatus,
      new_status: event.newStatus,
    });
  }
}
