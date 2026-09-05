import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { Server as SocketIoServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { RedisIoAdapter } from './redis-io.adapter';

/**
 * **تدقيق C-4 — بث الغرف لازم يعبر بين الـinstances.**
 *
 * الاختبار ده بيبني **سيرفرين Socket.IO مستقلين تمامًا** (كل واحد على بورت لوحده، زي replica
 * منفصلة) وبيوصّلهم بنفس Redis، وبعدين بيتحقق من الحاجة اللي كانت مكسورة بالظبط:
 *
 *   العميل متصل بـ**B**، والحدث اتبعت من **A** ⇒ لازم يوصله.
 *
 * من غير الـadapter ده كان `server.to(room).emit()` بيوصل للـsockets المتصلة بنفس الـprocess بس،
 * فأول ما النظام يتوسّع لأكتر من instance التتبّع والشات ولوحة الأدمن كانوا هيسكتوا **بلا أي
 * خطأ أو لوج** — فشل صامت. الاختبار الأول تحت هو اللي بيفشل على الكود القديم.
 *
 * الاختبار بيستخدم Redis الحقيقي (نفس اللي المشروع شغّال عليه) — مش mock، عشان يثبت السلوك مش
 * النية. لو Redis مش متاح، بيتخطّى نفسه بدل ما يفشل بالغلط.
 */
describe('RedisIoAdapter — بث الغرف بين instances مستقلة (تدقيق C-4)', () => {
  jest.setTimeout(30_000);

  const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const ROOM = `audit-c4-room-${Date.now().toString(36)}`;

  let redisAvailable = true;
  const servers: { http: HttpServer; io: SocketIoServer; port: number }[] = [];
  const redisClients: Redis[] = [];
  const clients: ClientSocket[] = [];

  /** instance مستقلة: HTTP server + Socket.IO server + زوج اتصالات Redis خاص بيها. */
  async function startInstance(): Promise<{ io: SocketIoServer; port: number }> {
    const pub = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
    const sub = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
    // `on('error')` ضروري — من غيره أي خطأ اتصال بيطلع unhandled ويوقّع الـrunner كله.
    pub.on('error', () => undefined);
    sub.on('error', () => undefined);
    redisClients.push(pub, sub);
    await Promise.all([pub.connect(), sub.connect()]);

    const http = createServer();
    const io = new SocketIoServer(http, { cors: { origin: true } });
    io.adapter(createAdapter(pub, sub));
    await new Promise<void>((resolve) => http.listen(0, resolve));
    const port = (http.address() as AddressInfo).port;
    servers.push({ http, io, port });
    return { io, port };
  }

  function connect(port: number): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        timeout: 5000,
      });
      clients.push(client);
      const timer = setTimeout(() => reject(new Error('connect timeout')), 6000);
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

  function waitFor<T>(client: ClientSocket, event: string, timeoutMs = 6000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ماوصلش الحدث "${event}" خلال المهلة`)), timeoutMs);
      client.once(event, (data: T) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  beforeAll(async () => {
    const probe = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    probe.on('error', () => undefined);
    try {
      await probe.connect();
      await probe.ping();
    } catch {
      redisAvailable = false;
    } finally {
      probe.disconnect();
    }
  });

  afterAll(async () => {
    clients.forEach((c) => c.disconnect());
    // `io.close()` بترجّع Promise فعلاً (socket.io v4)، فبننتظرها مباشرة بدل ما نلفّها في
    // callback — اللف كان بيخلّيها floating promise جوّه executor.
    await Promise.all(servers.map(({ io }) => io.close()));
    // `http.close()` بالمقابل callback-based (Node core) فمحتاجة اللف.
    await Promise.all(
      servers.map(({ http }) => new Promise<void>((resolve) => {
        http.close(() => resolve());
      })),
    );
    redisClients.forEach((c) => c.disconnect());
  });

  it('حدث اتبعت من instance A بيوصل لعميل متصل بـinstance B — ده اللي كان مكسور', async () => {
    if (!redisAvailable) return; // Redis مش متاح في البيئة دي — بنتخطّى بدل فشل مضلّل.

    const a = await startInstance();
    const b = await startInstance();

    // العميل متصل بـ**B** بس، ومنضم للغرفة من هناك.
    const clientOnB = await connect(b.port);
    const socketsOnB = await b.io.fetchSockets();
    expect(socketsOnB).toHaveLength(1);
    await socketsOnB[0].join(ROOM);

    const received = waitFor<{ value: string }>(clientOnB, 'cross-instance');
    // البث من **A** — اللي ماعندهاش أي socket في الغرفة دي أصلاً.
    a.io.to(ROOM).emit('cross-instance', { value: 'وصلت' });

    await expect(received).resolves.toEqual({ value: 'وصلت' });
  });

  it('البث المحلي (نفس الـinstance) فاضل شغّال زي ما هو', async () => {
    if (!redisAvailable) return;

    const a = await startInstance();
    const clientOnA = await connect(a.port);
    const sockets = await a.io.fetchSockets();
    await sockets[0].join(ROOM);

    const received = waitFor<{ value: string }>(clientOnA, 'same-instance');
    a.io.to(ROOM).emit('same-instance', { value: 'محلي' });

    await expect(received).resolves.toEqual({ value: 'محلي' });
  });

  describe('التدهور الرشيق لما Redis مش متاح', () => {
    it('`connect()` بترجّع false ومابترميش — الإقلاع لازم يكمّل بالبث المحلي', async () => {
      // بورت مقفول عمدًا. القاعدة الحاكمة (CLAUDE.md): أي فشل infra يتلقّط ويرجع لسلوك آمن،
      // مايكسرش العملية. لو دي رمت، الـAPI كلها مكانتش هتقوم لما Redis يقع — وده أسوأ بكتير
      // من البث المحلي.
      const adapter = new RedisIoAdapter({} as never, 'redis://127.0.0.1:1');
      await expect(adapter.connect()).resolves.toBe(false);
    });
  });
});
