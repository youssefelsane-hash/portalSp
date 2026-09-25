// عنوان الباك-إند — سيرفر-سايد بس (Route Handlers)، نفس نمط apps/admin/src/lib/backend.ts
// بالحرف (مُراجَع أمنيًا Script 2 task #41). مش بيتعرض للمتصفح مباشرة.
export function backendUrl(path: string): string {
  const base = process.env.API_URL ?? 'http://localhost:3000/api/v1';
  return `${base}${path}`;
}

export const REFRESH_TOKEN_COOKIE = 'sonaa_refresh_token';

/**
 * **مصدر واحد لكوكي الجلسة** — كان مكتوب بالحرف في كل مسار بيرجّع توكنز (`otp/verify`،
 * `register`، `refresh`)، فأي تعديل أمني (مثلاً `sameSite` أو المدة) كان لازم يتكرر في كل
 * واحد منهم، وأي واحد يتنسى بيبقى **أضعف من الباقي بصمت**.
 *
 * `httpOnly` هو جوهر الحماية: الـrefresh token مايوصلش لجافاسكريبت الصفحة خالص، فأي XSS
 * ماياخدهوش. الـ`access_token` بيرجع في الـbody ويعيش في الذاكرة بس.
 */
export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 30, // مطابق JWT_REFRESH_EXPIRES_IN الافتراضي في apps/api
} as const;
