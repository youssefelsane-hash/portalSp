import { DataSource } from 'typeorm';
import { Socket } from 'socket.io';
import { RealtimeSessionRegistry } from '../../common/websocket/realtime-session-registry.service';
import { TechnicianActivityService } from './technician-activity.service';

// اختبار حي ضد Postgres حقيقي — تتبع أونلاين/آخر نشاط (docs/08 §35.10، ADR-0021 §6). صفر
// state جديد: online من RealtimeSessionRegistry (in-memory بحت، بلا Redis/DB)، last_active_at
// من MAX(refresh_tokens.last_seen_at) الحقيقي الموجود بالفعل.
describe('TechnicianActivityService — تتبع أونلاين/آخر نشاط (docs/08 §35.10)', () => {
  let dataSource: DataSource;
  let sessionRegistry: RealtimeSessionRegistry;
  let service: TechnicianActivityService;
  const runId = Date.now().toString(36);
  const ids = { userOnline: '', userOffline: '', userNoSession: '' };
  const users: string[] = [];

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
    });
    await dataSource.initialize();
    sessionRegistry = new RealtimeSessionRegistry(dataSource);
    service = new TechnicianActivityService(dataSource, sessionRegistry);

    for (const key of ['userOnline', 'userOffline', 'userNoSession'] as const) {
      const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        `+2043${runId}${key.length}`.slice(0, 15),
        `فني نشاط ${key} ${runId}`,
      ]);
      ids[key] = user.id;
      users.push(user.id);
    }

    // جلستين — واحدة حديثة (userOnline) وواحدة قديمة (userOffline)، userNoSession بلا أي جلسة خالص.
    await q(
      `INSERT INTO refresh_tokens (user_id, token_hash, is_revoked, expires_at, last_seen_at)
       VALUES ($1, $2, false, now() + interval '1 day', now() - interval '2 minutes')`,
      [ids.userOnline, `hash-online-${runId}`],
    );
    await q(
      `INSERT INTO refresh_tokens (user_id, token_hash, is_revoked, expires_at, last_seen_at)
       VALUES ($1, $2, true, now() - interval '1 day', now() - interval '20 days')`,
      [ids.userOffline, `hash-offline-${runId}`],
    );
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])`, [[ids.userOnline, ids.userOffline, ids.userNoSession]]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('getActivityForUser() — فني بلا أي جلسة خالص: online=false، lastActiveAt=null', async () => {
    const activity = await service.getActivityForUser(ids.userNoSession);
    expect(activity.online).toBe(false);
    expect(activity.lastActiveAt).toBeNull();
  });

  it('getActivityForUser() — last_seen_at حقيقي بيرجع كـlastActiveAt حتى لو الجلسة revoked (تاريخ حقيقي مش "متاح دلوقتي")', async () => {
    const activity = await service.getActivityForUser(ids.userOffline);
    expect(activity.online).toBe(false);
    expect(activity.lastActiveAt).not.toBeNull();
    const daysSince = (Date.now() - activity.lastActiveAt!.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysSince).toBeGreaterThan(19);
  });

  it('online — بيتغيّر مع register()/unregister() على RealtimeSessionRegistry، صفر تخزين DB', async () => {
    expect((await service.getActivityForUser(ids.userOnline)).online).toBe(false);

    const fakeSocket = { id: 'sock-1' } as unknown as Socket;
    sessionRegistry.register(ids.userOnline, fakeSocket);
    expect((await service.getActivityForUser(ids.userOnline)).online).toBe(true);
    expect((await service.getActivityForUser(ids.userOnline)).lastActiveAt).not.toBeNull();

    sessionRegistry.unregister(ids.userOnline, fakeSocket);
    expect((await service.getActivityForUser(ids.userOnline)).online).toBe(false);
  });

  it('getActivitySnapshot() — batch لعدة فنيين دفعة واحدة (استعلام واحد)', async () => {
    const snapshot = await service.getActivitySnapshot([ids.userOnline, ids.userOffline, ids.userNoSession]);
    expect(snapshot.size).toBe(3);
    expect(snapshot.get(ids.userNoSession)?.lastActiveAt).toBeNull();
    expect(snapshot.get(ids.userOffline)?.lastActiveAt).not.toBeNull();
  });

  it('getActivitySnapshot([]) — مصفوفة فاضية بترجع Map فاضي بلا استعلام', async () => {
    const snapshot = await service.getActivitySnapshot([]);
    expect(snapshot.size).toBe(0);
  });
});
