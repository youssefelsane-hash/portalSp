import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { NotificationChannel } from '../../modules/notifications/entities/notification.entity';
import { CequensSmsDispatcher } from './cequens-sms-dispatcher.service';
import { DispatchNotificationInput } from './notification-dispatcher';
import { selectSmsDispatcher } from './sms-dispatcher.provider';
import { SmsDispatcher } from './sms-dispatcher';
import { TwilioSmsDispatcher } from './twilio-sms-dispatcher.service';

// كل القيم هنا **وهمية** بالكامل — مفيش أي بيانات اعتماد حقيقية في الريبو (قاعدة §15).
const FAKE_API_KEY = 'fake-cequens-api-key';
const FAKE_SENDER = 'OSTA';
const OTP_CODE = '482913';

function configOf(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function otpInput(phone = '+201000000000'): DispatchNotificationInput {
  return {
    notificationId: null,
    userId: '',
    channel: NotificationChannel.SMS,
    titleAr: 'كود التحقق — OSTA',
    bodyAr: `كودك: ${OTP_CODE} — صالح لمدة 5 دقيقة.`,
    deepLink: null,
    targets: [phone],
    notificationType: 'otp',
  };
}

describe('CequensSmsDispatcher', () => {
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const okResponse = () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) }) as unknown as Response;

  it('مش مُعدّ من غير بيانات اعتماد — المستهلك بيرجع log-only بدل ما ينهار', async () => {
    const dispatcher = new CequensSmsDispatcher(configOf({}));
    expect(dispatcher.isConfigured).toBe(false);
    const result = await dispatcher.send(otpInput());
    expect(result.delivered).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('مفتاح API بلا اسم مُرسِل = مش مُعدّ — CEQUENS بيرفض أي رسالة من غير Sender ID معتمد', () => {
    const dispatcher = new CequensSmsDispatcher(configOf({ 'notifications.cequens.apiKey': FAKE_API_KEY }));
    expect(dispatcher.isConfigured).toBe(false);
  });

  it('مفتاح API جاهز بيتبعت كـBearer مباشرةً بلا أي نداء توكن', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const dispatcher = new CequensSmsDispatcher(
      configOf({
        'notifications.cequens.apiKey': FAKE_API_KEY,
        'notifications.cequens.senderName': FAKE_SENDER,
        'notifications.cequens.baseUrl': 'https://apis.example.test/sms/v1',
      }),
    );
    expect(dispatcher.isConfigured).toBe(true);

    const result = await dispatcher.send(otpInput());
    expect(result).toEqual({ delivered: true, failureReason: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://apis.example.test/sms/v1/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_API_KEY}`);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.senderName).toBe(FAKE_SENDER);
    expect(body.messageType).toBe('text');
    // **من غير '+'** — الشكل اللي أمثلة CEQUENS بتستخدمه، وهو الافتراضي
    // (`CEQUENS_RECIPIENT_FORMAT=msisdn`). التحويل نفسه مغطّى في `cequens-contract.spec.ts`.
    expect(body.recipients).toBe('201000000000');
    expect(String(body.messageText)).toContain(OTP_CODE);
  });

  it('مسار OAuth: بيجيب توكن مرة واحدة ويعيد استخدامه في الإرسال التاني', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
        text: async () => '',
      } as unknown as Response)
      .mockResolvedValue(okResponse());

    const dispatcher = new CequensSmsDispatcher(
      configOf({
        'notifications.cequens.clientId': 'fake-client',
        'notifications.cequens.clientSecret': 'fake-secret',
        'notifications.cequens.username': 'fake-user',
        'notifications.cequens.password': 'fake-pass',
        'notifications.cequens.senderName': FAKE_SENDER,
        'notifications.cequens.authUrl': 'https://apis.example.test/auth/v1/tokens',
      }),
    );

    expect((await dispatcher.send(otpInput())).delivered).toBe(true);
    expect((await dispatcher.send(otpInput())).delivered).toBe(true);

    // نداء توكن واحد + إرسالين = 3 (مش 4) — الكاش شغال.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe('https://apis.example.test/auth/v1/tokens');
    const sendInit = (fetchMock.mock.calls[2] as [string, RequestInit])[1];
    expect((sendInit.headers as Record<string, string>).Authorization).toBe('Bearer fake-token');
  });

  it('رفض من المزوّد بيرجع فشل معلن — ومابيرميش (مسار الـOTP مايتعطّلش)', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized', json: async () => ({}) } as unknown as Response);
    const dispatcher = new CequensSmsDispatcher(
      configOf({ 'notifications.cequens.apiKey': FAKE_API_KEY, 'notifications.cequens.senderName': FAKE_SENDER }),
    );
    const result = await dispatcher.send(otpInput());
    expect(result.delivered).toBe(false);
    expect(result.failureReason).toContain('401');
  });

  it('اللوج مابيحتويش على كود الـOTP ولا مفتاح API ولا الرقم كامل — قاعدة §9/§15', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'server error', json: async () => ({}) } as unknown as Response);

    const dispatcher = new CequensSmsDispatcher(
      configOf({ 'notifications.cequens.apiKey': FAKE_API_KEY, 'notifications.cequens.senderName': FAKE_SENDER }),
    );
    await dispatcher.send(otpInput('+201234567890'));

    const written = [...errorSpy.mock.calls, ...warnSpy.mock.calls, ...logSpy.mock.calls].flat().join(' ');
    expect(written).not.toContain(OTP_CODE);
    expect(written).not.toContain(FAKE_API_KEY);
    expect(written).not.toContain('+201234567890');
  });
});

describe('selectSmsDispatcher — اختيار المزوّد وقت التركيب', () => {
  const configured = (name: string): SmsDispatcher => ({
    isConfigured: true,
    providerName: name,
    send: jest.fn(),
  });
  const unconfigured = (name: string): SmsDispatcher => ({
    isConfigured: false,
    providerName: name,
    send: jest.fn(),
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const select = (provider: string | undefined, twilio: SmsDispatcher, cequens: SmsDispatcher) =>
    selectSmsDispatcher(
      configOf({ 'notifications.smsProvider': provider }),
      twilio as unknown as TwilioSmsDispatcher,
      cequens as unknown as CequensSmsDispatcher,
    );

  it('الافتراضي (مفيش SMS_PROVIDER) = CEQUENS', () => {
    expect(select(undefined, configured('twilio'), configured('cequens')).providerName).toBe('cequens');
  });

  it('SMS_PROVIDER=twilio بيختار Twilio', () => {
    expect(select('twilio', configured('twilio'), configured('cequens')).providerName).toBe('twilio');
  });

  it('المزوّد المختار مش مُعدّ والتاني مُعدّ = رجوع للتاني بتحذير — كود التحقق يفضل بيوصل', () => {
    expect(select('cequens', configured('twilio'), unconfigured('cequens')).providerName).toBe('twilio');
  });

  it('الاتنين مش مُعدّين = بيرجّع المختار وهو غير مُعدّ (المستهلك بيروح log-only)', () => {
    const chosen = select('cequens', unconfigured('twilio'), unconfigured('cequens'));
    expect(chosen.providerName).toBe('cequens');
    expect(chosen.isConfigured).toBe(false);
  });
});
