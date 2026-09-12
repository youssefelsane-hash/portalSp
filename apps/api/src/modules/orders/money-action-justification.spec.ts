import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ProposeQuoteItemsDto } from './dto/propose-quote-items.dto';
import { SubmitInitialQuoteDto } from './dto/submit-initial-quote.dto';
import { OrderItemType } from './entities/order-item.entity';

/**
 * ADR-0084 §2 (طلب مالك docs/08 §139 بند ٣): «لما ييجي يزود السعر يبقى فيه خانة إجبارية، أو
 * مثلاً يعمل معاينة يبقى فيه خانة إجبارية».
 *
 * الاختبار ده بيقيس **العقد نفسه** مش الخدمة: البوابة دي كلها `class-validator` decorators،
 * فالمكان الصح لإثباتها هو نفس الـpipeline اللي NestJS بيشغّله على الـbody.
 *
 * الحد الأدنى (١٠ حروف) هو نص القرار مش تفصيلة: خانة إجبارية بتتملا بنقطة مابتراجعش حاجة.
 */
describe('تبرير إجباري لأي فعل بيزوّد فلوس الطلب (ADR-0084 §2)', () => {
  const validate = <T extends object>(cls: new () => T, payload: object) =>
    validateSync(plainToInstance(cls, payload), { whitelist: true, forbidNonWhitelisted: false });

  /** أخطاء البنود بتيجي متداخلة جوّه `items` — بنفردها عشان نقرا اسم الحقل الحقيقي. */
  const flatProperties = (errors: ReturnType<typeof validateSync>): string[] =>
    errors.flatMap((e) => [e.property, ...(e.children ?? []).flatMap((c) => (c.children ?? []).map((g) => g.property))]);

  const baseItem = {
    item_type: OrderItemType.SPARE_PART,
    name_ar: 'مواسير نحاس',
    quantity: 2,
    unit_price_cents: 15000,
  };

  describe('بند إضافي (قطعة غيار / أجر زيادة / إضافة)', () => {
    it('بلا تبرير خالص = مرفوض', () => {
      const errors = validate(ProposeQuoteItemsDto, { items: [baseItem] });
      expect(errors.length).toBeGreaterThan(0);
      expect(flatProperties(errors)).toContain('description');
    });

    it('تبرير صوري (نقطة/كلمة) = مرفوض — الخانة الإجبارية اللي بتتملا بنقطة مابتراجعش حاجة', () => {
      for (const description of ['.', 'تمام', 'قطعة']) {
        const errors = validate(ProposeQuoteItemsDto, { items: [{ ...baseItem, description }] });
        expect(flatProperties(errors)).toContain('description');
      }
    });

    it('تبرير حقيقي = مقبول', () => {
      const errors = validate(ProposeQuoteItemsDto, {
        items: [{ ...baseItem, description: 'المواسير القديمة متآكلة والتسريب من عندها' }],
      });
      expect(errors).toHaveLength(0);
    });
  });

  describe('عرض السعر بعد المعاينة', () => {
    const baseQuote = { quoted_amount_cents: 120000 };

    it('بلا تشخيص = مرفوض', () => {
      const errors = validate(SubmitInitialQuoteDto, baseQuote);
      expect(errors.map((e) => e.property)).toContain('diagnosis');
    });

    it('تشخيص صوري = مرفوض', () => {
      const errors = validate(SubmitInitialQuoteDto, { ...baseQuote, diagnosis: 'بايظ' });
      expect(errors.map((e) => e.property)).toContain('diagnosis');
    });

    it('تشخيص حقيقي = مقبول', () => {
      const errors = validate(SubmitInitialQuoteDto, {
        ...baseQuote,
        diagnosis: 'الكومبريسور بايظ بالكامل ومحتاج تغيير، والفريون فاضي',
      });
      expect(errors).toHaveLength(0);
    });
  });
});
