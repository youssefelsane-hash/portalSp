import { returningFirst, returningRows } from './returning-rows';

/**
 * الأشكال اللي في الاختبار ده **مقاسة** من الدرايفر الحقيقي (شوف جدول القياس في
 * `returning-rows.ts`)، مش مفترضة. أي تغيير في TypeORM بيكسر الافتراض ده لازم يكسر هنا الأول.
 */
describe('returningRows', () => {
  it('بترجّع الصفوف زي ما هي لنتيجة SELECT/INSERT', () => {
    expect(returningRows<{ id: number }>([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('بتفك [rows, affectedCount] بتاعة UPDATE/DELETE … RETURNING', () => {
    expect(returningRows<{ id: number }>([[{ id: 1 }, { id: 2 }], 2])).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('UPDATE ماأثّرش على أي صف → مصفوفة فاضية مش [[],0]', () => {
    expect(returningRows([[], 0])).toEqual([]);
  });

  it('SELECT بلا نتايج → مصفوفة فاضية', () => {
    expect(returningRows([])).toEqual([]);
  });

  it('قيمة مش مصفوفة (null/undefined) مابتكسرش', () => {
    expect(returningRows(null)).toEqual([]);
    expect(returningRows(undefined)).toEqual([]);
  });

  it('صف واحد من UPDATE … RETURNING بيوصل ككائن مش كمصفوفة', () => {
    // ده بالظبط الفرق اللي خلّى `const [x] = await query(...)` يحط مصفوفة في `x`.
    expect(returningFirst<{ id: number }>([[{ id: 7 }], 1])).toEqual({ id: 7 });
    expect(returningFirst([[], 0])).toBeUndefined();
  });
});
