import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

/**
 * **حارس بنيوي ضد فئة بَقّة استنزاف الـpool** (P0-1، ج-٥).
 *
 * البَقّة الأصلية: دالة بتاخد `manager: EntityManager` **إجباري** — يعني هي دايمًا جوّه
 * ترانزاكشن الكولر وماسكة اتصال قاعدة بالفعل — وبتنادي `this.dataSource.query(...)` جوّه
 * جسمها. النداء ده **بيطلب اتصال تاني** من نفس الـpool وهو ماسك الأول. تحت الضغط، الاتصالات
 * كلها بتبقى ماسكة اتصال ومستنية اتصال تاني مش موجود = **قفلة كاملة** والعملاء بياخدوا 503.
 *
 * الفشل ده مش بيبان في اختبار وحدة (اتصال واحد كفاية) ولا في تشغيلة عادية (الـpool واسع) —
 * بيبان بس تحت تزامن حقيقي، وساعتها بيبقى انقطاع خدمة. عشان كده الحارس **بنيوي**: بيقرا الكود
 * نفسه بـTypeScript AST ويفشل قبل ما الكود يوصل الإنتاج أصلاً.
 *
 * **إيه اللي مسموح عمدًا** (مش استثناءات مؤقتة، دول النمطين الصح):
 *  - `manager = this.dataSource.manager` كقيمة افتراضية للبراميتر — الكولر اللي جوّه ترانزاكشن
 *    بيبعت مانيجره، واللي بره بياخد الافتراضي. القيمة الافتراضية نفسها **مش** جوّه ترانزاكشن.
 *  - `manager?: EntityManager` اختياري مع `if (manager) … else this.dataSource.transaction(…)`
 *    — الفرع اللي بيفتح ترانزاكشن بيتنفّذ بس لما مفيش واحدة مفتوحة أصلاً.
 *
 * **الممنوع**: `manager` **إجباري بلا قيمة افتراضية** + أي `this.dataSource.` في جسم الدالة.
 */
const API_SRC = path.resolve(__dirname, '../..');

/** كل ملفات الخدمات — الحارس عام على المشروع مش مقصور على مسار المطابقة. */
function serviceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      serviceFiles(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  method: string;
  code: string;
}

function findViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const file of serviceFiles(API_SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes('this.dataSource')) continue;
    const src = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);

    const visit = (node: ts.Node): void => {
      if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) {
        const managerParam = node.parameters.find(
          (p) => ts.isIdentifier(p.name) && /^(manager|entityManager|txManager)$/i.test(p.name.text),
        );
        // إجباري = مفيش `?` ومفيش قيمة افتراضية. دي وحدها اللي بتضمن إن الدالة **دايمًا** جوّه
        // ترانزاكشن الكولر.
        const isRequired = !!managerParam && !managerParam.questionToken && !managerParam.initializer;
        if (isRequired && node.body) {
          const scan = (inner: ts.Node): void => {
            if (
              ts.isPropertyAccessExpression(inner) &&
              ts.isPropertyAccessExpression(inner.expression) === false &&
              inner.getText(src).startsWith('this.dataSource')
            ) {
              const { line } = src.getLineAndCharacterOfPosition(inner.getStart(src));
              violations.push({
                file: path.relative(API_SRC, file),
                line: line + 1,
                method: node.name ? node.name.getText(src) : '(anonymous)',
                code: inner.getText(src).slice(0, 80),
              });
            }
            inner.forEachChild(scan);
          };
          scan(node.body);
        }
      }
      node.forEachChild(visit);
    };
    visit(src);
  }
  return violations;
}

describe('انضباط الـEntityManager داخل الترانزاكشن (حارس استنزاف الـpool)', () => {
  it('مفيش دالة بتاخد manager إجباري وبتنادي this.dataSource في جسمها', () => {
    const violations = findViolations();
    const report = violations
      .map((v) => `  ${v.file}:${v.line} — ${v.method}() بتنادي ${v.code}`)
      .join('\n');
    expect(
      violations.length === 0 ? '' : `\nمخالفات انضباط الترانزاكشن (اتصال تاني وهي ماسكة واحد):\n${report}\n`,
    ).toBe('');
  });

  it('الحارس نفسه بيمسك الشكل الممنوع (مش بيعدّي على طول)', () => {
    // اختبار للحارس مش للكود: بنتأكد إن التحليل بيلاقي الحالة الخطر لما تتكتب فعلاً، عشان
    // ماينفعش يفضل أخضر لأنه مابيشوفش حاجة أصلاً.
    const sample = `
      class Sample {
        private dataSource: any;
        async bad(manager: any) { await this.dataSource.query('SELECT 1'); }
        async okDefault(manager = this.dataSource.manager) { await manager.query('SELECT 1'); }
        async okOptional(manager?: any) {
          if (manager) return manager.query('SELECT 1');
          return this.dataSource.transaction((m: any) => m.query('SELECT 1'));
        }
      }`;
    const src = ts.createSourceFile('sample.ts', sample, ts.ScriptTarget.ES2022, true);
    const flagged: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isMethodDeclaration(node)) {
        const p = node.parameters.find((x) => ts.isIdentifier(x.name) && x.name.text === 'manager');
        if (p && !p.questionToken && !p.initializer && node.body) {
          const scan = (inner: ts.Node): void => {
            if (ts.isPropertyAccessExpression(inner) && inner.getText(src).startsWith('this.dataSource')) {
              flagged.push(node.name.getText(src));
            }
            inner.forEachChild(scan);
          };
          scan(node.body);
        }
      }
      node.forEachChild(visit);
    };
    visit(src);
    expect([...new Set(flagged)]).toEqual(['bad']);
  });
});
