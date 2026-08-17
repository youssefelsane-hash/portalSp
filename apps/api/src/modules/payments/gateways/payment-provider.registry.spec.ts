import { PaymentMethod } from '../entities/payment.entity';
import { PaymentProvider } from './payment-provider.interface';
import { PaymentProviderRegistry } from './payment-provider.registry';

// Script 2 Part I (findings #46/#47) — listAll() هي مصدر الحقيقة اللي endpoint /payment-channels
// بيعتمد عليه، لازم يعكس isConfigured الحقيقي لكل provider بالظبط، صفر افتراضات.
function fakeProvider(providerKey: string, isConfigured: boolean): PaymentProvider {
  return { providerKey, isConfigured } as PaymentProvider;
}

describe('PaymentProviderRegistry.listAll — Script 2 Part I', () => {
  it('بيرجّع كل الطرق المسجّلة بحالة isConfigured الحقيقية بتاعت كل واحدة', () => {
    const registry = new PaymentProviderRegistry(
      fakeProvider('paymob', false) as never,
      fakeProvider('cash', true) as never,
      fakeProvider('wallet', true) as never,
      fakeProvider('instapay', false) as never,
      fakeProvider('fawry', false) as never,
    );

    const list = registry.listAll();
    expect(list).toEqual(
      expect.arrayContaining([
        { method: PaymentMethod.CARD, isConfigured: false },
        { method: PaymentMethod.CASH, isConfigured: true },
        { method: PaymentMethod.WALLET, isConfigured: true },
        { method: PaymentMethod.INSTAPAY, isConfigured: false },
        { method: PaymentMethod.FAWRY_REFERENCE, isConfigured: false },
      ]),
    );
    expect(list).toHaveLength(5);
  });

  it('لو Paymob اتفعّل، القايمة بتعكس التغيير فورًا (مفيش snapshot قديم متخزّن)', () => {
    const registry = new PaymentProviderRegistry(
      fakeProvider('paymob', true) as never,
      fakeProvider('cash', true) as never,
      fakeProvider('wallet', true) as never,
      fakeProvider('instapay', true) as never,
      fakeProvider('fawry', true) as never,
    );

    const list = registry.listAll();
    expect(list.find((entry) => entry.method === PaymentMethod.CARD)?.isConfigured).toBe(true);
  });
});
