'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiEnvelope, TokenPair, UserResponseDto } from './api-types';
import { apiFetch, ApiError, apiFetchPage } from './api-client';

interface AuthContextValue {
  accessToken: string | null;
  user: UserResponseDto | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** دخول برقم + رمز (ADR-0109). بيرمي `ApiError` برسالة الباك-إند زي ما هي. */
  loginWithPin: (phoneNumber: string, pin: string) => Promise<void>;
  registerWithPin: (phoneNumber: string, pin: string, fullName: string, promoLinkCode?: string) => Promise<void>;
  /** تعيين/تغيير الرمز لمستخدم **داخل بالفعل** — مسار هجرة المستخدمين القدام (ADR-0109 §6-أ). */
  setPin: (pin: string, currentPin?: string) => Promise<void>;
  logout: () => Promise<void>;
  authedFetch: <T>(path: string, options?: RequestInit) => Promise<T>;
  /** لـendpoints مُقسّمة صفحات (`{items, meta}`) — راجع `apiFetchPage` للسبب. */
  authedFetchPage: <T>(path: string, options?: RequestInit) => Promise<{ items: T[]; meta: Record<string, unknown> }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function callLocalAuthRoute<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const envelope = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || !envelope.success) {
    throw new ApiError(envelope.error?.code ?? 'UNKNOWN', envelope.error?.message ?? 'حصل خطأ غير متوقع', res.status);
  }
  return envelope.data as T;
}

// نفس نمط apps/admin/src/lib/auth-context.tsx بالحرف (مُراجَع أمنيًا) — access_token في
// الذاكرة بس (state + ref للقراءة الفورية sync)، refresh_token httpOnly مايوصلش لجافاسكريبت
// خالص. single-flight refresh (inFlightRefresh ref) بيمنع أكتر من نداء /api/auth/refresh
// متزامن يستخدموا نفس الكوكي القديم (الباك-إند بيقفل كل الجلسات لو حصل إعادة استخدام لتوكن اتلغى).
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserResponseDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const accessTokenRef = useRef<string | null>(null);
  const setAccessTokenBoth = useCallback((token: string | null) => {
    accessTokenRef.current = token;
    setAccessToken(token);
  }, []);

  const inFlightRefresh = useRef<Promise<string | null> | null>(null);

  const doRefresh = useCallback((): Promise<string | null> => {
    if (!inFlightRefresh.current) {
      const run = async (): Promise<string | null> => {
        const result = await callLocalAuthRoute<Pick<TokenPair, 'access_token' | 'expires_in_seconds'> | null>(
          '/api/auth/refresh',
          {},
        );
        setAccessTokenBoth(result?.access_token ?? null);
        return result?.access_token ?? null;
      };
      inFlightRefresh.current = run().finally(() => {
        inFlightRefresh.current = null;
      });
    }
    return inFlightRefresh.current;
  }, [setAccessTokenBoth]);

  const fetchMe = useCallback(async (token: string) => {
    const me = await apiFetch<UserResponseDto>('/auth/me', token);
    setUser(me);
    return me;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const token = await doRefresh();
        // `null` = زائر مالوش جلسة (رد ٢٠٠ بـ`data: null` من مسار الـrefresh). مش خطأ،
        // فمفيش داعي نرمي استثناء عشان نمسكه في `catch` بعد سطرين.
        if (!token) throw new Error('no session');
        await fetchMe(token);
      } catch {
        setAccessTokenBoth(null);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    })()
      // نفس القاعدة: الرفض يتسجّل بدل ما يضيع في صمت (docs/08 §133).
      .catch((err: unknown) => console.error('فشل تحميل بيانات', err));
    // مقصود مرة واحدة بس وقت التحميل — doRefresh/fetchMe stable (useCallback بلا dependencies متغيرة).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── الدخول برمز (ADR-0109) ────────────────────────────────────────────
  // نفس شكل مسارات الـOTP القديمة بالحرف — بيرجّعوا نفس الرد وبيعملوا نفس الخطوات بعده.
  // الفرق الجوهري: **مفيش خطوة أولى بتنادي السيرفر** خالص. قبل كده الصفحة كانت بتنادي
  // `otp/request` وتستنى SMS.

  const adoptSession = useCallback(
    async (result: Pick<TokenPair, 'access_token' | 'expires_in_seconds'>) => {
      setAccessTokenBoth(result.access_token);
      await fetchMe(result.access_token);
    },
    [fetchMe, setAccessTokenBoth],
  );

  const loginWithPin = useCallback(
    async (phoneNumber: string, pin: string) => {
      await adoptSession(
        await callLocalAuthRoute<Pick<TokenPair, 'access_token' | 'expires_in_seconds'>>('/api/auth/pin/login', {
          phone_number: phoneNumber,
          pin,
        }),
      );
    },
    [adoptSession],
  );

  const registerWithPin = useCallback(
    async (phoneNumber: string, pin: string, fullName: string, promoLinkCode?: string) => {
      await adoptSession(
        await callLocalAuthRoute<Pick<TokenPair, 'access_token' | 'expires_in_seconds'>>('/api/auth/pin/register', {
          phone_number: phoneNumber,
          pin,
          full_name: fullName,
          user_type: 'customer',
          ...(promoLinkCode ? { promo_link_code: promoLinkCode } : {}),
        }),
      );
    },
    [adoptSession],
  );

  const setPin = useCallback(
    async (pin: string, currentPin?: string) => {
      // بيمرّ على `authedFetch`-زي بالإيد عشان الهيدر يوصل: المسار ده متوثّق، مش عام زي
      // الدخول والتسجيل.
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
      // `pin_set` في `/auth/me` بيتغيّر، والصفحات بتقرا منه — فلازم نعيد الجلب.
      if (accessTokenRef.current) await fetchMe(accessTokenRef.current);
    },
    [fetchMe],
  );

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    setAccessTokenBoth(null);
    setUser(null);
  }, [setAccessTokenBoth]);

  // 401 → يجرّب refresh مرة واحدة ويعيد المحاولة، زي customer-app's authedRequest بالظبط.
  const authedFetch = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      try {
        return await apiFetch<T>(path, accessTokenRef.current, options);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          const newToken = await doRefresh();
          return apiFetch<T>(path, newToken, options);
        }
        throw err;
      }
    },
    [doRefresh],
  );

  const authedFetchPage = useCallback(
    async <T,>(path: string, options: RequestInit = {}) => {
      try {
        return await apiFetchPage<T>(path, accessTokenRef.current, options);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          const newToken = await doRefresh();
          return apiFetchPage<T>(path, newToken, options);
        }
        throw err;
      }
    },
    [doRefresh],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      user,
      isLoading,
      isAuthenticated: accessToken !== null,
      loginWithPin,
      registerWithPin,
      setPin,
      logout,
      authedFetch,
      authedFetchPage,
    }),
    [accessToken, user, isLoading, loginWithPin, registerWithPin, setPin, logout, authedFetch, authedFetchPage],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth لازم يتستخدم جوّه AuthProvider');
  return ctx;
}
