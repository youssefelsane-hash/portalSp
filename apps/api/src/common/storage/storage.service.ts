export interface StorageService {
  /** بيحفظ الملف ويرجّع الـ URL اللي يتقرا بيه (أو المسار النسبي محلياً). */
  save(key: string, buffer: Buffer, mimeType: string): Promise<string>;
  /**
   * بيرجّع رابط قراءة طازة لـkey اتحفظ قبل كده من غير ما يعيد الرفع — لازم للحالات اللي مينفعش
   * فيها تخزين رابط S3 presigned (بينتهي بعد urlExpirySeconds) بشكل دائم في الـDB، زي أصول
   * البراندنج (`branding` module) اللي المفروض تفضل شغالة للأبد من غير ما حد يعيد رفعها.
   * الكولر بيخزّن الـkey بس، وبيولّد رابط جديد وقت كل قراءة (مع كاش قصير المدى فوق النتيجة).
   */
  getUrl(key: string): Promise<string>;
  /**
   * Script 2 Part G (finding #34) — تعويض لو رفع الملف نجح بس تسجيل الـmetadata في الـDB فشل
   * بعده مباشرة (`uploadWithOrphanCleanup`، `common/storage/upload-with-orphan-cleanup.util.ts`).
   * idempotent — حذف key مش موجود أصلاً لازم يكون safe no-op، مش استثناء.
   */
  delete(key: string): Promise<void>;
}

export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');
