import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * **حارس الواجهة الرفيعة** (تدقيق A-1، T-4).
 *
 * `orders.service.ts` كانت ٤٣١٩ سطر و٢٥ اعتمادية. بعد التقسيم لست شرايح بقت **٤٨٢ سطر بصفر
 * منطق عمل** — كل دالة عامة سطر تفويض واحد.
 *
 * المكسب ده **بيضيع بسهولة**: أسهل حاجة على أي مطوّر بعد كده إنه يكتب «كام سطر بس» جوّه دالة
 * في الواجهة بدل ما يفتح الشريحة الصح. عشر مرات كده والملف رجع تاني. الاختبار ده بيمنع
 * الانحدار ده **بنيويًا** بدل ما يعتمد على انضباط المراجعة.
 *
 * والتدقيق سجّل كمان (T-4) إن أكبر ملفين مالهمش `.spec.ts` مجاور — يعني مفيش مكان واحد بيوصف
 * **عقد الملف نفسه**. ده هو الملف ده.
 */
describe('OrdersService — واجهة رفيعة، مش مكان لمنطق جديد (تدقيق A-1/T-4)', () => {
  const source = readFileSync(join(__dirname, 'orders.service.ts'), 'utf8');
  const lines = source.split('\n');

  /** أسطر جسم الدوال العامة (بلا الـgetters اللي بتبني الشرايح، وبلا التعليقات). */
  function publicMethodBodies(): { name: string; body: string[] }[] {
    const methods: { name: string; body: string[] }[] = [];
    let current: { name: string; body: string[] } | null = null;
    let depth = 0;
    for (const line of lines) {
      const header = /^ {2}(?:async )?([a-zA-Z_][\w]*)\s*\(/.exec(line);
      if (header && !line.includes('private ') && !line.includes('constructor')) {
        current = { name: header[1], body: [] };
        depth = 0;
      }
      if (!current) continue;
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/**')) {
        current.body.push(trimmed);
      }
      if (depth === 0 && current.body.length > 1) {
        methods.push(current);
        current = null;
      }
    }
    return methods;
  }

  it('كل دالة عامة بتفوّض لشريحة — مفيش منطق عمل في الواجهة', () => {
    // التفويض المقبول: `return this.<شريحة>.<دالة>(...)` أو نداء بلا return.
    const DELEGATION = /^(return )?(await )?this\.(queries|rescheduleFlow|disputeFlow|technicianOps|creationFlow|cancellationFlow)\./;
    const offenders = publicMethodBodies()
      .filter((m) => {
        // السطور اللي فعلاً بتنفّذ حاجة — مش توقيع الدالة ولا قفلتها.
        const executable = m.body.filter((l) => /^(return |await |const |let |if |for |throw |this\.)/.test(l));
        return executable.length > 0 && !executable.every((l) => DELEGATION.test(l));
      })
      .map((m) => m.name);

    expect({ دوال_فيها_منطق_مش_تفويض: offenders }).toEqual({ دوال_فيها_منطق_مش_تفويض: [] });
  });

  it('الملف فضل في حدود الواجهة الرفيعة (سقف ٧٠٠ سطر)', () => {
    // السقف مش رقم تجميلي: الملف ٤٨٢ سطر دلوقتي، والمساحة اللي فوقه بتسمح بشرايح جديدة
    // تتضاف (getter + تفويضاتها) من غير ما تسمح برجوع منطق العمل.
    expect({ سطور: lines.length }).toEqual({ سطور: expect.any(Number) });
    expect(lines.length).toBeLessThan(700);
  });

  it('الشرايح الست كلها متبنيّة داخليًا — مفيش واحدة اترجعت للـconstructor', () => {
    // البناء الداخلي هو اللي بيخلي الـ٢٥ spec اللي بتبني الخدمة بوسائط ترتيبية تفضل شغّالة.
    for (const slice of ['queries', 'rescheduleFlow', 'disputeFlow', 'technicianOps', 'creationFlow', 'cancellationFlow']) {
      expect(source).toContain(`private get ${slice}()`);
      expect(source).not.toContain(`private readonly ${slice}:`);
    }
  });
});
