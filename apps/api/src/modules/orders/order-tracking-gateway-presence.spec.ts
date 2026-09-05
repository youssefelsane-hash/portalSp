import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { Server as SocketIoServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { OrderTrackingGateway } from './order-tracking.gateway';
import { ordersServiceForGateway } from './orders.testing';
import { Order } from './entities/order.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { User, UserType } from '../auth/entities/user.entity';
import { RealtimeAccessService } from '../../common/websocket/realtime-access.service';
import { RealtimeSessionRegistry } from '../../common/websocket/realtime-session-registry.service';

// بَقّة حقيقية اتلقطت (بلاغ المالك، 2026-08-21): "أونلاين دلوقتي" (docs/08 §35.10) كان دايمًا
// بيظهر false لكل الفنيين — مش بَقّة في RealtimeSessionRegistry نفسه (مثبت هنا)، المشكلة إن
// apps/technician-app ماكانش بيفتح أي اتصال Socket.IO خالص لحد ما فني يفتح شاشة تنفيذ طلب نشط
// (order_execution_screen.dart)، فمفيش أي socket يتسجّل أصلاً لفني قاعد على الشاشة الرئيسية.
// الإصلاح (main.dart's _AuthGate): اتصال "حضور" بلا order_id بمجرد تسجيل الدخول. الاختبار ده
// بيثبت إن الاتصال ده لوحده (من غير tracking:join خالص) كافي يسجّل الفني أونلاين فعليًا في
// RealtimeSessionRegistry الحقيقي (مش mock زي order-tracking-gateway-ownership.spec.ts).
describe('OrderTrackingGateway — اتصال حضور بلا order_id يسجّل الفني أونلاين (docs/08 §35.10)', () => {
  let dataSource: DataSource;
  let gateway: OrderTrackingGateway;
  let sessionRegistry: RealtimeSessionRegistry;
  let httpServer: HttpServer;
  let ioServer: SocketIoServer;
  let jwt: JwtService;
  let events: EventEmitter2;
  let port: number;

  const runId = Date.now().toString(36);
  const ids = { technicianUser: '', technicianProfile: '' };

  const ACCESS_SECRET = 'test-ws-presence-secret-0123456789';

  function signToken(userId: string): string {
    return jwt.sign({ sub: userId, userType: UserType.TECHNICIAN, amr: ['otp'] }, { secret: ACCESS_SECRET, expiresIn: '5m' });
  }

  function connectClient(token: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://localhost:${port}/tracking`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        timeout: 3000,
      });
      const timer = setTimeout(() => reject(new Error('connect timeout')), 4000);
      client.on('connect', () => {
        clearTimeout(timer);
        resolve(client);
      });
      client.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, CustomerProfile, TechnicianProfile, User],
    });
    await dataSource.initialize();

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [technicianUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2020${runId}`.slice(0, 15),
      `فني حضور ${runId}`,
    ]);
    ids.technicianUser = technicianUser.id;
    const [technicianProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status) VALUES ($1,$2,'new','approved') RETURNING id`,
      [ids.technicianUser, `PRESENCE${runId}`.slice(0, 20)],
    );
    ids.technicianProfile = technicianProfile.id;

    jwt = new JwtService();
    const configStub = {
      get: (key: string) => (key === 'jwt.accessSecret' ? ACCESS_SECRET : undefined),
    } as unknown as ConfigService;

    // RealtimeSessionRegistry الحقيقي بالكامل — مش mock، عشان isUserOnline() تتفحص فعليًا مش
    // بس تتأكد إن register() اتنادت.
    sessionRegistry = new RealtimeSessionRegistry(dataSource);
    await sessionRegistry.onModuleInit();
    events = new EventEmitter2();

    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never,
      {} as never,
      {} as never,
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    gateway = new OrderTrackingGateway(
      dataSource.getRepository(Order),
      customerProfilesService,
      techniciansService,
      // `OrdersService` حقيقية (بنفس نمط البناء المختصر المتّبع في specs الموديول) — الـgateway
      // بقى بيسأل منها عن الانتماء والطلبات الجارية، فتمرير stub كان هيخفي المنطق اللي بنختبره.
      ordersServiceForGateway(dataSource),
      new RealtimeAccessService(dataSource.getRepository(User), jwt, configStub),
      sessionRegistry,
      events,
    );

    httpServer = createServer();
    ioServer = new SocketIoServer(httpServer, { cors: { origin: true } });
    const nsp = ioServer.of('/tracking');
    gateway.server = nsp as never;
    nsp.on('connection', (socket) => {
      const authentication = gateway.handleConnection(socket as never);
      socket.on('tracking:join', (body: { order_id: string }) => {
        void authentication.then(() => gateway.handleJoin(socket as never, body));
      });
      socket.on('disconnect', () => gateway.handleDisconnect(socket as never));
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await ioServer.close(); // `close()` بيرجع Promise في socket.io v4 — من غير await الـteardown بيسيب socket مفتوح
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await sessionRegistry.onModuleDestroy();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technicianProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.technicianUser]);
    await dataSource.destroy();
  });

  it('قبل أي اتصال — الفني أوفلاين', () => {
    expect(sessionRegistry.isUserOnline(ids.technicianUser)).toBe(false);
  });

  it('اتصال بلا order_id وبلا أي tracking:join خالص — كافي لوحده يسجّل الفني أونلاين', async () => {
    const client = await connectClient(signToken(ids.technicianUser));
    // مهلة صغيرة عشان handleConnection's async authentication يكمل فعليًا (نفس تعليق
    // order-tracking-gateway-ownership.spec.ts عن توقيت 'connect' مقابل تنفيذ منطق التطبيق).
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sessionRegistry.isUserOnline(ids.technicianUser)).toBe(true);
    client.disconnect();
  });

  it('بعد قطع الاتصال — الفني بيرجع أوفلاين تاني', async () => {
    const client = await connectClient(signToken(ids.technicianUser));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sessionRegistry.isUserOnline(ids.technicianUser)).toBe(true);
    client.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sessionRegistry.isUserOnline(ids.technicianUser)).toBe(false);
  });

  it('اتصالين متزامنين (نفس الفني — presence + tracking فعلي) — لسه أونلاين لحد ما الاتنين يتقطعوا', async () => {
    const transitions: boolean[] = [];
    const listener = (event: { userId: string; online: boolean }) => {
      if (event.userId === ids.technicianUser) transitions.push(event.online);
    };
    events.on('technician.presence_changed', listener);
    const presence = await connectClient(signToken(ids.technicianUser));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const tracking = await connectClient(signToken(ids.technicianUser));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sessionRegistry.isUserOnline(ids.technicianUser)).toBe(true);

    presence.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 200));
    // اتصال presence اتقطع بس tracking لسه شغال — لازم يفضل أونلاين (Set مش قيمة واحدة).
    expect(sessionRegistry.isUserOnline(ids.technicianUser)).toBe(true);

    tracking.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sessionRegistry.isUserOnline(ids.technicianUser)).toBe(false);
    expect(transitions).toEqual([true, false]);
    events.off('technician.presence_changed', listener);
  });
});
