import { imageSize } from 'image-size';

// PNG/JPEG/WebP بس — عمدًا مفيش SVG خالص (وعاء تنفيذ سكربت حقيقي، `<script>`/`onload` جوّه XML)،
// رفضه بالكامل أبسط وأأمن من محاولة تعقيمه (ADR-0014).
export const ALLOWED_BRANDING_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const MAX_BRANDING_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MIN_DIMENSION_PX = 32;
const MAX_DIMENSION_PX = 4096;

export type DetectedImageFormat = 'png' | 'jpeg' | 'webp';

/**
 * بيفحص أول بايتات الملف الحقيقية (magic bytes) — مش بس `file.mimetype` المُعلَن من الكلاينت
 * (سهل التزوير، `multer` بياخده حرفيًا من الـContent-Type header). لازم يطابق الـmimetype المُعلَن.
 */
export function detectActualImageFormat(buffer: Buffer): DetectedImageFormat | null {
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
  return null;
}

const MIME_TO_FORMAT: Record<string, DetectedImageFormat> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
};

export interface BrandingFileValidationResult {
  widthPx: number;
  heightPx: number;
}

export class BrandingFileValidationError extends Error {}

/**
 * تحقق كامل من ملف براندنج مرفوع (ADR-0014) — MIME معلَن + magic bytes حقيقية + تطابقهم + حجم +
 * أبعاد. بيرمي `BrandingFileValidationError` برسالة عربية واضحة لأول فحص فاشل، الكولر (controller)
 * بيلفّها في `BadRequestException`.
 */
export function validateBrandingFile(buffer: Buffer, declaredMimeType: string, fileSizeBytes: number): BrandingFileValidationResult {
  if (fileSizeBytes > MAX_BRANDING_FILE_SIZE_BYTES) {
    throw new BrandingFileValidationError(`حجم الملف أكبر من الحد المسموح (${MAX_BRANDING_FILE_SIZE_BYTES / (1024 * 1024)}MB)`);
  }
  if (!ALLOWED_BRANDING_MIME_TYPES.has(declaredMimeType)) {
    throw new BrandingFileValidationError('نوع الملف غير مسموح — صور PNG/JPEG/WEBP بس (مفيش SVG)');
  }

  const actualFormat = detectActualImageFormat(buffer);
  if (!actualFormat) {
    throw new BrandingFileValidationError('محتوى الملف مش صورة صالحة (magic bytes غير معروفة)');
  }
  if (MIME_TO_FORMAT[declaredMimeType] !== actualFormat) {
    throw new BrandingFileValidationError('نوع الملف المُعلَن مايطابقش محتواه الفعلي — الملف اترفض بأمان');
  }

  let dimensions: { width: number; height: number };
  try {
    dimensions = imageSize(buffer);
  } catch {
    throw new BrandingFileValidationError('مقدرناش نقرأ أبعاد الصورة — الملف ممكن يكون تالف');
  }

  if (
    dimensions.width < MIN_DIMENSION_PX ||
    dimensions.height < MIN_DIMENSION_PX ||
    dimensions.width > MAX_DIMENSION_PX ||
    dimensions.height > MAX_DIMENSION_PX
  ) {
    throw new BrandingFileValidationError(
      `أبعاد الصورة لازم تكون بين ${MIN_DIMENSION_PX} و${MAX_DIMENSION_PX} بكسل (الحالية: ${dimensions.width}×${dimensions.height})`,
    );
  }

  return { widthPx: dimensions.width, heightPx: dimensions.height };
}
