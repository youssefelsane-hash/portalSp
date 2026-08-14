import { BadRequestException } from '@nestjs/common';
import { assertFileSignatureMatches, detectActualFileFormat } from './file-signature-validator';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF_HEADER = Buffer.from('%PDF-1.4\n%...', 'ascii');
const WEBP_HEADER = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'ascii')]);
const NOT_A_FILE = Buffer.from('<script>alert(1)</script>', 'ascii');

describe('file-signature-validator — docs/08 §19 بند 10 (magic bytes بدل الثقة في mimetype المُعلَن)', () => {
  it('detectActualFileFormat بيتعرف صح على PNG/JPEG/WEBP/PDF من البايتات الحقيقية', () => {
    expect(detectActualFileFormat(PNG_HEADER)).toBe('png');
    expect(detectActualFileFormat(JPEG_HEADER)).toBe('jpeg');
    expect(detectActualFileFormat(WEBP_HEADER)).toBe('webp');
    expect(detectActualFileFormat(PDF_HEADER)).toBe('pdf');
  });

  it('detectActualFileFormat بيرجع null لملف مش من الأنواع المعروفة', () => {
    expect(detectActualFileFormat(NOT_A_FILE)).toBeNull();
  });

  it('assertFileSignatureMatches بينجح لو المُعلَن مطابق للمحتوى الفعلي', () => {
    expect(() => assertFileSignatureMatches(PNG_HEADER, 'image/png', new Set(['image/png', 'image/jpeg']))).not.toThrow();
    expect(() => assertFileSignatureMatches(PDF_HEADER, 'application/pdf', new Set(['application/pdf']))).not.toThrow();
  });

  it('assertFileSignatureMatches بيرفض MIME مش في القايمة المسموحة أصلاً', () => {
    expect(() => assertFileSignatureMatches(PNG_HEADER, 'image/gif', new Set(['image/png']))).toThrow(BadRequestException);
  });

  it('assertFileSignatureMatches بيرفض محتوى مش ملف صالح خالص (magic bytes مجهولة)', () => {
    expect(() => assertFileSignatureMatches(NOT_A_FILE, 'image/png', new Set(['image/png']))).toThrow(BadRequestException);
  });

  it('البَقّة اللي بند 10 بيمنعها — العميل غيّر الامتداد بس المحتوى الحقيقي مختلف (هجوم mimetype spoofing)', () => {
    // ملف .exe/سكربت اتسمّى "image/png" في الـContent-Type بس محتواه الفعلي مش PNG خالص —
    // النظام القديم كان بيثق في الـmimetype المُعلَن بس ويقبله.
    expect(() => assertFileSignatureMatches(NOT_A_FILE, 'image/png', new Set(['image/png']))).toThrow(
      'محتوى الملف مش من الأنواع المسموحة',
    );

    // سيناريو أخطر: ملف PDF حقيقي (ممكن يحمل JavaScript/exploit) اتسمّى "image/jpeg" عشان
    // يعدّي فلتر "صور بس" — المحتوى الفعلي (PDF) لا يطابق الامتداد المُعلَن (JPEG) فيترفض.
    expect(() => assertFileSignatureMatches(PDF_HEADER, 'image/jpeg', new Set(['image/jpeg', 'application/pdf']))).toThrow(
      'نوع الملف المُعلَن مايطابقش محتواه الفعلي',
    );
  });
});
