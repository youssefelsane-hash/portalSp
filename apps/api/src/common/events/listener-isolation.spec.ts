import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

/**
 * **حارس بنيوي: أي `@OnEvent` لازم يكون معزول عن الفشل** (ج-١٢).
 *
 * فئة البَقّة — ومش نظرية، هي مبنية في المسار الأساسي:
 * `order-creation.service.ts` بينادي **`emitAsync`** (مش `emit`) لـ`ORDER_CREATED_EVENT`
 * و**بيستنى** كل المستمعين. ده مقصود وموثّق: التوزيع للفنيين لازم يخلص قبل ما `create()` ترجع،
 * وإلا الفني بياخد «العرض مبقاش متاح» لو ندّه فورًا.
 *
 * لكن `emitAsync` **بترمي لو أي مستمع رمى**. يعني مستمع إشعارات واحد بلا حماية بيخلّي العميل
 * ياخد `500` على طلب **اتسجّل واتوزّع بالفعل** — أسوأ نتيجة ممكنة: الطلب موجود، والعميل فاكر
 * إنه فشل، فبيعيد الحجز.
 *
 * والأخطر إن ده **بيعدّي من كل الاختبارات**: المستمع بيشتغل صح في الحالة الطبيعية، والفشل
 * بيظهر بس لما FCM أو SMTP أو القاعدة تتعثّر — يعني في الإنتاج وقت الضغط بالظبط.
 *
 * **الشكلين المقبولين للعزل**:
 *  1. `try { … } catch { سجّل }` حوالين جسم الـhandler.
 *  2. `Promise.allSettled([...])` — بتجمع النتايج بلا رمي (نمط مستخدم فعلاً في
 *     `order-rescheduled-notification.listener.ts`).
 *
 * **ملاحظة**: الحارس ده **مش** بيمنع مستمع من الرمي عمدًا لو ده مقصود (مستمع بيمثّل خطوة
 * أساسية مش side effect). في الحالة دي الحل إن الحماية تبقى مكتوبة صراحةً — والقايمة تحت هي
 * المكان اللي القرار ده بيتسجّل فيه.
 */
const API_SRC = path.resolve(__dirname, '../..');

/**
 * **نطاق الحارس: الأحداث اللي بتتبعت بـ`emitAsync` بس** — وده مقصود ومحسوب.
 *
 * `emit()` العادي **مابيستناش** المستمعين، فرمي المستمع بيبقى `unhandledRejection` (مزعج
 * ومتعامَل معاه في `main.ts`) لكنه **مابيوصلش للمستخدم**. `emitAsync` عكس كده تمامًا: الكولر
 * بيستنى، والرمي بيرجع له — يعني بيوصل للعميل كـ`500`.
 *
 * فالحارس بيطبّق القاعدة على المسار اللي الخطر فيه حقيقي بس. حارس بيشتكي من ٥٧ مستمع تسعتهم
 * غير مؤثر بيتحوّل لضوضاء بتتجاهل — وده أسوأ من مفيش حارس.
 *
 * **لو حدث جديد اتبعت بـ`emitAsync`، ضيف اسمه هنا** — وإلا مستمعينه هيفضلوا بلا تغطية.
 */
const AWAITED_EVENTS = new Set(['ORDER_CREATED_EVENT', 'SETTING_UPDATED_EVENT']);

/**
 * مستمعون مستثنون **بقرار مكتوب**. أي إضافة هنا لازم يكون معاها سبب — القايمة دي هي التوثيق
 * نفسه، مش قايمة تجاهل.
 */
