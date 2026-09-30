'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isValidPhoneInput, phoneNumberForApi } from '@baytak/shared-types';
import { apiFetch } from './api-client';

/**
 * **توجيه تلقائي بين الدخول والتسجيل** (docs/08 §189 بند UX-2، ADR-0115).
 *
 * المستخدم غير التقني بيكتب رقمه في أي صفحة يلاقيها. لما الرقم يكمل صح بنسأل السيرفر مرة واحدة
 * «مسجّل ولا لأ؟»، ولو هو في الصفحة الغلط بنقوله بوضوح وبننقله بالرقم مكتوب جاهز بعد لحظة. الانتقال
 * **مش إجباري**: فيه «خليني هنا»، وأي فشل للسؤال (مقفول من الأدمن، حد المعدل، شبكة) بيسيب الصفحة
 * بالسلوك القديم بالظبط من غير أي رسالة.
 */
export type PhoneRoutingMode = 'login' | 'register';

/** مهلة الانتقال: كفاية يقرا السطر، وقصيرة كفاية إنه مايحسّش إن الصفحة وقفت. */
export const PHONE_ROUTING_DELAY_MS = 2200;
const LOOKUP_DEBOUNCE_MS = 450;

export interface PhoneRoutingState {
  /** الرسالة الظاهرة لما الرقم في الصفحة الغلط — null لو مفيش توجيه. */
  notice: string | null;
  target: string | null;
  goNow: () => void;
  stay: () => void;
}

export function routeTargetFor(mode: PhoneRoutingMode, phone: string): string {
  const query = `phone=${encodeURIComponent(phone.trim())}&from=${mode}`;
  return mode === 'login' ? `/register?${query}` : `/login?${query}`;
}

export function usePhoneRegistrationRouting(mode: PhoneRoutingMode, phone: string): PhoneRoutingState {
  const router = useRouter();
  // الإجابات بالرقم الموحّد — نفس الرقم مايتسألش مرتين في نفس الصفحة.
  const [answers, setAnswers] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  // رقم رفض المستخدم التوجيه له مابيتعرضش له تاني — «خليني هنا» لازم تفضل محترمة.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

  const normalized = isValidPhoneInput(phone) ? phoneNumberForApi(phone) : null;
  const registered = normalized ? answers.get(normalized) : undefined;
  const wrongPage =
    normalized !== null &&
    registered !== undefined &&
    !dismissed.has(normalized) &&
    (mode === 'login' ? !registered : registered);
  const target = wrongPage ? routeTargetFor(mode, phone) : null;
  const notice = wrongPage
    ? mode === 'login'
      ? 'الرقم ده مش مسجّل عندنا لسه — هنفتحلك صفحة «حساب جديد» بنفس الرقم.'
      : 'إنت عندك حساب بالفعل بالرقم ده — هنوديك لتسجيل الدخول.'
    : null;

  useEffect(() => {
    if (!normalized || answers.has(normalized)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      apiFetch<{ registered: boolean }>('/auth/pin/phone-status', null, {
        method: 'POST',
        body: JSON.stringify({ phone_number: normalized }),
      })
        .then((result) => {
          if (cancelled) return;
          setAnswers((prev) => new Map(prev).set(normalized, result.registered));
        })
        .catch(() => {
          // مقصود: السؤال تحسين مش شرط. أي فشل = السلوك القديم من غير أي رسالة.
        });
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [answers, normalized]);

  useEffect(() => {
    if (!target) return;
    const timer = setTimeout(() => router.push(target), PHONE_ROUTING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [router, target]);

  return {
    notice,
    target,
    goNow: () => {
      if (target) router.push(target);
    },
    stay: () => {
      if (normalized) setDismissed((prev) => new Set(prev).add(normalized));
    },
  };
}
