import { BadRequestException } from '@nestjs/common';

// فحص magic bytes حقيقية بدل الثقة في `file.mimetype` المُعلَن من الكلاينت (سهل التزوير — multer
// بياخده حرفيًا من Content-Type header بلا أي تحقق). نفس المبدأ المُستخدم أصلاً في
// branding-file-validator.ts (ADR-0014)، معمَّم هنا لباقي مسارات الرفع في النظام (order media،
// chat images، technician documents/certificates، complaint attachments — docs/08 §19 بند 10)
// بإضافة دعم PDF لمستندات/شهادات الفني.
export type DetectedFileFormat = 'png' | 'jpeg' | 'webp' | 'pdf';

const MIME_TO_FORMAT: Record<string, DetectedFileFormat> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const FORMAT_TO_EXTENSION: Record<DetectedFileFormat, string> = {
  png: '.png',
  jpeg: '.jpg',
  webp: '.webp',
  pdf: '.pdf',
};

/**
 * Script 2 Part G (finding #36) — الامتداد المُخزَّن مع المفتاح كان بيتاخد من `file.originalname`
 * مباشرة (`extname()`)، رغم إن magic bytes بتتحقق قبله. ملف حقيقي محتواه PNG باسم `x.html` كان
 * هيتخزّن بمفتاح ينتهي بـ`.html` رغم إن `assertFileSignatureMatches` عدّاه كـPNG صحيح. الامتداد
 * دلوقتي مُشتَق من نفس magic-byte detection الموثوق فيه، مش من اسم الملف المُعلَن — لازم يتنادَى
 * بعد `assertFileSignatureMatches` (أو مع نفس buffer) عشان يضمن تطابق فعلي.
 */
export function safeExtensionForFile(buffer: Buffer): string {
  const format = detectActualFileFormat(buffer);
  return format ? FORMAT_TO_EXTENSION[format] : '';
}

export function detectActualFileFormat(buffer: Buffer): DetectedFileFormat | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'pdf';
  }
  return null;
}

/**
 * تحقق كامل من ملف مرفوع: MIME معلَن ضمن القايمة المسموحة + magic bytes حقيقية + تطابقهم مع
 * المُعلَن. بترمي `BadRequestException` برسالة عربية واضحة لأول فحص فاشل — استبدال مباشر لأي
 * `if (!ALLOWED.has(file.mimetype)) throw ...` قديم كان بيثق في المُعلَن بس.
 */
export function assertFileSignatureMatches(buffer: Buffer, declaredMimeType: string, allowedMimeTypes: ReadonlySet<string>): void {
  if (!allowedMimeTypes.has(declaredMimeType)) {
    throw new BadRequestException('نوع الملف غير مسموح');
  }

  const actualFormat = detectActualFileFormat(buffer);
  if (!actualFormat) {
    throw new BadRequestException('محتوى الملف مش من الأنواع المسموحة (magic bytes غير معروفة)');
  }
  if (MIME_TO_FORMAT[declaredMimeType] !== actualFormat) {
    throw new BadRequestException('نوع الملف المُعلَن مايطابقش محتواه الفعلي — الملف اترفض بأمان');
  }
}
