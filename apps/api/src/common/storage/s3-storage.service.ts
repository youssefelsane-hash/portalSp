import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.service';

/**
 * تخزين S3-compatible حقيقي — بيشتغل مع AWS S3 نفسه أو أي بديل متوافق (DigitalOcean Spaces،
 * Cloudflare R2، MinIO ذاتي الاستضافة) عبر S3_ENDPOINT اختياري. تفعيله = تغيير STORAGE_PROVIDER=s3
 * + ملء بيانات الاعتماد في .env (راجع docs/03-external-integrations.md) — من غير ما يتلمس أي
 * كود بيستخدم StorageService (orders/support/technicians)، بالظبط زي ما LocalDiskStorageService
 * وStorageService.README.md وعدوا من الأول.
 *
 * **قرار تصميم صريح عن نوع الرابط الراجع من save()** (وليس تحقيق كامل لـ"presigned 15 دقيقة"
 * الموثّقة في docs/01-master-plan.md §7.2 — فجوة موثّقة بصراحة، مش سهو): الواجهة الحالية
 * (`StorageService.save(): Promise<string>`) بترجع سترينج واحد بيتخزن *دايماً* في العمود
 * (`file_url` في order_media/complaint_attachments/technician_documents) وبيتقرا كما هو في كل
 * رد API بعد كده — مفيش أي طبقة "تجديد رابط وقت القراءة" في التصميم الحالي (الـ DTO mappers
 * دوال pure، مش services، ومحتاجين يبقوا async يحقنوا StorageService عشان يولّدوا رابط جديد كل
 * مرة). تطبيق "presigned 15 دقيقة" حرفياً كان معناه تخزين الـ key بس (مش رابط) وتعديل الأربع
 * مسارات القراءة كلها (order-media/complaint-attachment/technician-document/chat-message) —
 * تغيير معماري أوسع من نطاق "أضف S3 adapter" وغير قابل للاختبار حياً هنا أصلاً (مفيش S3 حقيقي
 * نقدر نتأكد بيه). القرار العملي: presigned URL لكن بأطول مدة صلاحية ممكنة لـ SigV4 (7 أيام،
 * `STORAGE_S3_URL_EXPIRY_SECONDS` — الحد الأقصى الرسمي لـAWS SigV4 presigned URLs)، مش دقائق —
 * بيغطي عملياً كل حالات الاستخدام الحالية (مراجعة صور طلب/مستندات فني بعد الرفع بوقت قريب نسبياً،
 * ولوحة الإدارة بتجيب البيانات fresh في كل تحميل صفحة مش بتكاش قديم). سجل حي أقدم من 7 أيام هيحتاج
 * رفع تاني أو (تحسين مستقبلي) الانتقال لتخزين الـ key + توليد رابط وقت القراءة.
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
}
