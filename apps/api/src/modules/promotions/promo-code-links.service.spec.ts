import { SettingsService } from '../settings/settings.service';
import { PromoCodeLinksService, appendPromoLinkCode } from './promo-code-links.service';

describe('PromoCodeLinksService smart links', () => {
  const settings = {
    getString: jest.fn(),
  } as unknown as SettingsService;
  const service = new PromoCodeLinksService({} as never, {} as never, {} as never, settings);

  beforeEach(() => jest.clearAllMocks());

  it('يحافظ على query موجودة وهو يمرر الكود إلى رحلة العميل', () => {
    expect(appendPromoLinkCode('https://customer.example/services?source=qr', 'SAVE_20')).toBe(
      'https://customer.example/services?source=qr&p=SAVE_20',
    );
  });

  it('لا يضيف كودًا منتهيًا أو موقوفًا إلى وجهة العميل', async () => {
    jest.mocked(settings.getString).mockResolvedValueOnce('').mockResolvedValueOnce('').mockResolvedValueOnce('https://customer.example/');

    await expect(service.resolveDestination('web', '')).resolves.toBe('https://customer.example/');
  });

  it('يصنف المتصفحات والتطبيقات بلا حفظ user agent أو أي معرف جهاز', () => {
    expect(service.detectPlatform('Mozilla/5.0 (Linux; Android 14)')).toBe('android');
    expect(service.detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)')).toBe('ios');
    expect(service.detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1')).toBe('web');
    expect(service.detectPlatform(undefined)).toBe('other');
  });
});
