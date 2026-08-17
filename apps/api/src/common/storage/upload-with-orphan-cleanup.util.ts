import { Logger } from '@nestjs/common';
import { StorageService } from './storage.service';

const logger = new Logger('StorageOrphanCleanup');

/**
 * Script 2 Part G (findings #34/#35) — كل مسار رفع في النظام بيعمل نفس التسلسل: `storage.save()`
 * ينجح، وبعده استعلام DB منفصل بيسجّل الـmetadata (order_media/complaint_attachments/
 * technician_documents/technician_certificates/chat_messages). لو خطوة الـDB فشلت، الملف بيفضل
 * موجود في S3/القرص من غير أي صف يشاور عليه — ملف يتيم دايم.
 *
 * الالتفاف: نرفع الملف الأول زي ما هو، لكن نلف خطوة تسجيل الـDB بمحاولة-تنظيف — لو فشلت، نحاول
 * نمسح الملف اللي رفعناه (compensating delete)، ونعيد رمي الخطأ الأصلي زي ما هو (الكولر لازم
 * يشوف نفس الفشل اللي كان هيشوفه، بس من غير ملف يتيم ورا الكواليس). فشل الحذف نفسه بيتلقّط جوّه
 * `StorageService.delete()` (idempotent، مايرميش) — لو فشل فعلاً، الملف هيفضل يتيم وموثّق باللوج،
 * مش استثناء تاني يغطي على السبب الحقيقي للفشل.
 */
export async function uploadWithOrphanCleanup<T>(
  storage: StorageService,
  key: string,
  buffer: Buffer,
  mimeType: string,
  persistMetadata: (fileUrl: string) => Promise<T>,
): Promise<T> {
  const fileUrl = await storage.save(key, buffer, mimeType);
  try {
    return await persistMetadata(fileUrl);
  } catch (err) {
    logger.error(`فشل تسجيل بيانات الملف بعد رفعه بنجاح — بيتم تنظيف الملف اليتيم ${key}`, err instanceof Error ? err.stack : err);
    await storage.delete(key);
    throw err;
  }
}
