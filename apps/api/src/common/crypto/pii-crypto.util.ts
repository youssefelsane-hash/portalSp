import { HttpStatus } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';
import { ApiException, ErrorCode } from '../exceptions/api.exception';

/**
 * تشفير/هاش بيانات هوية شخصية (PII) — ADR-0045.
 *
 * **ليه قيمتين لنفس البيانة؟** التشفير هنا randomized (IV عشوائي لكل عملية)، يعني نفس الرقم
 * القومي بيدّي ciphertext مختلف كل مرة. ده مطلوب أمنيًا (بيمنع استنتاج إن صفّين ليهم نفس
 * القيمة من مجرد النظر)، بس نتيجته إن **مستحيل** تعمل عليه `UNIQUE` أو تدوّر بيه. فبنخزّن
 * كمان **HMAC حتمي** (نفس المدخل ⇒ نفس المخرج دايمًا) — ده اللي بيتفهرس ويتقارن، وهو
 * one-way فحتى لو الجدول اتسرّب مايديش الأرقام.
 *
 * ده النمط القياسي المعروف بـ blind indexing / searchable encryption.
 */

const ENC_PREFIX = 'enc:v1:';

/** مفتاح مشتق من مادة السر — sha256 عشان يبقى 32 بايت مهما كان طول المدخل. */
function keyMaterial(): string {
  const material = process.env.PII_ENCRYPTION_KEY || process.env.SETTINGS_ENCRYPTION_KEY;
  if (!material || material.length < 32) {
    throw new ApiException(
      ErrorCode.VAL_001,
      'مفتاح تشفير بيانات الهوية غير مُعدّ',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  return material;
}

function encryptionKey(): Buffer {
  return createHash('sha256').update(keyMaterial()).digest();
}

/**
 * مفتاح الهاش مشتق بسلسلة مختلفة عن مفتاح التشفير — نفس مادة السر بس domain separation، عشان
 * كسر واحد مايديش التاني.
 */
function hmacKey(): Buffer {
  return createHash('sha256').update(`pii-blind-index:${keyMaterial()}`).digest();
}

/**
 * تطبيع قبل الهاش — **حرج**: من غيره نفس البطاقة بتدّي هاشين مختلفين حسب إزاي اتكتبت (أرقام
 * عربية من كيبورد الموبايل، مسافات، شرطات)، فالتفرّد بيتلف بالكامل.
 */
export function normalizeNationalId(raw: string): string {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const easternArabicDigits = '۰۱۲۳۴۵۶۷۸۹'; // فارسية/أردية — بتتكتب من بعض الكيبوردات
  return raw
    .split('')
    .map((ch) => {
      const arabicIndex = arabicDigits.indexOf(ch);
      if (arabicIndex >= 0) return String(arabicIndex);
      const easternIndex = easternArabicDigits.indexOf(ch);
      if (easternIndex >= 0) return String(easternIndex);
      return ch;
    })
    .join('')
    .replace(/[\s\-_]/g, '');
}

/** الرقم القومي المصري: 14 رقم بالظبط بعد التطبيع. */
export function isValidEgyptianNationalId(normalized: string): boolean {
  return /^\d{14}$/.test(normalized);
}

export function encryptPii(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${ENC_PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * بترجّع `null` بدل ما ترمي لو القيمة مش بصيغة معروفة أو فك التشفير فشل — قراءة PII بتحصل
 * في مسارات عرض (صفحة الفني عند الأدمن)، وصف واحد تالف ما ينفعش يكسر الصفحة كلها.
 */
export function decryptPii(value: string | null): string | null {
  if (!value || !value.startsWith(ENC_PREFIX)) return null;
  try {
    const [, , iv, tag, ciphertext] = value.split(':');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** الفهرس الأعمى — hex، حتمي، هو اللي بيتخزّن في `national_id_hash` ويتعمل عليه UNIQUE. */
export function blindIndex(normalizedValue: string): string {
  return createHmac('sha256', hmacKey()).update(normalizedValue).digest('hex');
}

/** آخر 4 أرقام بس للعرض في السجلات/الواجهات اللي مش محتاجة الرقم كامل. */
export function maskNationalId(normalized: string): string {
  if (normalized.length <= 4) return '****';
  return `${'*'.repeat(normalized.length - 4)}${normalized.slice(-4)}`;
}
