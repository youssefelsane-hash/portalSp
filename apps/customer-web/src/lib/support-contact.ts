/**
 * **بيانات تواصل الدعم — جلب من السيرفر** (ADR-0113).
 *
 * `components/support-contact-links.tsx` مكوّن عميل بيجلب في `useEffect`، وده **مايبانش في
 * الـHTML** — تمام لصفحة استرجاع الرمز، بس كارثة لصفحة الغرض منها الفهرسة: الزاحف مش هيشوف
 * بيانات التواصل خالص، والزائر مش هيشوفها في أول رسم.
 *
 * فبيتجلب هنا على السيرفر. الفشل بيرجّع `null` والقسم يختفي — نفس فلسفة `fetchSocialLinks`.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

export interface SupportContact {
  enabled: boolean;
  phone_number: string | null;
  whatsapp_number: string | null;
  whatsapp_url: string | null;
  email: string | null;
  help_url: string | null;
}

export async function fetchSupportContact(): Promise<SupportContact | null> {
  try {
    const res = await fetch(`${API_BASE}/settings/support-contact`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const envelope = (await res.json()) as { data?: SupportContact };
    const data = envelope.data;
    return data?.enabled ? data : null;
  } catch {
    return null;
  }
}
