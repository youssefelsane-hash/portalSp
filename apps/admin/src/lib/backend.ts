// عنوان الباك-إند — سيرفر-سايد بس (Route Handlers)، مش بيتعرض للمتصفح مباشرة.
export function backendUrl(path: string): string {
  const base = process.env.API_URL ?? 'http://localhost:3000/api/v1';
  return `${base}${path}`;
}

export const REFRESH_TOKEN_COOKIE = 'baytak_refresh_token';
