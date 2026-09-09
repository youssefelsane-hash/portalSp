import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

/**
 * **حارس بنيوي: كل مسار أدمن لازم يكون له قرار تصريح مكتوب** (ج-٨).
 *
 * فئة البَقّة: `@Roles(UserType.ADMIN)` على الكنترولر بيمنع العميل والفني، بس **مابيفرّقش بين
 * موظف وموظف**. مسار أدمن بلا `@RequirePermission` معناه إن **أي موظف مهما كان دوره ضعيف** —
 * مدخل بيانات، كول سنتر — يقدر ينفّذه. ده بالظبط بند «employee↛admin» في قايمة المالك.
 *
 * والخطر إنه **صامت**: الكود بيشتغل، الاختبارات بتعدّي، والأدمن بيشوف الشاشة شغّالة. الفرق
 * مايبانش غير لما موظف يعمل حاجة مكانش المفروض يعملها — وساعتها بيبقى حادثة مش بَقّة.
 *
 * عشان كده الحارس بنيوي مش حي: التدقيق الحي (`scripts/security-audit.js`) بيثبت إن الحُرّاس
 * شغّالة على المسارات اللي فكّرنا فيها؛ الحارس ده بيضمن إن **مسار جديد** مايعدّيش بلا قرار.
 *
 * **قرارين مقبولين، والتالت ممنوع**:
 *  1. `@RequirePermission('x.y')` — صلاحية دقيقة. الوضع الافتراضي لأي مسار أدمن.
 *  2. `@AnyAdmin('السبب')` — مفتوح لأي موظف **بقرار مكتوب وسبب إجباري**. ده مقصود لقراءة/كتابة
 *     ذاتية بحتة (الموظف بيقرا صلاحياته هو، بيسجّل نبضة حضوره هو) — حاجة مالهاش أي معنى تتقيّد
 *     بصلاحية لأنها مش بتلمس بيانات حد تاني أصلاً.
 *  3. **ولا حاجة** — ممنوع. السكوت مش قرار، وده اللي الاختبار ده بيفشل عليه.
 *
 * الصلاحية على مستوى الكلاس بتغطي كل الـhandlers تحتها — الحارس بيحترم ده.
 */
const API_SRC = path.resolve(__dirname, '../..');
const HTTP_METHODS = new Set(['Get', 'Post', 'Patch', 'Put', 'Delete']);

function controllerFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      controllerFiles(full, out);
    } else if (entry.name.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out;
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function decoratorName(d: ts.Decorator): string | null {
  if (!ts.isCallExpression(d.expression)) return null;
  return ts.isIdentifier(d.expression.expression) ? d.expression.expression.text : null;
}

function firstStringArg(d: ts.Decorator): string | null {
  if (!ts.isCallExpression(d.expression)) return null;
  const [arg] = d.expression.arguments;
  return arg && ts.isStringLiteralLike(arg) ? arg.text : null;
}

interface Uncovered {
  file: string;
  line: number;
  handler: string;
  route: string;
}

function findUncoveredHandlers(files: string[]): Uncovered[] {
  const uncovered: Uncovered[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    source.forEachChild((node) => {
      if (!ts.isClassDeclaration(node)) return;
      const classDecorators = decoratorsOf(node);
      const controller = classDecorators.find((d) => decoratorName(d) === 'Controller');
      if (!controller) return;
      const prefix = firstStringArg(controller) ?? '';
      // بس مسارات الأدمن — مسارات العميل والفني حراستها بالملكية (اتقاست في «أ» و«ب» من ج-٨).
      if (!prefix.startsWith('admin')) return;

      const coveredAtClass = classDecorators.some(
        (d) => decoratorName(d) === 'RequirePermission' || decoratorName(d) === 'AnyAdmin',
      );
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        const memberDecorators = decoratorsOf(member);
        const http = memberDecorators.find((d) => {
          const name = decoratorName(d);
          return name !== null && HTTP_METHODS.has(name);
        });
        if (!http) continue;
        const covered =
          coveredAtClass ||
          memberDecorators.some(
            (d) => decoratorName(d) === 'RequirePermission' || decoratorName(d) === 'AnyAdmin',
          );
        if (covered) continue;
        uncovered.push({
          file: path.relative(API_SRC, file),
          line: source.getLineAndCharacterOfPosition(member.getStart()).line + 1,
          handler: `${node.name?.text ?? '?'}.${member.name.getText()}`,
          route: `/${prefix}/${firstStringArg(http) ?? ''}`,
        });
      }
    });
  }
  return uncovered;
}

describe('كل مسار أدمن له قرار تصريح صريح (ج-٨)', () => {
  it('مفيش handler أدمن بلا @RequirePermission ولا @AnyAdmin', () => {
    const uncovered = findUncoveredHandlers(controllerFiles(API_SRC));
    const report = uncovered.map((u) => `${u.file}:${u.line} ${u.handler} → ${u.route}`).join('\n');
    expect(report).toBe('');
  });

  /**
   * `@AnyAdmin` بيقبل سبب كنص إجباري. من غير النص، الديكوريتور بيتحوّل لطريقة صامتة لتخطّي
   * الصلاحيات — بالظبط الحاجة اللي الحارس ده موجود يمنعها. الفحص ده بيمنع تفريغه من معناه.
   */
  it('كل @AnyAdmin مكتوب معاه سبب مش فاضي', () => {
    const missingReason: string[] = [];
    for (const file of controllerFiles(API_SRC)) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        for (const d of decoratorsOf(node)) {
          if (decoratorName(d) !== 'AnyAdmin') continue;
          const reason = firstStringArg(d);
          if (!reason || reason.trim().length < 10) {
            missingReason.push(
              `${path.relative(API_SRC, file)}:${source.getLineAndCharacterOfPosition(d.getStart()).line + 1}`,
            );
          }
        }
        node.forEachChild(visit);
      };
      visit(source);
    }
    expect(missingReason.join('\n')).toBe('');
  });

  /** الحارس نفسه بيمسك المخالفة فعلاً — من غير ده، «صفر مخالفات» ممكن يبقى معناه إنه بيدوّر غلط. */
  it('الحارس بيرصد مسار أدمن مكشوف لو اتضاف (اختبار ذاتي)', () => {
    const sample = path.join(API_SRC, '__admin_coverage_selftest.controller.ts');
    fs.writeFileSync(
      sample,
      `import { Controller, Get } from '@nestjs/common';
       @Controller('admin/selftest')
       export class SelfTestController {
         @Get('covered') @RequirePermission('orders.view') covered() { return null; }
         @Get('exposed') exposed() { return null; }
       }`,
      'utf8',
    );
    try {
      const found = findUncoveredHandlers([sample]);
      expect(found.map((f) => f.handler)).toEqual(['SelfTestController.exposed']);
    } finally {
      fs.unlinkSync(sample);
    }
  });
});
