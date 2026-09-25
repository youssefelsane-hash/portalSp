import { throttleIdentityForRequest } from './identity-throttler.guard';

describe('throttleIdentityForRequest', () => {
  it('يحد تسجيل PIN بالـIP حتى تغيير رقم الهاتف لا يفتح رصيدًا جديدًا', () => {
    const first = throttleIdentityForRequest({
      ip: '203.0.113.9',
      originalUrl: '/api/v1/auth/pin/register',
      body: { phone_number: '+201000000001' },
    });
    const second = throttleIdentityForRequest({
      ip: '203.0.113.9',
      originalUrl: '/api/v1/auth/pin/register?source=app',
      body: { phone_number: '+201000000002' },
    });

    expect(first).toBe('registration-ip:203.0.113.9');
    expect(second).toBe(first);
  });

  it('يحد تخمين الدخول حسب الرقم حتى تغيير الشبكة لا يفتح رصيدًا جديدًا', () => {
    const first = throttleIdentityForRequest({
      ip: '203.0.113.9',
      originalUrl: '/api/v1/auth/pin/login',
      body: { phone_number: '+201000000001' },
    });
    const second = throttleIdentityForRequest({
      ip: '198.51.100.7',
      originalUrl: '/api/v1/auth/pin/login',
      body: { phone_number: '+201000000001' },
    });

    expect(first).toMatch(/^phone:[a-f0-9]{32}$/);
    expect(second).toBe(first);
  });

  it('يستخدم الـIP للمسارات التي لا تحمل رقم هاتف', () => {
    expect(
      throttleIdentityForRequest({ ip: '203.0.113.9', originalUrl: '/api/v1/health' }),
    ).toBe('ip:203.0.113.9');
  });
});
