import { websocketCorsOriginHandler } from './websocket-cors.util';

// docs/08 §19 بند 21 — كانت فجوة حقيقية: بوابات WebSocket بتثبت cors:{origin:'*'} صراحة في
// الـdecorator بغض النظر عن CORS_ORIGIN، بعكس REST API (main.ts) اللي بيفرضها في الإنتاج.
describe('websocketCorsOriginHandler (docs/08 §19 بند 21)', () => {
  const originalCorsOrigin = process.env.CORS_ORIGIN;

  afterEach(() => {
    if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = originalCorsOrigin;
  });

  it('CORS_ORIGIN فاضي/مش متسجّل — مفتوح للكل (نفس سلوك main.ts في التطوير)', (done) => {
    delete process.env.CORS_ORIGIN;
    websocketCorsOriginHandler('https://evil.example.com', (err, allow) => {
      expect(err).toBeNull();
      expect(allow).toBe(true);
      done();
    });
  });

  it('CORS_ORIGIN مضبوطة — أصل مطابق يتقبل', (done) => {
    process.env.CORS_ORIGIN = 'https://admin.baytak.com,https://baytak.com';
    websocketCorsOriginHandler('https://admin.baytak.com', (err, allow) => {
      expect(err).toBeNull();
      expect(allow).toBe(true);
      done();
    });
  });

  it('CORS_ORIGIN مضبوطة — أصل غير مطابق يترفض', (done) => {
    process.env.CORS_ORIGIN = 'https://admin.baytak.com,https://baytak.com';
    websocketCorsOriginHandler('https://evil.example.com', (err, allow) => {
      expect(err).toBeNull();
      expect(allow).toBe(false);
      done();
    });
  });

  it('CORS_ORIGIN مضبوطة — اتصال بلا Origin header (زي عميل Flutter/native) بيتقبل', (done) => {
    process.env.CORS_ORIGIN = 'https://admin.baytak.com';
    websocketCorsOriginHandler(undefined, (err, allow) => {
      expect(err).toBeNull();
      expect(allow).toBe(true);
      done();
    });
  });
});
