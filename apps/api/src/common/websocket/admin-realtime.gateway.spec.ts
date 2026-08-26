import { AdminRealtimeGateway } from './admin-realtime.gateway';

describe('AdminRealtimeGateway', () => {
  const payload = { sub: 'admin-user-id', userType: 'admin' };
  const realtimeAccess = {
    authenticate: jest.fn().mockResolvedValue(payload),
    assertActive: jest.fn().mockResolvedValue(undefined),
  };
  const sessions = {
    register: jest.fn(),
    unregister: jest.fn(),
    disconnectUser: jest.fn(),
  };
  const dataSource = {
    query: jest.fn().mockResolvedValue([{ exists: true }]),
  };

  function createClient() {
    return {
      data: {},
      handshake: { auth: { token: 'valid-token' } },
      join: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
  }

  beforeEach(() => jest.clearAllMocks());

  it('registers the authenticated admin and joins every permitted topic', async () => {
    const gateway = new AdminRealtimeGateway(realtimeAccess as never, sessions as never, dataSource as never);
    const client = createClient();

    await gateway.handleConnection(client as never);
    const result = await gateway.handleSubscribe(client as never) as { topics: string[]; denied: string[] };

    expect(sessions.register).toHaveBeenCalledWith(payload.sub, client);
    expect(client.join).toHaveBeenCalledWith(`admin:user:${payload.sub}`);
    expect(result.denied).toEqual([]);
    expect(result.topics).toContain('orders');
    expect(client.join).toHaveBeenCalledWith('admin:topic:orders');
  });

  it('broadcasts order creation to subscribed admin clients', () => {
    const gateway = new AdminRealtimeGateway(realtimeAccess as never, sessions as never, dataSource as never);
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as never;

    gateway.onOrderCreated({ orderId: 'order-id' } as never);

    expect(to).toHaveBeenCalledWith('admin:topic:orders');
    expect(emit).toHaveBeenCalledWith(
      'admin:live',
      expect.objectContaining({ topic: 'orders', entity: 'order', action: 'created', entity_id: 'order-id' }),
    );
  });

  it('broadcasts project and warranty changes on their permission-scoped topics', () => {
    const gateway = new AdminRealtimeGateway(realtimeAccess as never, sessions as never, dataSource as never);
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as never;

    gateway.onProjectChanged({ projectId: 'project-id', action: 'created' });
    gateway.onWarrantyClaimChanged({ claimId: 'claim-id', action: 'opened' });

    expect(to).toHaveBeenCalledWith('admin:topic:projects');
    expect(to).toHaveBeenCalledWith('admin:topic:warranty');
    expect(emit).toHaveBeenCalledWith(
      'admin:live',
      expect.objectContaining({ topic: 'projects', entity_id: 'project-id', action: 'created' }),
    );
    expect(emit).toHaveBeenCalledWith(
      'admin:live',
      expect.objectContaining({ topic: 'warranty', entity_id: 'claim-id', action: 'opened' }),
    );
  });
});
