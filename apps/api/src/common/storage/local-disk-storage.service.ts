import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'fs/promises';
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

  constructor(config: ConfigService) {
    this.baseDir = config.get<string>('storage.localDir')!;
  }

  async save(key: string, buffer: Buffer, _mimeType: string): Promise<string> {
    const filePath = join(this.baseDir, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
    return `/uploads/${key}`;
  }

  // مسار محلي ثابت أصلاً (مفيش presigning)، فمفيش حاجة تتجدد — نفس النتيجة اللي save() برجعها.
  async getUrl(key: string): Promise<string> {
    return `/uploads/${key}`;
  }
}
