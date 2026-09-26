'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import type { ApiEnvelope, ApiMeta, LoginResult, MfaRequiredResponse, UserResponseDto } from '@baytak/shared-types';
import { isMfaRequiredResponse } from '@baytak/shared-types';
import { apiFetch, apiFetchPaginated, ApiError } from './api-client';
import { StepUpDialog } from '@/components/step-up-dialog';

interface AuthState {
  accessToken: string | null;
  user: UserResponseDto | null;
  isLoading: boolean;
  // P0-3 (مراجعة أمان شاملة 2026-08-13، docs/12) — صلاحيات الأدمن الفعلية (GET /admin/me/permissions)،
  // بتتحمّل مع بيانات المستخدم. null لسه ما اتحمّلتش/الجلسة مش موجودة، مش "بلا صلاحيات".
  permissions: Set<string> | null;
}

interface AuthContextValue extends AuthState {
  // ADR-0109 — الدخول بقى رقم + رمز. **مفيش خطوة أولى بتنادي السيرفر خالص**.
  // ADR-0011 — لو الحساب High-Privilege، مبيكملش تسجيل دخول فورًا؛ بيرجّع MfaRequiredResponse
  // بدل كده والكولر (شاشة /login) هو اللي يقرر يعرض إيه (enrollPasskey أو authenticateWithPasskey).
  loginWithPin: (phoneNumber: string, pin: string) => Promise<LoginResult>;
  /** استرجاع MFA — الرمز + كود الاسترجاع مع بعض، عاملين مستقلين (ADR-0011 §6). */
  verifyRecoveryCode: (phoneNumber: string, pin: string, recoveryCode: string) => Promise<MfaRequiredResponse>;
  /** تعيين/تغيير الرمز لأدمن **داخل بالفعل** — مسار هجرة الأدمنز القدام (ADR-0109 §6-أ). */
  setPin: (pin: string, currentPin?: string) => Promise<void>;
  // تسجيل Passkey جديد جوّه مسار MFA بس (مفيش "ضيف Passkey تاني" لمستخدم داخل بالفعل — قيد
  // الباك-إند الحالي، Phase 1). بيكمّل تسجيل الدخول فعليًا ويرجّع أكواد الاسترجاع (مرة واحدة بس).
  enrollPasskey: (mfaSessionToken: string, deviceLabel?: string) => Promise<string[] | null>;
  authenticateWithPasskey: (mfaSessionToken: string) => Promise<void>;
  logout: () => Promise<void>;
  authedFetch: <T>(path: string, options?: RequestInit) => Promise<T>;
  authedFetchPaginated: <T>(path: string, options?: RequestInit) => Promise<{ items: T[]; meta: ApiMeta }>;
  // super_admin بيتخطى الفحص بالكامل (getUserPermissionNames في الباك-إند بترجّع الكتالوج كامل
  // له أصلاً)، فمفيش حاجة نفرّقه هنا — الـSet بيوصل شامل كل الصلاحيات لو المستخدم super_admin.
  hasPermission: (permissionName: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function callLocalAuthRoute<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const envelope = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || !envelope.success) {
    throw new ApiError(envelope.error?.code ?? 'UNKNOWN', envelope.error?.message ?? 'حصل خطأ غير متوقع', res.status);
  }
  return envelope.data as T;
}

interface PendingStepUp {
  optionsJSON: PublicKeyCredentialRequestOptionsJSON;
  resolve: (token: string) => void;
  reject: (err: Error) => void;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserResponseDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [permissions, setPermissions] = useState<Set<string> | null>(null);

  // مصدر الحقيقة الفعلي لـaccessToken وقت الاستخدام الفوري (requestStepUp) — state بتتحدّث
  // async، والـref ده بيتحدّث sync في نفس اللحظة اللي setAccessToken بيتنادى فيها (راجع doRefresh
  // وloginWithPin/authenticateWithPasskey تحت)، فمفيش خطر إن Step-Up يستخدم توكن قديم لو حصل
  // refresh لحظة قبله بالظبط.
  const accessTokenRef = useRef<string | null>(null);
  const setAccessTokenBoth = useCallback((token: string | null) => {
    accessTokenRef.current = token;
    setAccessToken(token);
  }, []);

  const [pendingStepUp, setPendingStepUp] = useState<PendingStepUp | null>(null);
  const [stepUpVerifying, setStepUpVerifying] = useState(false);
  const [stepUpError, setStepUpError] = useState<string | null>(null);

