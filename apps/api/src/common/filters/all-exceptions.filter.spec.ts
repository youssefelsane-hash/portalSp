import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { AllExceptionsFilter } from './all-exceptions.filter';

function hostOf() {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn() };
  const request = { requestId: 'req-test', method: 'GET', originalUrl: '/api/v1/orders/not-a-uuid' };
  return {
    response,
    host: {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    } as unknown as ArgumentsHost,
  };
}

describe('AllExceptionsFilter', () => {
  it('turns throttling into an Arabic retryable response', () => {
    const { host, response } = hostOf();
    new AllExceptionsFilter().catch(new ThrottlerException(), host);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    expect(response.json.mock.calls[0][0].error.message).toMatch(/[\u0600-\u06FF]/);
  });

  it('maps pool exhaustion to 503 without exposing the driver error', () => {
    const { host, response } = hostOf();
    new AllExceptionsFilter().catch(Object.assign(new Error('timeout exceeded when trying to connect'), { code: 'ETIMEDOUT' }), host);
    expect(response.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '5');
    expect(response.json.mock.calls[0][0].error.message).toBe('النظام مزحوم شوية دلوقتي — جرّب كمان شوية');
  });

  it('does not leak ParseUUIDPipe text', () => {
    const { host, response } = hostOf();
    new AllExceptionsFilter().catch(new HttpException('Validation failed (uuid is expected)', HttpStatus.BAD_REQUEST), host);
    expect(response.json.mock.calls[0][0].error.message).toBe('اللينك ده مش صحيح أو قديم');
  });
});