const INTENTIONALLY_UNGUARDED = new Map<string, string>([
  // المستمعين دول **مش** side effects — هما جزء من نجاح العملية نفسها. `SettingsService.update()`
  // بينادي `emitAsync` بالظبط عشان يستنى إعادة تحميل إعدادات البوابة قبل ما يرجّع نجاح الـPATCH
  // للأدمن. لو إعادة التحميل فشلت، **الأدمن لازم يشوف الفشل**: الإعداد اتحفظ في القاعدة بس
  // البوابة لسه شغّالة بالقيمة القديمة، وإخفاء ده بيدّي «تم الحفظ» كاذبة على تغيير ما سراش.
  //
  // والفرق المهم: المتأثر هنا **أدمن بيغيّر إعداد**، مش عميل بيحجز — فالفشل الظاهر أصح من
  // النجاح الكاذب. عكس مسار الحجز بالظبط.
  [
    'InstaPayProvider.handleSettingUpdated',
    'إعادة تحميل إعدادات InstaPay جزء من نجاح PATCH الإعداد — فشلها لازم يوصل للأدمن',
  ],
  [
    'PaymobProvider.handleSettingUpdated',
    'إعادة تحميل إعدادات Paymob جزء من نجاح PATCH الإعداد — فشلها لازم يوصل للأدمن',
  ],
  // الاتنين دول جسمهم **نداء واحد** لـ`emitTopic`، وهي بتلقّط جوّاها (شوف التعليق عندها).
  // العزل موجود فعلاً — بس في المستوى اللي تحت، والحارس بيقرا جسم الـhandler مش الدالة اللي
  // بينادوها. لفّهم بـtry/catch كمان كان هيبقى تكرار بلا فايدة على ٣٥ handler في نفس الملف.
  ['AdminRealtimeGateway.onOrderCreated', 'الجسم نداء واحد لـemitTopic اللي بتلقّط جوّاها'],
  ['AdminRealtimeGateway.onSettingUpdated', 'الجسم نداء واحد لـemitTopic اللي بتلقّط جوّاها'],
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      sourceFiles(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.d.ts')) {
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

/** هل جسم الدالة معزول؟ `try/catch` على مستوى الجسم، أو `Promise.allSettled` جوّاه. */
function isIsolated(method: ts.MethodDeclaration): boolean {
  const body = method.body;
  if (!body) return true; // تعريف مجرّد — مفيش جسم يرمي

  // كل تعليمة في الجسم إما `try` أو تصريح متغيّر بسيط — يعني الشغل الفعلي جوّه `try`.
  const meaningful = body.statements.filter(
    (s) => !ts.isVariableStatement(s) && !ts.isEmptyStatement(s) && !ts.isReturnStatement(s),
  );
  if (meaningful.length > 0 && meaningful.every((s) => ts.isTryStatement(s) && !!s.catchClause)) return true;

  // أو النمط التاني: `Promise.allSettled(...)` جوّه الجسم — بتجمع الرفض بلا رمي.
  let hasAllSettled = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'allSettled' &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Promise'
    ) {
      hasAllSettled = true;
    }
    node.forEachChild(visit);
  };
  visit(body);
  return hasAllSettled;
}

interface Unguarded {
  file: string;
  line: number;
  handler: string;
}

function findUnguardedListeners(files: string[]): Unguarded[] {
  const unguarded: Unguarded[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes('@OnEvent')) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isMethodDeclaration(node)) {
        const onEvent = decoratorsOf(node).find((d) => decoratorName(d) === 'OnEvent');
        const listensToAwaited =
          !!onEvent &&
          ts.isCallExpression(onEvent.expression) &&
          onEvent.expression.arguments.some((a) => ts.isIdentifier(a) && AWAITED_EVENTS.has(a.text));
        if (listensToAwaited && !isIsolated(node)) {
          const rel = path.relative(API_SRC, file);
          const handler = `${(node.parent as ts.ClassDeclaration)?.name?.text ?? '?'}.${node.name.getText()}`;
          if (!INTENTIONALLY_UNGUARDED.has(handler)) {
            unguarded.push({
              file: rel,
              line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              handler,
            });
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(source);
  }
  return unguarded;
}

describe('عزل مستمعي الأحداث عن المسار الأساسي (ج-١٢)', () => {
  it('كل مستمع لحدث مُنتظَر (emitAsync) معزول بـtry/catch أو Promise.allSettled', () => {
    const unguarded = findUnguardedListeners(sourceFiles(API_SRC));
    const report = unguarded.map((u) => `${u.file}:${u.line} ${u.handler}`).join('\n');
    expect(report).toBe('');
  });

  /**
   * الحارس نفسه بيمسك المخالفة فعلاً — من غير ده، «صفر مخالفات» ممكن يبقى معناه إن الفحص
   * بيدوّر غلط، مش إن الكود سليم.
   */
  it('الحارس بيرصد مستمعًا بلا حماية لو اتضاف (اختبار ذاتي)', () => {
    const sample = path.join(API_SRC, '__listener_isolation_selftest.ts');
    fs.writeFileSync(
      sample,
      `import { OnEvent } from '@nestjs/event-emitter';
       const ORDER_CREATED_EVENT = 'order.created';
       const SOME_OTHER_EVENT = 'other';
       export class SampleListener {
         @OnEvent(ORDER_CREATED_EVENT) async guarded() { try { await this.work(); } catch { /* سجّل */ } }
         @OnEvent(ORDER_CREATED_EVENT) async settled() { await Promise.allSettled([this.work()]); }
         @OnEvent(ORDER_CREATED_EVENT) async exposed() { await this.work(); }
         @OnEvent(SOME_OTHER_EVENT) async notAwaited() { await this.work(); }
         async work() {}
       }`,
      'utf8',
    );
    try {
      const found = findUnguardedListeners([sample]);
      // `notAwaited` مستمع لحدث **مش** مُنتظَر — رميه مابيوصلش للمستخدم، فالحارس بيسيبه عمدًا.
      expect(found.map((f) => f.handler)).toEqual(['SampleListener.exposed']);
    } finally {
      fs.unlinkSync(sample);
    }
  });
});
