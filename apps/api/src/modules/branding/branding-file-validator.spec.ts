import { deflateSync } from 'zlib';
import {
  BrandingFileValidationError,
  detectActualImageFormat,
  validateBrandingFile,
} from './branding-file-validator';

// CRC32 يدوي — بس عشان نبني PNG صالح فعليًا لاختبار المسار الكامل (magic bytes + قراءة أبعاد
// حقيقية عبر image-size)، من غير أي fixture خارجي أو dependency إضافية.
function crc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** بيبني PNG صالح فعليًا (RGB، بلا فلتر) بحجم `size`×`size` — أبسط PNG صالح ممكن. */
function buildValidPng(size: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0); // width
  ihdrData.writeUInt32BE(size, 4); // height
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(2, 9); // color type: RGB
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace
  const ihdr = pngChunk('IHDR', ihdrData);

  const rawScanline = Buffer.alloc((1 + size * 3) * size);
  for (let row = 0; row < size; row++) {
    const rowStart = row * (1 + size * 3);
    rawScanline[rowStart] = 0; // filter type: none
  }
  const idat = pngChunk('IDAT', deflateSync(rawScanline));

  const iend = pngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

describe('branding-file-validator — detectActualImageFormat', () => {
  it('يتعرّف على PNG من magic bytes صح', () => {
    expect(detectActualImageFormat(buildValidPng(32))).toBe('png');
  });

  it('يتعرّف على JPEG من magic bytes صح', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectActualImageFormat(jpeg)).toBe('jpeg');
  });

  it('يتعرّف على WebP من magic bytes صح (RIFF....WEBP)', () => {
    const webp = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii')]);
    expect(detectActualImageFormat(webp)).toBe('webp');
  });

  it('يرجّع null لملف مش صورة خالص (نص عادي)', () => {
    expect(detectActualImageFormat(Buffer.from('not an image at all'))).toBeNull();
  });

  it('يرجّع null لـSVG (مقبولش كصورة نقطية أصلاً)', () => {
    expect(detectActualImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });
});

describe('branding-file-validator — validateBrandingFile (regression P0: magic-byte spoofing)', () => {
  it('يقبل PNG صالح فعليًا بأبعاد معقولة، ويرجّع الأبعاد الصح', () => {
    const png = buildValidPng(64);
    const result = validateBrandingFile(png, 'image/png', png.length);
    expect(result).toEqual({ widthPx: 64, heightPx: 64 });
  });

  it('يرفض لو الـmimetype المُعلَن مايطابقش محتوى الملف الفعلي (تزوير: PNG حقيقي بـmimetype=jpeg)', () => {
    const png = buildValidPng(64);
    expect(() => validateBrandingFile(png, 'image/jpeg', png.length)).toThrow(BrandingFileValidationError);
  });

  it('يرفض SVG حتى لو mimetype متزوّر بـimage/png (منع حقن سكربت — الفحص الأهم أمنيًا)', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(() => validateBrandingFile(svg, 'image/png', svg.length)).toThrow(BrandingFileValidationError);
  });

  it('يرفض mimetype غير مسموح خالص (image/svg+xml) قبل حتى ما يفحص المحتوى', () => {
    const svg = Buffer.from('<svg></svg>');
    expect(() => validateBrandingFile(svg, 'image/svg+xml', svg.length)).toThrow(BrandingFileValidationError);
  });

  it('يرفض ملف أكبر من الحد المسموح', () => {
    const png = buildValidPng(64);
    expect(() => validateBrandingFile(png, 'image/png', 6 * 1024 * 1024)).toThrow(BrandingFileValidationError);
  });

  it('يرفض صورة أبعادها أصغر من الحد الأدنى (32px)', () => {
    const tinyPng = buildValidPng(8);
    expect(() => validateBrandingFile(tinyPng, 'image/png', tinyPng.length)).toThrow(BrandingFileValidationError);
  });

  it('يرفض صورة أبعادها أكبر من الحد الأقصى (4096px)', () => {
    const hugePng = buildValidPng(5000);
    expect(() => validateBrandingFile(hugePng, 'image/png', hugePng.length)).toThrow(BrandingFileValidationError);
  });
});
