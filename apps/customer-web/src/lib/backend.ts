// عنوان الباك-إند — سيرفر-سايد بس (Route Handlers)، نفس نمط apps/admin/src/lib/backend.ts
// بالحرف (مُراجَع أمنيًا Script 2 task #41). مش بيتعرض للمتصفح مباشرة.
export function backendUrl(path: string): string {
  const base = process.env.API_URL ?? 'http://localhost:3000/api/v1';
  return `${base}${path}`;
}

export const REFRESH_TOKEN_COOKIE = 'sonaa_refresh_token';