  // الباك-إند بيدوّر refresh_token على كل استخدام وبيعتبر إعادة استخدام توكن اتلغى = سرقة
  // محتملة، فبيقفل كل جلسات المستخدم فوراً (revokeAllUserTokens في auth.service.ts). لو أكتر
  // من نداء لـ /api/auth/refresh حصل في نفس اللحظة (زي React StrictMode بيعيد تشغيل الـ effect
  // مرتين في التطوير، أو صفحة بتعمل أكتر من authedFetch مع access_token منتهي)، الاتنين هيستخدموا
  // نفس الكوكي القديم — التاني هيترفض ويقفل الحساب كله. الـ ref ده بيضمن نداء refresh واحد بس
  // "في الطيران" في أي وقت جوّه نفس التاب، وأي نداء تاني بيستنى نفس الـ promise بدل ما يبعت نداء منفصل.
  const inFlightRefresh = useRef<Promise<{ access_token: string; expires_in_seconds: number }> | null>(null);

  const doRefresh = useCallback(() => {
    if (!inFlightRefresh.current) {
      const runRefresh = (): Promise<{ access_token: string; expires_in_seconds: number }> =>
        callLocalAuthRoute('/api/auth/refresh', {});

      const promise: Promise<{ access_token: string; expires_in_seconds: number }> =
        typeof navigator !== 'undefined' && 'locks' in navigator
          ? (navigator.locks.request('baytak-admin-refresh-token', runRefresh) as unknown as Promise<{
              access_token: string;
              expires_in_seconds: number;
            }>)
          : runRefresh();

      inFlightRefresh.current = promise.finally(() => {
        inFlightRefresh.current = null;
      });
    }
    return inFlightRefresh.current;
  }, []);

  const fetchMe = useCallback(async (token: string) => {
    const me = await apiFetch<UserResponseDto>('/auth/me', token);
    setUser(me);
    try {
      const { permission_names: names } = await apiFetch<{ permission_names: string[] }>(
        '/admin/me/permissions',
        token,
      );
      setPermissions(new Set(names));
    } catch {
      setPermissions(null);
    }
  }, []);

  const trySilentRefresh = useCallback(async () => {
    try {
      const result = await doRefresh();
      setAccessTokenBoth(result.access_token);
      await fetchMe(result.access_token);
    } catch {
      setAccessTokenBoth(null);
      setUser(null);
      setPermissions(null);
    } finally {
      setIsLoading(false);
    }
  }, [doRefresh, fetchMe, setAccessTokenBoth]);

