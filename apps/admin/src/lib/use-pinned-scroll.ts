'use client';

import { useEffect, useRef, type RefObject } from 'react';

/** المسافة (px) من آخر الحاوية اللي تحتها نعتبر المستخدم "ماسك آخر الشات". */
const PINNED_THRESHOLD_PX = 120;

/**
 * تمرير تلقائي لآخر الشات **بس لو المستخدم أصلاً في الآخر** (docs/08 §63.ب3).
 *
 * البَقّة اللي المالك وصفها: «أنا فوق في الشات عشان أقرا، ألاقي الصفحة بتعمل سكرول لتحت
 * أوتوماتيك». السبب إن الشاشة كانت بتعمل `scrollIntoView()` جوّه
 * `useEffect(..., [messages])` — والـpolling بيستبدل مصفوفة الرسايل كل بضع ثوانٍ حتى لو
 * محتواها ما اتغيّرش، فالـeffect كان بيشتغل ويخطف مكان المستخدم كل دورة.
 *
 * الإصلاح هنا مبني على مبدأين:
 * 1. **قياس نية المستخدم قبل التحديث**: لو هو فعلاً في آخر الشات (جوّه العتبة) يبقى عايز
 *    يتابع الجديد؛ لو طالع فوق يبقى بيقرا وما ينفعش نقاطعه.
 * 2. **مفتاح محتوى مش مرجع مصفوفة**: التمرير بيحصل لما محتوى الرسايل يتغيّر فعلاً، مش مع كل
 *    استجابة polling بترجّع نفس البيانات في مصفوفة جديدة.
 *
 * @param containerRef حاوية الرسايل اللي بتعمل scroll.
 * @param contentKey  مفتاح بيتغيّر بس لما الرسايل تتغيّر فعليًا (مثلاً العدد + id آخر رسالة).
 */
export function usePinnedScroll(
  containerRef: RefObject<HTMLElement | null>,
  contentKey: string,
): void {
  // بيتقاس **قبل** ما المتصفح يرسم التحديث الجديد، عشان نعرف مكان المستخدم قبل زيادة الارتفاع.
  const wasPinned = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      wasPinned.current = el.scrollHeight - el.scrollTop - el.clientHeight <= PINNED_THRESHOLD_PX;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!wasPinned.current) return;
    el.scrollTop = el.scrollHeight;
  }, [containerRef, contentKey]);
}

/** مفتاح محتوى مستقر لأي قايمة رسايل — بيتغيّر بس لما يوصل جديد أو يتعدّل الآخر. */
export function messagesContentKey(messages: { id: string }[] | null): string {
  if (!messages || messages.length === 0) return 'empty';
  return `${messages.length}:${messages[messages.length - 1].id}`;
}
