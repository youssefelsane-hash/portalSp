import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ApiException, ErrorCode } from '../../../common/exceptions/api.exception';
import { STORAGE_SERVICE, StorageService } from '../../../common/storage/storage.service';
import {
  BrandingFileValidationError,
  validateBrandingFile,
} from '../../branding/branding-file-validator';
import { AuditActorMeta } from '../../audit/audit-log.service';
import { SettingsService } from '../../settings/settings.service';

export const INSTAPAY_QR_SETTING_KEY = 'payments.instapay.qr_image';

/** بادئة بتفرّق ملف مرفوع عندنا عن رابط خارجي — القيمة المخزّنة واحدة، والمصدر باين منها. */
const STORAGE_PREFIX = 'storage://';

export type InstaPayQrSource = 'uploaded' | 'link';

export interface InstaPayQrAdminView {
  /** رابط قابل للعرض دلوقتي (موقّع لو التخزين S3) — `null` يعني مفيش QR مضبوط. */
  url: string | null;
  source: InstaPayQrSource | null;
}

/**
 * QR كود استقبال تحويلات InstaPay (migration 0211، docs/08 §78-د).
 *
 * **ليه خدمة مستقلة مش جوّه `InstaPayProvider`؟** الـprovider بيقرا إعداداته مرة في
 * `onModuleInit` وبيحتفظ بيها في الذاكرة (§33) — نمط صح لقيمة نصية صغيرة بتتقري في كل عملية
 * دفع. لكن رابط الـQR **مش قابل للتخزين المؤقت بنفس الطريقة**: لو التخزين S3، الرابط موقّع
 * وبينتهي، فلازم يتولّد طازة وقت كل قراءة (نفس درس `branding` module — راجع
 * `StorageService.getUrl`). خلطهم في كلاس واحد كان هيخلّي نصف حالته حي ونصفها بايت.
 *
 * **القيمة المخزّنة**: `storage://<key>` لملف مرفوع، أو `https://…` لرابط خارجي، أو فاضية.
 * مصدر حقيقة واحد لحالتين — مفيش سؤال «مين يكسب لو الاتنين مليانين؟».
 */
@Injectable()
export class InstaPayQrService {
  private readonly logger = new Logger(InstaPayQrService.name);

  constructor(
    private readonly settingsService: SettingsService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  /**
   * الرابط المعروض للعميل — **أبدًا ما يرميش**.
   *
   * الـQR راحة إضافية فوق التعليمات النصية (اللي فيها عنوان الـIPA ورقم الطلب)، مش شرط للدفع.
   * فشل التخزين لازم يخلّي العميل يكمّل بالتعليمات، مش يمنعه من الدفع خالص — نفس قاعدة
   * CLAUDE.md: أي فشل بنية تحتية ما يكسرش عملية حقيقية للمستخدم.
   */
  async getCustomerUrl(): Promise<string | null> {
    try {
      return (await this.resolve()).url;
    } catch (err) {
      this.logger.warn(`تعذّر توليد رابط QR الخاص بـInstaPay: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** نفس الرابط + مصدره (مرفوع/لينك) — للوحة الأدمن عشان تعرف تعرض زرار «شيل» صح. */
  async getAdminView(): Promise<InstaPayQrAdminView> {
    return this.resolve();
  }

  private async resolve(): Promise<InstaPayQrAdminView> {
    const raw = (await this.settingsService.getString(INSTAPAY_QR_SETTING_KEY, '')).trim();
    if (!raw) return { url: null, source: null };
    if (raw.startsWith(STORAGE_PREFIX)) {
      const key = raw.slice(STORAGE_PREFIX.length);
      return { url: await this.storage.getUrl(key), source: 'uploaded' };
    }
    return { url: raw, source: 'link' };
  }

  async upload(
    adminUserId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    meta?: AuditActorMeta,
  ): Promise<InstaPayQrAdminView> {
    // نفس مُتحقق البراندنج بالظبط (magic bytes + تطابق الـMIME المُعلَن + حجم + أبعاد) — QR
    // مرفوع من الأدمن هو نفس فئة الخطر بالحرف، ونسخة تانية من نفس المنطق كانت هتفترق عنه
    // بمرور الوقت. مفيش SVG هنا كمان، لنفس السبب (وعاء تنفيذ سكربت).
    try {
      validateBrandingFile(file.buffer, file.mimetype, file.size);
    } catch (err) {
      if (err instanceof BrandingFileValidationError) {
        throw new ApiException(ErrorCode.VAL_001, err.message, HttpStatus.BAD_REQUEST);
      }
      throw err;
    }

    const extension = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const key = `payments/instapay-qr/${randomUUID()}.${extension}`;
    // مفيش `uploadWithOrphanCleanup` هنا عمدًا: الخطوة اللي بعد الرفع هي كتابة إعداد نصّي
    // (`settings.update`)، مش صف بـFKs — ولو فشلت، الملف بيفضل غير مشار إليه ومش هيتعرض لحد.
    // التنظيف بيحصل تحت وقت الاستبدال/الشيل، ونفس سياسة `branding` (الملف القديم بيفضل في
    // التخزين) مقصودة عشان أي عميل شايف الرابط القديم ما يتكسرش لحظيًا.
    await this.storage.save(key, file.buffer, file.mimetype);
    await this.settingsService.update(adminUserId, INSTAPAY_QR_SETTING_KEY, `${STORAGE_PREFIX}${key}`, meta);
    return this.resolve();
  }

  async setLink(adminUserId: string, url: string, meta?: AuditActorMeta): Promise<InstaPayQrAdminView> {
    const trimmed = url.trim();
    // https بس — الصورة دي بتتعرض جوّه شاشة دفع، ورابط http بيتحمّل بلا تشفير وقابل للتبديل
    // في الطريق. صورة QR مبدّلة = فلوس العميل بتروح لحساب تاني، فده فحص أمان مش تجميل.
    if (!/^https:\/\/\S+$/i.test(trimmed)) {
      throw new ApiException(ErrorCode.VAL_001, 'الرابط لازم يبدأ بـhttps://', HttpStatus.BAD_REQUEST);
    }
    await this.settingsService.update(adminUserId, INSTAPAY_QR_SETTING_KEY, trimmed, meta);
    return this.resolve();
  }

  /** بيرجّع الحالة لـ«مفيش QR» — العميل بيشوف التعليمات النصية بس، زي قبل الميزة دي بالظبط. */
  async remove(adminUserId: string, meta?: AuditActorMeta): Promise<InstaPayQrAdminView> {
    await this.settingsService.update(adminUserId, INSTAPAY_QR_SETTING_KEY, '', meta);
    return { url: null, source: null };
  }
}
