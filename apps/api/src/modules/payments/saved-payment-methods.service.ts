import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { SavedPaymentMethod } from './entities/saved-payment-method.entity';

// طرق دفع محفوظة (tokenized) — docs/08 §21. الجدول بيخزّن الـtoken اللي بترجّعه بوابة الدفع +
// بيانات آمنة للعرض بس (آخر 4 أرقام/نوع الكارت) — أبداً رقم كارت خام أو CVV.
@Injectable()
export class SavedPaymentMethodsService {
  constructor(
    @InjectRepository(SavedPaymentMethod) private readonly repo: Repository<SavedPaymentMethod>,
  ) {}

  async listForCustomer(customerId: string): Promise<SavedPaymentMethod[]> {
    return this.repo.find({ where: { customerId, isRevoked: false }, order: { createdAt: 'DESC' } });
  }

  /** بيتنادى من ويب-هوك "حفظ كارت" — idempotent (نفس provider+token = نفس الصف، مش تكرار). */
  async upsertToken(params: {
    customerId: string;
    provider: string;
    providerToken: string;
    cardBrand: string | null;
    maskedPan: string | null;
  }): Promise<SavedPaymentMethod> {
    const existing = await this.repo.findOne({ where: { provider: params.provider, providerToken: params.providerToken } });
    if (existing) {
      return existing;
    }
    // أول كارت للعميل بيبقى الافتراضي تلقائيًا؛ أي كارت بعده يتحفظ غير افتراضي لحد ما العميل
    // يغيّره بنفسه — تفاديًا لتبديل وسيلة التحصيل التلقائي من غير قرار واعي من العميل.
    const hasAny = await this.repo.count({ where: { customerId: params.customerId, isRevoked: false } });
    const saved = this.repo.create({
      customerId: params.customerId,
      provider: params.provider,
      providerToken: params.providerToken,
      cardBrand: params.cardBrand,
      maskedPan: params.maskedPan,
      isDefault: hasAny === 0,
    });
    return this.repo.save(saved);
  }

  async findDefaultForCustomer(customerId: string): Promise<SavedPaymentMethod | null> {
    return this.repo.findOne({ where: { customerId, isRevoked: false, isDefault: true } });
  }

  async setDefault(userId: string, customerId: string, methodId: string): Promise<SavedPaymentMethod> {
    const method = await this.repo.findOne({ where: { id: methodId, customerId, isRevoked: false } });
    if (!method) {
      throw new ApiException(ErrorCode.VAL_001, 'وسيلة الدفع غير موجودة', HttpStatus.NOT_FOUND);
    }
    await this.repo.update({ customerId, isDefault: true }, { isDefault: false });
    method.isDefault = true;
    return this.repo.save(method);
  }

  async revoke(customerId: string, methodId: string): Promise<void> {
    const method = await this.repo.findOne({ where: { id: methodId, customerId, isRevoked: false } });
    if (!method) {
      throw new ApiException(ErrorCode.VAL_001, 'وسيلة الدفع غير موجودة', HttpStatus.NOT_FOUND);
    }
    method.isRevoked = true;
    method.revokedAt = new Date();
    method.isDefault = false;
    await this.repo.save(method);
    // لو ده كان الافتراضي، حوّل أقدم وسيلة نشطة تانية (لو موجودة) للافتراضي — بلا تدخّل يدوي مطلوب.
    const remaining = await this.repo.find({ where: { customerId, isRevoked: false }, order: { createdAt: 'ASC' }, take: 1 });
    if (remaining.length > 0) {
      remaining[0].isDefault = true;
      await this.repo.save(remaining[0]);
    }
  }
}
