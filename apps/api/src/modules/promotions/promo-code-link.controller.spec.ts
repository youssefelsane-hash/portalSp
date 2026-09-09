import { PromoCodeLinkController } from './promo-code-link.controller';

describe('PromoCodeLinkController', () => {
  it('يسجل زيارة الرابط الصالح ثم يحوّل إلى رحلة العميل بالكود', async () => {
    const links = {
      detectPlatform: jest.fn().mockReturnValue('web'),
      findActiveByCode: jest.fn().mockResolvedValue({ id: 'promo-id', code: 'SAVE20', discountEnabled: true }),
      recordHit: jest.fn().mockResolvedValue(undefined),
      resolveDestination: jest.fn().mockResolvedValue('https://customer.example/?p=SAVE20'),
    };
    const redirect = jest.fn();
    const controller = new PromoCodeLinkController(links as never);

    await controller.follow('save20', 'Mozilla/5.0', { redirect } as never);

    expect(links.recordHit).toHaveBeenCalledWith('promo-id', 'web');
    expect(links.resolveDestination).toHaveBeenCalledWith('web', 'SAVE20', true);
    expect(redirect).toHaveBeenCalledWith(302, 'https://customer.example/?p=SAVE20');
  });

  it('لا يعرض خطأ للزائر إن كان الرابط موقوفًا، ولا يضيف كودًا موقوفًا للرحلة', async () => {
    const links = {
      detectPlatform: jest.fn().mockReturnValue('web'),
      findActiveByCode: jest.fn().mockResolvedValue(null),
      recordHit: jest.fn(),
      resolveDestination: jest.fn().mockResolvedValue('https://customer.example/'),
    };
    const redirect = jest.fn();
    const controller = new PromoCodeLinkController(links as never);

    await controller.follow('EXPIRED', undefined, { redirect } as never);

    expect(links.recordHit).not.toHaveBeenCalled();
    expect(links.resolveDestination).toHaveBeenCalledWith('web', '', false);
    expect(redirect).toHaveBeenCalledWith(302, 'https://customer.example/');
  });
});
