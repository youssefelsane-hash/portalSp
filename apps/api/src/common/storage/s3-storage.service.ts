import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.service';

/**
 * تخزين S3-compatible حقيقي — بيشتغل مع AWS S3 نفسه أو أي بديل متوافق (DigitalOcean Spaces،
 * Cloudflare R2، MinIO ذاتي الاستضافة) عبر S3_ENDPOINT اختياري. تفعيله = تغيير STORAGE_PROVIDER=s3
 * + ملء بيانات الاعتماد في .env (راجع docs/03-external-integrations.md) — من غير ما يتلمس أي
 * كود بيستخدم StorageService (orders/support/technicians)، بالظبط زي ما LocalDiskStorageService
 * وStorageService.README.md وعدوا من الأول.
 *
 * `save()` يرجّع URL لأن الواجهة القديمة تحتاجه كـfallback، لكنه presigned ومؤقت. كل أصل مرفوع
 * يحتاج أن يسجّل مفتاحه الدائم كذلك، ثم يولّد URL طازجًا عبر `getUrl()` عند القراءة. هذا النمط
 * مطبّق على وسائط الطلب والدعم والفنيين والبراندنج والشات والفئات؛ لا يجوز تخزين URL وحده لأصل
 * يفترض أن يبقى متاحًا بعد انتهاء مدة التوقيع.
 */
@Injectable()
export class S3StorageService implements StorageService {
  private readonly logger = new Logger('StorageService(s3)');
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly urlExpirySeconds: number;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>('storage.s3.endpoint') || undefined;
    const region = config.get<string>('storage.s3.region')!;
    this.bucket = config.get<string>('storage.s3.bucket')!;
    this.urlExpirySeconds = config.get<number>('storage.s3.urlExpirySeconds')!;

    this.client = new S3Client({
      region,
      endpoint,
      // لازم true لأغلب البدائل غير-AWS (MinIO، وأحياناً Spaces) — bucket.endpoint.com مش بيشتغل
      // لو الـ endpoint نفسه custom domain، افتراضياً true عشان يشتغل مع أكبر عدد ممكن من البدائل
      // من غير إعداد إضافي، AWS نفسه بيتجاهل الإعداد ده أصلاً (بيستخدم virtual-hosted دايماً).
      forcePathStyle: config.get<boolean>('storage.s3.forcePathStyle') ?? true,
      credentials: {
        accessKeyId: config.get<string>('storage.s3.accessKeyId')!,
        secretAccessKey: config.get<string>('storage.s3.secretAccessKey')!,
      },
    });

    this.logger.log(`S3 storage مُفعّل — bucket=${this.bucket}, endpoint=${endpoint ?? 'AWS default'}`);
  }

  async save(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );

    return this.getUrl(key);
  }

  // presigned جديد كل مرة — الكولر (زي branding module) بيخزّن الـkey بس، مش الرابط، عشان
  // presigned URL بينتهي بعد urlExpirySeconds (7 أيام حالياً) ومفيش آلية "تجديد وقت القراءة"
  // للروابط المخزّنة القديمة في الموديولات التانية (راجع تعليق التصميم فوق الكلاس).
  async getUrl(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: this.urlExpirySeconds,
    });
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      // نفس فلسفة كل مكان تاني: فشل تنظيف (compensating action) نفسه بيتلقّط ويتسجّل بس، مش
      // بيرمي — الملف اليتيم هيفضل موجود لحد تنظيف يدوي/دوري، مش أخطر من إخفاء الفشل الأصلي.
      this.logger.error(`فشل حذف الملف اليتيم ${key}`, err instanceof Error ? err.stack : err);
    }
  }
}
