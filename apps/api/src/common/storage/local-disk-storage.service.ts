import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { StorageService } from './storage.service';

/**
 * تخزين محلي على القرص — للتطوير بس. الإنتاج لازم يستخدم S3-compatible
 * (AWS S3 / DigitalOcean Spaces / MinIO) زي ما محدد في docs/01-master-plan.md §2.2،
 * مع روابط موقّتة (presigned, صلاحية 15 دقيقة) بدل روابط ثابتة — راجع §7.2 (الأمان).
 * الواجهة (StorageService) مصممة عشان تبديل التطبيق ده بـ S3Service يبقى ملف واحد بس.
 */
@Injectable()
export class LocalDiskStorageService implements StorageService {
  private readonly baseDir: string;
  private readonly publicBaseUrl: string;
  private readonly logger = new Logger('StorageService(local)');

  constructor(config: ConfigService) {
    this.baseDir = config.get<string>('storage.localDir')!;
    this.publicBaseUrl = config.get<string>('storage.localPublicBaseUrl')!;
  }

  async save(key: string, buffer: Buffer, _mimeType: string): Promise<string> {
    const filePath = join(this.baseDir, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
    return this.buildUrl(key);
  }

  // مسار محلي ثابت أصلاً (مفيش presigning)، فمفيش حاجة تتجدد — نفس النتيجة اللي save() برجعها.
  async getUrl(key: string): Promise<string> {
    return this.buildUrl(key);
  }

  // بَقّة حقيقية (2026-08-23) — رابط نسبي (`/uploads/...` من غير scheme/host) شغال بس لو
  // الـconsumer على نفس أصل الـAPI بالظبط. apps/admin (3001)، apps/customer-web، وتطبيقات
  // Flutter كلهم على أصل مختلف عن الـAPI حتى في التطوير المحلي (CORS مفعّل عمداً لكده) —
  // المتصفح كان بيحل المسار النسبي ضد أصل الصفحة نفسها (admin/customer-web) مش أصل الـAPI،
  // فالصورة بتيجي 404/توجيه غلط بدل الملف الحقيقي (نفس فلسفة S3 presigned URLs اللي هي دايمًا
  // مطلقة أصلاً). اتلقطت لما المالك رفع لوجو JPG حقيقي من `/branding` وظهر بادچ "مرفوع" ونجح
  // التوست بس مكان الصورة فضل فاضي (broken image) — الرفع والـDB والـcache كلهم كانوا شغالين صح.
  private buildUrl(key: string): string {
    return `${this.publicBaseUrl}/uploads/${key}`;
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(join(this.baseDir, key), { force: true });
    } catch (err) {
      this.logger.error(`فشل حذف الملف اليتيم ${key}`, err instanceof Error ? err.stack : err);
    }
  }
}
