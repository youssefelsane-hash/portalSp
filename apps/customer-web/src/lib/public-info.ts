/**
 * بيانات عامة بتتقرا من **Server Components** (صفحات `/about` و`/join` والفوتر).
 *
 * ليه مش `api-client.ts`؟ ده بيشتغل في المتصفح (بيضيف `Authorization` و`funnelHeaders()` اللي
 * بتقرا من `document`)، والصفحات دي بتترسم على السيرفر. فنفس نمط `fetchLegalEntity()` بالحرف:
 * `fetch` مباشر بـ`revalidate`، و**أي فشل بيرجع فاضي مش بيرمي** — الصفحتين دول موصولين من
 * الفوتر اللي بيتعرض على كل صفحة، فعطل في السيرفر مايتحوّلش لصفحة ٥٠٠ على رابط عام.
 */
const API_BASE = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

/** مدة الكاش. البيانات دي إدارية بتتغيّر نادرًا، والصفحات عامة بالكامل. */
const REVALIDATE_SECONDS = 300;

async function getPublic<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE()}${path}`, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) return null;
    const envelope = (await res.json()) as { data?: T };
    return envelope.data ?? null;
  } catch {
    return null;
  }
}

export interface CoverageCity {
  id: string;
  name_ar: string;
  name_en: string;
}

/**
 * مدن التغطية الفعلية — `GET /cities` بيرجّع المدن **النشطة بس**، فالقايمة دي بتوصف تغطية
 * حقيقية مش وعد تسويقي. لو رجعت فاضية، الصفحة بتقول كده صراحة بدل ما تخترع مدن.
 */
export async function fetchCoverageCities(): Promise<CoverageCity[]> {
  const data = await getPublic<CoverageCity[]>('/cities');
  return Array.isArray(data) ? data : [];
}

/**
 * بيانات التواصل للصفحات اللي بتترسم على السيرفر.
 *
 * **مش نفس `fetchSupportContact()` في `settings.ts` عن قصد**: النسخة دي بتعدّي على
 * `api-client.ts` اللي بيستورد `funnelHeaders()` من `funnel.ts` المعلّم `'use client'` —
 * ونداء دالة من موديول كلاينت جوّه Server Component بيرمي. النتيجة كانت هتبقى «بيانات
 * التواصل فاضية دايمًا في الفوتر» بصمت (الاستثناء متلقّط)، مش خطأ ظاهر يتصلح.
 */
export interface PublicSupportContact {
  enabled: boolean;
  phone_number: string | null;
  whatsapp_url: string | null;
  email: string | null;
}

export async function fetchSupportContactServer(): Promise<PublicSupportContact | null> {
  return getPublic<PublicSupportContact>('/settings/support-contact');
}

export interface TrustInfo {
  warranty_days: number;
  warranty_label_ar: string;
}

/**
 * مدة الضمان النافذة دلوقتي. **ممنوع** كتابة أي مدة ضمان كنص ثابت في أي صفحة — نفس سبب وجود
 * `TrustInfoController` أصلاً: النص الثابت بيتحوّل لكذب أول ما الإعدادات تتغيّر.
 */
export async function fetchTrustInfo(): Promise<TrustInfo | null> {
  return getPublic<TrustInfo>('/trust-info');
}
