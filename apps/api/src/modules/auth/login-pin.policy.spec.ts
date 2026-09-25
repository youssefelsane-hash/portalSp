import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PIN_BCRYPT_ROUNDS,
  PIN_HASH_PREFIX,
  hashPin,
  isWeakPin,
  lockoutMinutesFor,
  lockRemainingTextAr,
  PIN_MAX_ATTEMPTS,
  shouldLock,
  validatePinFormat,
  verifyPinHash,
} from './login-pin.policy';

describe('سياسة رمز الدخول (ADR-0109)', () => {
  describe('الشكل', () => {
    it('بيقبل ٦ أرقام سليمة فقط للرموز الجديدة', () => {
      expect(validatePinFormat('194736')).toBeNull();
    });

    it('بيرفض الأقصر والأطول', () => {
      expect(validatePinFormat('135')?.code).toBe('length');
      expect(validatePinFormat('1357')?.code).toBe('length');
      expect(validatePinFormat('1947361')?.code).toBe('length');
      expect(validatePinFormat('')?.code).toBe('length');
    });

    it('بيرفض أي حاجة مش رقم — بما فيها الأرقام العربية-الهندية', () => {
      expect(validatePinFormat('12a4')?.code).toBe('digits');
      expect(validatePinFormat('12 4')?.code).toBe('digits');
      expect(validatePinFormat('١٢٣٥')?.code).toBe('digits');
    });

    it('بيرفض مدخل مش نص أصلاً بدل ما يقع', () => {
      expect(validatePinFormat(1357)?.code).toBe('length');
      expect(validatePinFormat(null)?.code).toBe('length');
      expect(validatePinFormat(undefined)?.code).toBe('length');
    });
  });

  describe('الأرقام الضعيفة', () => {
    it('كله نفس الرقم مرفوض', () => {
      expect(isWeakPin('1111')).toBe(true);
      expect(isWeakPin('000000')).toBe(true);
    });

    it('التسلسل صاعد أو نازل مرفوض', () => {
      expect(isWeakPin('1234')).toBe(true);
      expect(isWeakPin('4321')).toBe(true);
      expect(isWeakPin('456789')).toBe(true);
      expect(isWeakPin('987654')).toBe(true);
    });

    it('الرمز المعقول مقبول', () => {
      expect(isWeakPin('1357')).toBe(false);
      expect(isWeakPin('2580')).toBe(false);
      expect(isWeakPin('194736')).toBe(false);
    });

    it('«1235» مش تسلسل كامل — مقبول', () => {
      expect(isWeakPin('1235')).toBe(false);
    });
  });

  describe('القفل المتدرّج', () => {
    it('القفل بيحصل عند مضاعفات رصيد المحاولات بس', () => {
      expect(shouldLock(0)).toBe(false);
      expect(shouldLock(PIN_MAX_ATTEMPTS - 1)).toBe(false);
      expect(shouldLock(PIN_MAX_ATTEMPTS)).toBe(true);
      expect(shouldLock(PIN_MAX_ATTEMPTS * 2)).toBe(true);
    });

    it('المدة بتطوّل مع التكرار', () => {
      expect(lockoutMinutesFor(5)).toBe(1);
      expect(lockoutMinutesFor(10)).toBe(5);
      expect(lockoutMinutesFor(15)).toBe(15);
      expect(lockoutMinutesFor(20)).toBe(60);
      expect(lockoutMinutesFor(25)).toBe(240);
    });

    it('**مفيش قفل دائم** — آخر درجة بتفضل سارية مهما زاد', () => {
      expect(lockoutMinutesFor(500)).toBe(240);
      expect(lockoutMinutesFor(5_000)).toBe(240);
    });
  });

  describe('نص الوقت الفاضل', () => {
    const now = new Date('2026-09-24T10:00:00Z');
    it('بالدقايق تحت الساعة', () => {
      expect(lockRemainingTextAr(new Date('2026-09-24T10:01:00Z'), now)).toBe('1 دقيقة');
      expect(lockRemainingTextAr(new Date('2026-09-24T10:45:00Z'), now)).toBe('45 دقيقة');
    });
    it('بالساعات فوقها', () => {
      expect(lockRemainingTextAr(new Date('2026-09-24T14:00:00Z'), now)).toBe('4 ساعة');
    });
    it('قفل خلص بيتقال «دلوقتي» مش رقم سالب', () => {
      expect(lockRemainingTextAr(new Date('2026-09-24T09:00:00Z'), now)).toBe('دلوقتي');
    });
  });

  describe('تكلفة bcrypt', () => {
    it('١٢ على الأقل — الـPIN دائم و٦ أرقام، فمساحته كلها قابلة للمسح لو القاعدة اتسربت', () => {
      expect(PIN_BCRYPT_ROUNDS).toBeGreaterThanOrEqual(12);
    });

    it('الهاش الجديد versioned ومش قابل للتحقق من غير الـpepper الصحيح', async () => {
      const hash = await hashPin('194736', 'production-pepper-that-is-long-enough');
      expect(hash.startsWith(PIN_HASH_PREFIX)).toBe(true);
      expect(hash).not.toContain('194736');
      await expect(verifyPinHash('194736', hash, 'production-pepper-that-is-long-enough')).resolves.toBe(true);
      await expect(verifyPinHash('194736', hash, 'wrong-pepper')).resolves.toBe(false);
    });

    /**
     * السكربتات JS مش بتقدر تستورد TypeScript، فتكلفة الـbcrypt مكتوبة تاني في
     * `scripts/lib/pin-constants.js`. الاختبار ده هو اللي بيمنع القيمتين يفترقوا: من غيره حد
     * يرفع التكلفة هنا ويفضل `seed-dev-accounts.js` بيولّد هاشات أضعف **بصمت**.
     */
    it('مطابقة للقيمة المكتوبة في scripts/lib/pin-constants.js', () => {
      const file = join(__dirname, '../../../../../scripts/lib/pin-constants.js');
      const source = readFileSync(file, 'utf8');
      const match = /PIN_BCRYPT_ROUNDS:\s*(\d+)/.exec(source);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBe(PIN_BCRYPT_ROUNDS);
    });
  });
});
