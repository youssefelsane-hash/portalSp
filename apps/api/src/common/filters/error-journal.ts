import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * **سجل الأعطال المفصّل — عشان كود الخطأ اللي على الموبايل يوصل لسببه في أمر واحد.**
 *
 * ## المشكلة اللي الملف ده موجود عشانها
 *
 * التطبيق بقى بيعرض `request_id` مع أي عطل ٥xx، والباك-إند بيطبعه في اللوج. بس ده بيفترض إن
 * اللوج **متسجّل في ملف** — واللي بيشغّل `npm run start:dev` في تيرمنال عادي بيلاقي السطر
 * اتلخبط وسط آلاف السطور، أو راح خالص لما التيرمنال اتقفل. بلاغ مالك حرفي: «حاولت أجيب لك
 * جزء من التيرمنال، ما لقيتش الـerror».
 *
 * السجل ده بيكتب كل عطل ٥xx في ملف مخصّص، سطر JSON واحد لكل عطل، **مهما كانت طريقة تشغيل
 * الـAPI**. والبحث بقى أمر واحد: `node scripts/find-error.js <كود>`.
 *
 * **بيئة التطوير بس**: في الإنتاج السجلات بتروح لمنظومة اللوجات، وكتابة الـstacks في ملف على
 * القرص هناك تسريب معلومات مش مطلوب.
 */
const PRODUCTION_LIKE = new Set(['production', 'staging']);

export function errorJournalPath(): string {
  return resolve(process.cwd(), process.env.ERROR_JOURNAL_PATH ?? '../../.dev-logs/errors.log');
}

export function errorJournalEnabled(): boolean {
  return !PRODUCTION_LIKE.has(process.env.NODE_ENV ?? '');
}

export interface JournalEntry {
  requestId: string;
  method: string;
  url: string;
  userId: string | null;
  message: string;
  stack: string | null;
}

/**
 * الكتابة **fire-and-forget عمدًا**: فشل الكتابة (قرص مليان، صلاحيات) مايصحّش يحوّل عطل ٥٠٠
 * لعطل تاني فوقه، ولا يأخّر الرد على المستخدم. نفس قاعدة المشروع في كل مسارات البنية التحتية.
 */
export function recordError(entry: JournalEntry): void {
  if (!errorJournalEnabled()) return;
  const path = errorJournalPath();
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`;
  void mkdir(dirname(path), { recursive: true })
    .then(() => appendFile(path, line, 'utf8'))
    .catch(() => undefined);
}
