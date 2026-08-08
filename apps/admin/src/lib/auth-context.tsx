'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiEnvelope, OtpPurpose, UserResponseDto } from '@baytak/shared-types';
import { apiFetch, ApiError } from './api-client';

interface AuthState {
  accessToken: string | null;
  user: UserResponseDto | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  requestOtp: (phoneNumber: string, purpose: OtpPurpose) => Promise<void>;
  verifyOtp: (phoneNumber: string, otpCode: string) => Promise<void>;
  logout: () => Promise<void>;
  authedFetch: <T>(path: string, options?: RequestInit) => Promise<T>;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserResponseDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // الباك-إند بيدوّر refresh_token على كل استخدام وبيعتبر إعادة استخدام توكن اتلغى = سرقة
  // محتملة، فبيقفل كل جلسات المستخدم فوراً (revokeAllUserTokens في auth.service.ts). لو أكتر
  // من نداء لـ /api/auth/refresh حصل في نفس اللحظة (زي React StrictMode بيعيد تشغيل الـ effect
  // مرتين في التطوير، أو صفحة بتعمل أكتر من authedFetch مع access_token منتهي)، الاتنين هيستخدموا
  // نفس الكوكي القديم — التاني هيترفض ويقفل الحساب كله. الـ ref ده بيضمن نداء refresh واحد بس
  // "في الطيران" في أي وقت، وأي نداء تاني بيستنى نفس الـ promise بدل ما يبعت نداء منفصل.
  const inFlightRefresh = useRef<Promise<{ access_token: string; expires_in_seconds: number }> | null>(null);

  const doRefresh = useCallback(() => {
    if (!inFlightRefresh.current) {
      inFlightRefresh.current = callLocalAuthRoute<{ access_token: string; expires_in_seconds: number }>(
        '/api/auth/refresh',
        {},
      ).finally(() => {
        inFlightRefresh.current = null;
      });
    }
    return inFlightRefresh.current;
  }, []);

  const fetchMe = useCallback(async (token: string) => {
    const me = await apiFetch<UserResponseDto>('/auth/me', token);
    setUser(me);
  }, []);

  // بمحاولة صامتة نعيد بناء الجلسة من الـ refresh_token cookie (httpOnly) عند تحميل الصفحة —
  // access_token عمداً في الذاكرة بس (مش localStorage) عشان يبقى أقل عرضة لسرقة عبر XSS.
  const trySilentRefresh = useCallback(async () => {
    try {
      const result = await doRefresh();
      setAccessToken(result.access_token);
      await fetchMe(result.access_token);
    } catch {
      setAccessToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [doRefresh, fetchMe]);

  useEffect(() => {
    void trySilentRefresh();
    // متعمّد نستخدم [] — الفحص لازم يحصل مرة واحدة بس عند التحميل، مش كل مرة trySilentRefresh
    // يتعاد إنشاؤه (ده هيحصل تلقائي أول ما fetchMe يتغيّر، مش المطلوب هنا).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestOtp = useCallback(async (phoneNumber: string, purpose: OtpPurpose) => {
    await callLocalAuthRoute('/api/auth/otp/request', { phone_number: phoneNumber, purpose });
  }, []);

  const verifyOtp = useCallback(
    async (phoneNumber: string, otpCode: string) => {
      const result = await callLocalAuthRoute<{ access_token: string; expires_in_seconds: number }>(
        '/api/auth/otp/verify',
        { phone_number: phoneNumber, otp_code: otpCode },
      );
      setAccessToken(result.access_token);
      await fetchMe(result.access_token);
    },
    [fetchMe],
  );

  const logout = useCallback(async () => {
    await callLocalAuthRoute('/api/auth/logout', {}).catch(() => null);
    setAccessToken(null);
    setUser(null);
  }, []);

  // لو access_token انتهى (401)، نجرّب refresh (single-flight) ونعيد الطلب — لو فشل، الجلسة خلصت فعلاً.
  const authedFetch = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      try {
        return await apiFetch<T>(path, accessToken, options);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          const result = await doRefresh();
          setAccessToken(result.access_token);
          return apiFetch<T>(path, result.access_token, options);
        }
        throw err;
      }
    },
    [accessToken, doRefresh],
  );

  const value = useMemo(
    () => ({ accessToken, user, isLoading, requestOtp, verifyOtp, logout, authedFetch }),
    [accessToken, user, isLoading, requestOtp, verifyOtp, logout, authedFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth لازم تتستخدم جوّه AuthProvider');
  return ctx;
}