  useEffect(() => {
    void trySilentRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loginWithPin = useCallback(async (phoneNumber: string, pin: string): Promise<LoginResult> => {
    const result = await callLocalAuthRoute<LoginResult>('/api/auth/pin/login', {
      phone_number: phoneNumber,
      pin,
    });
    // **الـMFA زي ما هو بالحرف**: الرمز عامل أول بس. الحساب High-Privilege بيرجّع
    // `mfa_required` ومابياخدش جلسة لحد ما الـPasskey تخلص.
    if (isMfaRequiredResponse(result)) {
      return result;
    }
    setAccessTokenBoth(result.access_token);
    await fetchMe(result.access_token);
    return result;
  }, [fetchMe, setAccessTokenBoth]);

  const verifyRecoveryCode = useCallback(
    async (phoneNumber: string, pin: string, recoveryCode: string): Promise<MfaRequiredResponse> => {
      return callLocalAuthRoute<MfaRequiredResponse>('/api/auth/recovery/verify', {
        phone_number: phoneNumber,
        pin,
        recovery_code: recoveryCode,
      });
    },
    [],
  );

  const setPin = useCallback(
    async (pin: string, currentPin?: string) => {
      // مسار متوثّق، فالهيدر لازم يتبعت بالإيد — `callLocalAuthRoute` مالهاش توكن.
      const res = await fetch('/api/auth/pin/set', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessTokenRef.current ? { Authorization: `Bearer ${accessTokenRef.current}` } : {}),
        },
        body: JSON.stringify({ pin, ...(currentPin ? { current_pin: currentPin } : {}) }),
      });
      const envelope = (await res.json()) as ApiEnvelope<unknown>;
      if (!res.ok || !envelope.success) {
        throw new ApiError(envelope.error?.code ?? 'UNKNOWN', envelope.error?.message ?? 'حصل خطأ غير متوقع', res.status);
      }
      // `pin_set` في `/auth/me` بيتغيّر والشاشات بتقرا منه، فلازم نعيد الجلب.
      if (accessTokenRef.current) await fetchMe(accessTokenRef.current);
    },
    [fetchMe],
  );

  const enrollPasskey = useCallback(
    async (mfaSessionToken: string, deviceLabel?: string): Promise<string[] | null> => {
      const optionsJSON = await apiFetch<PublicKeyCredentialCreationOptionsJSON>(
        '/auth/webauthn/registration/options',
        null,
        { method: 'POST', body: JSON.stringify({ mfa_session_token: mfaSessionToken }) },
      );
      // لازم يتصدّر مباشرة من جوّه handler الضغطة (زرار "سجّل Passkey") من غير أي await قبله —
      // بعض المتصفحات (Safari خصوصًا) بترفض تفتح WebAuthn prompt لو مفيش "user gesture" حديث.
      // الكولر (login page) هو اللي بيضمن ده، مش الدالة دي.
      const response = await startRegistration({ optionsJSON });
      const result = await callLocalAuthRoute<{ access_token: string; expires_in_seconds: number; recovery_codes: string[] | null }>(
        '/api/auth/webauthn/registration/verify',
        { response, device_label: deviceLabel, mfa_session_token: mfaSessionToken },
      );
      setAccessTokenBoth(result.access_token);
      await fetchMe(result.access_token);
      return result.recovery_codes;
    },
    [fetchMe, setAccessTokenBoth],
  );

  const authenticateWithPasskey = useCallback(
    async (mfaSessionToken: string): Promise<void> => {
      const optionsJSON = await apiFetch<PublicKeyCredentialRequestOptionsJSON>(
        '/auth/webauthn/authentication/options',
        null,
        { method: 'POST', body: JSON.stringify({ mfa_session_token: mfaSessionToken }) },
      );
      const response = await startAuthentication({ optionsJSON });
      const result = await callLocalAuthRoute<{ access_token: string; expires_in_seconds: number }>(
        '/api/auth/webauthn/authentication/verify',
        { response, mfa_session_token: mfaSessionToken },
      );
      setAccessTokenBoth(result.access_token);
      await fetchMe(result.access_token);
    },
    [fetchMe, setAccessTokenBoth],
  );

  const logout = useCallback(async () => {
    await callLocalAuthRoute('/api/auth/logout', {}).catch(() => null);
    setAccessTokenBoth(null);
    setUser(null);
    setPermissions(null);
  }, [setAccessTokenBoth]);

  // Step-Up (ADR-0011 §4) — بيفتح الحوار، بيستنى المستخدم يدوس "تأكيد"، وبيرجّع step_up_token
  // صالح مرة واحدة/دقيقتين. Reject لو المستخدم لغى أو WebAuthn فشل (جهاز مش مسجّل، رفض المستخدم، ...).
  const requestStepUp = useCallback((): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      void (async () => {
        try {
          const optionsJSON = await apiFetch<PublicKeyCredentialRequestOptionsJSON>(
            '/auth/webauthn/step-up/options',
            accessTokenRef.current,
            { method: 'POST' },
          );
          setStepUpError(null);
          setPendingStepUp({ optionsJSON, resolve, reject });
        } catch (err) {
          reject(err instanceof Error ? err : new Error('فشل تجهيز تأكيد الهوية'));
        }
      })();
    });
  }, []);

  const handleStepUpConfirm = useCallback(() => {
    if (!pendingStepUp) return;
    const { optionsJSON, resolve } = pendingStepUp;
    void (async () => {
      setStepUpVerifying(true);
      setStepUpError(null);
      try {
        const response = await startAuthentication({ optionsJSON });
        const { step_up_token } = await apiFetch<{ step_up_token: string; expires_at: string }>(
          '/auth/webauthn/step-up/verify',
          accessTokenRef.current,
          { method: 'POST', body: JSON.stringify({ response }) },
        );
        setPendingStepUp(null);
        resolve(step_up_token);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'فشل تأكيد الـPasskey — حاول تاني';
        setStepUpError(message);
        // مش بنعمل reject هنا — بنسيب الحوار مفتوح عشان المستخدم يعيد المحاولة (مش يضطر يبدأ
        // العملية الأصلية من الأول). reject بيحصل بس لو المستخدم دوس "إلغاء" فعليًا تحت.
      } finally {
        setStepUpVerifying(false);
      }
    })();
  }, [pendingStepUp]);

  const handleStepUpCancel = useCallback(() => {
    if (!pendingStepUp) return;
    pendingStepUp.reject(new Error('اتلغى تأكيد الهوية'));
    setPendingStepUp(null);
    setStepUpError(null);
  }, [pendingStepUp]);

  // authedFetch/authedFetchPaginated بيتعاملوا مع نوعين من الفشل تلقائيًا وشفّاف تمامًا للكولر:
  // 401 → refresh مرة واحدة وإعادة المحاولة، AUTH_006 (Step-Up مطلوب) → فتح حوار Step-Up وإعادة
  // المحاولة بنفس الطلب + X-Step-Up-Token. الكولر (زي شاشة البراندنج) مش محتاج يعرف عن أي حاجة
  // من دول — نفس فلسفة "متضطرش تعيد المستخدم يبدأ من الأول" (توجيه المالك، ADR-0011 §21).
  const authedFetch = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      const attempt = async (extraHeaders?: HeadersInit): Promise<T> => {
        const mergedOptions: RequestInit = { ...options, headers: { ...options.headers, ...extraHeaders } };
        try {
          return await apiFetch<T>(path, accessTokenRef.current, mergedOptions);
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            const result = await doRefresh();
            setAccessTokenBoth(result.access_token);
            return apiFetch<T>(path, result.access_token, mergedOptions);
          }
          throw err;
        }
      };
      try {
        return await attempt();
      } catch (err) {
        if (err instanceof ApiError && err.code === 'AUTH_006') {
          const stepUpToken = await requestStepUp();
          return attempt({ 'X-Step-Up-Token': stepUpToken });
        }
        throw err;
      }
    },
    [doRefresh, requestStepUp, setAccessTokenBoth],
  );

  const authedFetchPaginated = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<{ items: T[]; meta: ApiMeta }> => {
      const attempt = async (extraHeaders?: HeadersInit): Promise<{ items: T[]; meta: ApiMeta }> => {
        const mergedOptions: RequestInit = { ...options, headers: { ...options.headers, ...extraHeaders } };
        try {
          return await apiFetchPaginated<T>(path, accessTokenRef.current, mergedOptions);
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            const result = await doRefresh();
            setAccessTokenBoth(result.access_token);
            return apiFetchPaginated<T>(path, result.access_token, mergedOptions);
          }
          throw err;
        }
      };
      try {
        return await attempt();
      } catch (err) {
        if (err instanceof ApiError && err.code === 'AUTH_006') {
          const stepUpToken = await requestStepUp();
          return attempt({ 'X-Step-Up-Token': stepUpToken });
        }
        throw err;
      }
    },
    [doRefresh, requestStepUp, setAccessTokenBoth],
  );

  // فترة الخمس دقائق بتتحسب لو حصل تفاعل فيها؛ مجرد ترك التبويب ظاهرًا لا يُحسب عملًا.
  useEffect(() => {
    if (!user) return;
    let hadActivity = false;
    let lastInteractionAt = 0;
    let lastHeartbeatAt = 0;
    let idle = false;
    function sendHeartbeat(reset: boolean) {
      lastHeartbeatAt = Date.now();
      void authedFetch('/admin/workforce/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ reset }),
      }).catch(() => undefined);
    }
    function onInteraction() {
      if (document.visibilityState !== 'visible') return;
      lastInteractionAt = Date.now();
      hadActivity = true;
      if (idle || Date.now() - lastHeartbeatAt > 360_000) {
        idle = false;
        sendHeartbeat(true);
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') {
        idle = true;
        hadActivity = false;
      }
    }
    function tick() {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastHeartbeatAt > 360_000) {
        idle = true;
        hadActivity = false;
        return;
      }
      if (hadActivity && Date.now() - lastInteractionAt <= 300_000) {
        sendHeartbeat(false);
      } else {
        idle = true;
      }
      hadActivity = false;
    }
    sendHeartbeat(true);
    const interval = setInterval(tick, 300_000);
    const events = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart'] as const;
    for (const event of events) document.addEventListener(event, onInteraction, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      for (const event of events) document.removeEventListener(event, onInteraction);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [user, authedFetch]);

  const hasPermission = useCallback((permissionName: string) => permissions?.has(permissionName) ?? false, [permissions]);

  const value = useMemo(
    () => ({
      accessToken,
      user,
      isLoading,
      permissions,
      loginWithPin,
      setPin,
      verifyRecoveryCode,
      enrollPasskey,
      authenticateWithPasskey,
      logout,
      authedFetch,
      authedFetchPaginated,
      hasPermission,
    }),
    [
      accessToken,
      user,
      isLoading,
      permissions,
      loginWithPin,
      setPin,
      verifyRecoveryCode,
      enrollPasskey,
      authenticateWithPasskey,
      logout,
      authedFetch,
      authedFetchPaginated,
      hasPermission,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <StepUpDialog
        open={pendingStepUp !== null}
        isVerifying={stepUpVerifying}
        error={stepUpError}
        onConfirm={handleStepUpConfirm}
        onCancel={handleStepUpCancel}
      />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth لازم تتستخدم جوّه AuthProvider');
  return ctx;
}
