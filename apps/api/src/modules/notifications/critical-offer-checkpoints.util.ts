// checkpoints تذكير critical_offer (ADR-0012 كان أجّل بناءها صراحة، docs/08 §17.16) — دورة
// قصيرة محصورة جوّه نافذة عرض الطلب نفسها (sentAt → expiresAt، عادةً ثواني قليلة لعرض طوارئ)،
// مش فاصل ثابت متكرر زي action_required ولا سلسلة أيام زي scheduled_job. النِسَب (ratios) قابلة
// للتعديل الكامل من الأدمن — عدد التذكيرات وموضعها جوّه النافذة بيتغيّر بتغييرها، بلا كود جديد.

/** بيرجّع أوقات التذكير المرشّحة جوّه [sentAt, expiresAt) بس — نسبة ≤0 أو ≥1 بتتفلتر تلقائيًا. */
export function computeCriticalOfferCheckpoints(sentAt: Date, expiresAt: Date, ratios: number[]): Date[] {
  const windowMs = expiresAt.getTime() - sentAt.getTime();
  if (windowMs <= 0) return [];

  return ratios
    .filter((r) => r > 0 && r < 1)
    .map((r) => new Date(sentAt.getTime() + windowMs * r))
    .filter((t) => t > sentAt && t < expiresAt)
    .sort((a, b) => a.getTime() - b.getTime());
}
