/**
 * روابط السوشيال ميديا الرسمية — مطابق لـ`apps/api/src/modules/settings/social-links.controller.ts`.
 *
 * العقد بيرجّع **المضبوط بس**: الشبكة اللي الأدمن ما ملاش رابطها مش بتيجي في القايمة أصلاً،
 * فالواجهة مالهاش أي قرار تاخده — بتعرض اللي وصلها. ده اللي بيمنع أيقونة بتودّي لحتة فاضية
 * في فوتر بيتشاف من كل صفحة (docs/08 §136).
 */
export const SOCIAL_NETWORKS = ['facebook', 'instagram', 'tiktok', 'linkedin', 'youtube'] as const;

export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export interface SocialLink {
  network: SocialNetwork;
  url: string;
}

export const SOCIAL_LABELS_AR: Record<SocialNetwork, string> = {
  facebook: 'فيسبوك',
  instagram: 'إنستجرام',
  tiktok: 'تيك توك',
  linkedin: 'لينكدإن',
  youtube: 'يوتيوب',
};

/**
 * بيتنادى من Server Components (الفوتر). فشل الشبكة **ما ينفعش يكسر كل صفحة في الموقع** —
 * بيرجّع قايمة فاضية، فصف الأيقونات يختفي والفوتر يفضل شغّال زي ما هو.
 */
export async function fetchSocialLinks(): Promise<SocialLink[]> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
  try {
    const res = await fetch(`${base}/social-links`, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const envelope = (await res.json()) as { data?: { links?: SocialLink[] } };
    return envelope.data?.links ?? [];
  } catch {
    return [];
  }
}
