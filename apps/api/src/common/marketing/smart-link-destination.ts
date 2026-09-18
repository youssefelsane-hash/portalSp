import { SettingsService } from '../../modules/settings/settings.service';

/**
 * **وجهة الرابط الذكي** — المصدر الواحد لسؤال «الزائر ده يروح فين؟» (docs/08 §165).
 *
 * أي QR/رابط في المنصة (كود خصم، مصدر تسويق، ترشيح فني) بيوصّل لنفس القرار: أندرويد للمتجر،
 * iOS للمتجر، وأي حاجة تانية لصفحة الهبوط. الستة سطور دي كانت **متكررة حرفيًا** في
 * `marketing.service.ts` و`promo-code-links.service.ts`، وإضافة ترشيح الفني كانت هتخليها
 * تلات نسخ — يعني تغيير رابط المتجر يوم هيتنسى في واحدة منهم.
 *
 * **ولا مرة بترجّع فاضي**: الملصق المطبوع عايش شهور، فالزائر لازم يوصل لحاجة حتى لو الإعدادات
 * مش متظبطة — الترتيب: متجر المنصة ⇐ صفحة الهبوط ⇐ عنوان الويب من البيئة ⇐ `/`.
 */
export type SmartLinkPlatform = 'android' | 'ios' | 'web' | 'other';

export async function resolveSmartLinkTarget(
  settings: SettingsService,
  platform: SmartLinkPlatform,
): Promise<string> {
  const [android, ios, landing] = await Promise.all([
    settings.getString('marketing.android_store_url', ''),
    settings.getString('marketing.ios_store_url', ''),
    settings.getString('marketing.web_landing_url', ''),
  ]);
  const fallback = landing.trim() || process.env.CUSTOMER_WEB_URL || process.env.WEB_APP_URL || '/';
  const storeUrl = platform === 'android' ? android.trim() : platform === 'ios' ? ios.trim() : '';
  return storeUrl || fallback;
}

/**
 * بيضيف وسم الرحلة على الوجهة — كل نوع رابط وسمه الخاص، والوجهة نفسها مشتركة.
 *
 * `target` ممكن يكون `/` أو رابط متجر فيه `?id=…` أصلاً، فالفاصل بيتحدد وقت التشغيل.
 */
export function appendLinkParams(target: string, params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  if (!query) return target;
  if (!target || target === '/') return `/?${query}`;
  return `${target}${target.includes('?') ? '&' : '?'}${query}`;
}
