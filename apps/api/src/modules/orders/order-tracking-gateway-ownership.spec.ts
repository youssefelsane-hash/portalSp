import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { Server as SocketIoServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { OrderTrackingGateway } from './order-tracking.gateway';
import { Order } from './entities/order.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { User, UserType } from '../auth/entities/user.entity';

// اختبار حي ضد Postgres حقيقي + اتصال WebSocket حقيقي (مش mock) — بيثبت إصلاح فجوة موثّقة
// صراحة (docs/08 §19 بند 21): "room-ownership-after-reconnect" — كان مفيش أي اختبار خالص لـ
// OrderTrackingGateway/ChatGateway (صفر *.gateway.spec.ts في المشروع كله قبل كده). الاختبار ده
// بيثبت 3 حاجات حقيقية: (1) الفحص الأمني (isCustomer/isTechnician) بيرفض فعليًا مالك مش صحيح،
// (2) نفس الفحص بيتطبّق تاني بعد "إعادة اتصال" (اتصال جديد بنفس التوكن — مفيش cache/تخطي)،
// (3) query-string token fallback اتشال فعليًا (اتصال بـquery.token بس بيترفض).
describe('OrderTrackingGateway — room ownership + reconnect (docs/08 §19 بند 21)', () => {
  let dataSource: DataSource;
  let gateway: OrderTrackingGateway;
  let httpServer: HttpServer;
  let ioServer: SocketIoServer;
  let jwt: JwtService;
  let port: number;

  const runId = Date.now().toString(36);
  const ids = {
    ownerUser: '',
    ownerProfile: '',
    strangerUser: '',
    strangerProfile: '',
    service: '',
    address: '',
    category: '',
    order: '',
  };

  const ACCESS_SECRET = 'test-ws-access-secret-0123456789';

  function signToken(userId: string, userType: UserType): string {
    return jwt.sign({ sub: userId, userType, amr: ['otp'] }, { secret: ACCESS_SECRET, expiresIn: '5m' });
  }

  function connectClient(token?: string, opts: { asQuery?: boolean } = {}): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const authPayload = token && !opts.asQuery ? { token } : {};
      const query = token && opts.asQuery ? { token } : {};
      const client = ioClient(`http://localhost:${port}/tracking`, {
        auth: authPayload,
        query,
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

  function waitForEvent<T = unknown>(client: ClientSocket, event: string): Promise<T> {
    return new Promise((resolve) => client.once(event, (data: T) => resolve(data)));
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, CustomerProfile, TechnicianProfile, User],
    });
    await dataSource.initialize();

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [ownerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2019${runId}o`.slice(0, 15), `عميل مالك ${runId}`],
    );
    ids.ownerUser = ownerUser.id;
    const [ownerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [
      ids.ownerUser,
    ]);
    ids.ownerProfile = ownerProfile.id;

    const [strangerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2019${runId}s`.slice(0, 15), `عميل غريب ${runId}`],
    );
    ids.strangerUser = strangerUser.id;
    const [strangerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [
      ids.strangerUser,
    ]);
    ids.strangerProfile = strangerProfile.id;

    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة تتبع ${runId}`, `Tracking Category ${runId}`, `tracking-category-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة تتبع ${runId}`, `tracking-service-${runId}`],
    );
    ids.service = serviceRow.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.ownerUser, `شارع تتبع ${runId}`],
    );
    ids.address = address.id;
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, order_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,'accepted',0,0) RETURNING id`,
      [`TESTWS-${runId}`.slice(0, 24), ids.ownerProfile, ids.service, ids.address],
    );
    ids.order = order.id;

    jwt = new JwtService();
    const configStub = {
      get: (key: string) => (key === 'jwt.accessSecret' ? ACCESS_SECRET : undefined),
    } as unknown as ConfigService;

    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never,
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    gateway = new OrderTrackingGateway(
      dataSource.getRepository(Order),
      customerProfilesService,
      techniciansService,
      jwt,
      configStub,
    );

    httpServer = createServer();
    ioServer = new SocketIoServer(httpServer, { cors: { origin: true } });
    const nsp = ioServer.of('/tracking');
    gateway.server = nsp as never;
    nsp.on('connection', (socket) => {
      void gateway.handleConnection(socket as never).then(() => {
        socket.on('tracking:join', (body: { order_id: string }) => {
          void gateway.handleJoin(socket as never, body);
        });
      });
      socket.on('disconnect', () => gateway.handleDisconnect(socket as never));
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    ioServer.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id IN ($1,$2)`, [ids.ownerProfile, ids.strangerProfile]);
    await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.ownerUser, ids.strangerUser]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await dataSource.destroy();
  });

  it('مالك الطلب الحقيقي — ينضم للغرفة بنجاح (tracking:joined)', async () => {
    const client = await connectClient(signToken(ids.ownerUser, UserType.CUSTOMER));
    client.emit('tracking:join', { order_id: ids.order });
    const payload = await waitForEvent<{ order_id: string }>(client, 'tracking:joined');
    expect(payload.order_id).toBe(ids.order);
    client.disconnect();
  });

  it('عميل غريب (مش صاحب الطلب) — بيترفض بـerror، ميقدرش ينضم للغرفة', async () => {
    const client = await connectClient(signToken(ids.strangerUser, UserType.CUSTOMER));
    client.emit('tracking:join', { order_id: ids.order });
    const payload = await waitForEvent<{ code: string }>(client, 'error');
    expect(payload.code).toBe('AUTH_001');
    client.disconnect();
  });

  it('إعادة اتصال (reconnect) — نفس الفحص الأمني بيتطبّق تاني، مش بيتخطّى بأي cache/حالة قديمة', async () => {
    // اتصال أول (زي أي جلسة سابقة) وقفل
    const first = await connectClient(signToken(ids.ownerUser, UserType.CUSTOMER));
    first.emit('tracking:join', { order_id: ids.order });
    await waitForEvent(first, 'tracking:joined');
    first.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // "إعادة اتصال" حقيقية — socket.id جديد تمامًا (نفس سلوك تطبيق Flutter بعد فقد الشبكة لحظيًا)
    const reconnected = await connectClient(signToken(ids.ownerUser, UserType.CUSTOMER));
    reconnected.emit('tracking:join', { order_id: ids.order });
    const payload = await waitForEvent<{ order_id: string }>(reconnected, 'tracking:joined');
    expect(payload.order_id).toBe(ids.order);
    reconnected.disconnect();

    // وبعد إعادة الاتصال، الغريب لسه بيترفض — الفحص مش بيضعف/يتخطّى مع الوقت
    const stranger = await connectClient(signToken(ids.strangerUser, UserType.CUSTOMER));
    stranger.emit('tracking:join', { order_id: ids.order });
    const strangerPayload = await waitForEvent<{ code: string }>(stranger, 'error');
    expect(strangerPayload.code).toBe('AUTH_001');
    stranger.disconnect();
  });

  // ملاحظة مهمة عن التوقيت: socket.io بيأكّد الاتصال على مستوى الـtransport (event 'connect' عند
  // العميل) فورًا وقت الـhandshake — قبل ما منطق التطبيق (handleConnection هنا) يتنفّذ أصلاً. يعني
  // اتصال بتوكن غلط/غايب برضه بيوصله 'connect' الأول، وبعده بلحظات السيرفر بيرفضه فعليًا
  // (`client.emit('error', ...)` ثم `client.disconnect(true)`). فالتأكيد الصح مش "الاتصال اترفض"
  // (هيتقبل مؤقتًا دايمًا)، لكن "السيرفر رفضه بعد كده وقطعه فعليًا" — بنستنى 'disconnect' الحقيقي.
  function expectRejectedByServer(token: string | undefined, opts: { asQuery?: boolean } = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const authPayload = token && !opts.asQuery ? { token } : {};
      const query = token && opts.asQuery ? { token } : {};
      const client = ioClient(`http://localhost:${port}/tracking`, {
        auth: authPayload,
        query,
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        timeout: 3000,
      });
      const timer = setTimeout(() => {
        client.disconnect();
        reject(new Error('السيرفر ماقطعش الاتصال خلال المهلة — المفروض يترفض'));
      }, 3000);
      client.on('disconnect', () => {
        clearTimeout(timer);
        resolve();
      });
      client.on('connect_error', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  it('توكن في query string بس (بدون auth.token) — السيرفر بيرفضه ويقطع الاتصال (بند 21: الـfallback اتشال)', async () => {
    await expectRejectedByServer(signToken(ids.ownerUser, UserType.CUSTOMER), { asQuery: true });
  });

  it('بلا توكن خالص — السيرفر بيرفضه ويقطع الاتصال', async () => {
    await expectRejectedByServer(undefined);
  });
});
