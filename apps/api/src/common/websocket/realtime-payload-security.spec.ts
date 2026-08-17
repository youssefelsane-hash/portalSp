import { ArgumentMetadata } from '@nestjs/common';
import { RealtimeSessionRegistry } from './realtime-session-registry.service';
import { StrictWebsocketValidationPipe } from './strict-websocket-validation.pipe';
import { TechnicianLocationEventDto } from '../../modules/orders/dto/tracking-socket.dto';

describe('Realtime payload validation and abuse control', () => {
  const metadata: ArgumentMetadata = { type: 'body', metatype: TechnicianLocationEventDto };

  it.each([
    [{ latitude: '30', longitude: 31 }],
    [{ latitude: Number.NaN, longitude: 31 }],
    [{ latitude: Number.POSITIVE_INFINITY, longitude: 31 }],
    [{ latitude: 91, longitude: 31 }],
    [{ latitude: 30, longitude: -181 }],
    [{ latitude: 30 }],
    [{ latitude: 30, longitude: 31, injected: true }],
  ])('rejects malformed or unsafe location payload %#', async (payload) => {
    const pipe = new StrictWebsocketValidationPipe();
    await expect(pipe.transform(payload, metadata)).rejects.toBeDefined();
  });

  it('accepts finite numeric coordinates in range', async () => {
    const result = await new StrictWebsocketValidationPipe().transform({ latitude: 30.05, longitude: 31.25 }, metadata);
    expect(result).toMatchObject({ latitude: 30.05, longitude: 31.25 });
  });

  it('limits a socket to ten location updates per ten-second window', () => {
    const registry = new RealtimeSessionRegistry({} as never);
    for (let i = 0; i < 10; i++) {
      expect(registry.consumeRateLimit('socket-1', 'technician:location', 10, 10_000)).toBe(true);
    }
    expect(registry.consumeRateLimit('socket-1', 'technician:location', 10, 10_000)).toBe(false);
  });
});
