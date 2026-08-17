import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Socket } from 'socket.io';
import { User, UserType } from '../../modules/auth/entities/user.entity';
import { RealtimeAccessService } from './realtime-access.service';
import { RealtimeSessionRegistry } from './realtime-session-registry.service';

describe('Realtime access revocation (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let registryA: RealtimeSessionRegistry;
  let registryB: RealtimeSessionRegistry;
  let userId = '';
  let roleId = '';
  let permissionId = '';

  const runId = Date.now().toString(36);
  const secret = 'realtime-test-access-secret-0123456789';

  function registeredSocket(registry: RealtimeSessionRegistry): {
    socket: Socket;
    disconnected: Promise<void>;
  } {
    let resolveDisconnect: () => void;
    const disconnected = new Promise<void>((resolve) => {
      resolveDisconnect = resolve;
    });
    const socket = {
      id: `socket-${Math.random()}`,
      emit: jest.fn(),
      disconnect: jest.fn(() => resolveDisconnect()),
    } as unknown as Socket;
    registry.register(userId, socket);
    return { socket, disconnected };
  }

  async function expectPromptDisconnect(disconnected: Promise<void>): Promise<void> {
    let timer: NodeJS.Timeout;
    await Promise.race([
      disconnected,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('realtime revocation notification timeout')), 2_000);
      }),
    ]).finally(() => clearTimeout(timer!));
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User],
    });
    await dataSource.initialize();
    registryA = new RealtimeSessionRegistry(dataSource);
    registryB = new RealtimeSessionRegistry(dataSource);
    await Promise.all([registryA.onModuleInit(), registryB.onModuleInit()]);

    const [user] = await dataSource.query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2016${runId}`.slice(0, 15), `Realtime admin ${runId}`],
    );
    userId = user.id;
    const [role] = await dataSource.query(
      `INSERT INTO roles (name, display_name, is_system) VALUES ($1,$2,false) RETURNING id`,
      [`realtime_${runId}`, `Realtime ${runId}`],
    );
    roleId = role.id;
    const [permission] = await dataSource.query(
      `INSERT INTO permissions (name, resource, action) VALUES ($1,'support_tickets','manage') RETURNING id`,
      [`realtime.support.${runId}`],
    );
    permissionId = permission.id;
    await dataSource.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)`, [userId, roleId]);
    await dataSource.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)`, [roleId, permissionId]);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);
    await dataSource.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
    await dataSource.query(`DELETE FROM permissions WHERE id = $1`, [permissionId]);
    await dataSource.query(`DELETE FROM roles WHERE id = $1`, [roleId]);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await Promise.all([registryA.onModuleDestroy(), registryB.onModuleDestroy()]);
    await dataSource.destroy();
  });

  it('rejects a still-valid JWT when the live account is blocked', async () => {
    const jwt = new JwtService();
    const config = { get: () => secret } as unknown as ConfigService;
    const access = new RealtimeAccessService(dataSource.getRepository(User), jwt, config);
    const token = jwt.sign({ sub: userId, userType: UserType.ADMIN, amr: ['otp'] }, { secret, expiresIn: '5m' });

    await expect(access.authenticate(token)).resolves.toMatchObject({ sub: userId });
    await dataSource.query(`UPDATE users SET is_blocked = true WHERE id = $1`, [userId]);
    await expect(access.authenticate(token)).rejects.toMatchObject({ code: 'AUTH_001' });
    await dataSource.query(`UPDATE users SET is_blocked = false WHERE id = $1`, [userId]);
  });

  it('disconnects the same active user on every listening API instance after account revocation commits', async () => {
    const first = registeredSocket(registryA);
    const second = registeredSocket(registryB);

    await dataSource.query(`UPDATE users SET is_blocked = true WHERE id = $1`, [userId]);
    await Promise.all([expectPromptDisconnect(first.disconnected), expectPromptDisconnect(second.disconnected)]);

    expect(first.socket.disconnect).toHaveBeenCalledWith(true);
    expect(second.socket.disconnect).toHaveBeenCalledWith(true);
    await dataSource.query(`UPDATE users SET is_blocked = false WHERE id = $1`, [userId]);
  });

  it('disconnects protected-room sockets when a role permission is revoked', async () => {
    const active = registeredSocket(registryA);
    await dataSource.query(`DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2`, [
      roleId,
      permissionId,
    ]);
    await expectPromptDisconnect(active.disconnected);
    expect(active.socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ code: 'AUTH_001' }));
  });
});
