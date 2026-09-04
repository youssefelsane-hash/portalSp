'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiEnvelope, TokenPair, UserResponseDto } from './api-types';
import { apiFetch, ApiError } from './api-client';

interface AuthContextValue {
  accessToken: string | null;
  user: UserResponseDto | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  requestOtp: (phoneNumber: string, purpose: 'login' | 'register') => Promise<void>;
  verifyOtp: (phoneNumber: string, otpCode: string) => Promise<void>;
  register: (phoneNumber: string, otpCode: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
  authedFetch: <T>(path: string, options?: RequestInit) => Promise<T>;
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

  const inFlightRefresh = useRef<Promise<string> | null>(null);

  const doRefresh = useCallback((): Promise<string> => {
    if (!inFlightRefresh.current) {
      const run = async (): Promise<string> => {
        const result = await callLocalAuthRoute<Pick<TokenPair, 'access_token' | 'expires_in_seconds'>>('/api/auth/refresh', {});
        setAccessTokenBoth(result.access_token);
        return result.access_token;
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

  const requestOtp = useCallback(async (phoneNumber: string, purpose: 'login' | 'register') => {
    await callLocalAuthRoute('/api/auth/otp/request', { phone_number: phoneNumber, purpose });
  }, []);

  const verifyOtp = useCallback(
    async (phoneNumber: string, otpCode: string) => {
      const result = await callLocalAuthRoute<Pick<TokenPair, 'access_token' | 'expires_in_seconds'>>('/api/auth/otp/verify', {
        phone_number: phoneNumber,
        otp_code: otpCode,
      });
      setAccessTokenBoth(result.access_token);
      await fetchMe(result.access_token);
    },
    [fetchMe, setAccessTokenBoth],
  );

  const register = useCallback(
    async (phoneNumber: string, otpCode: string, fullName: string) => {
      const result = await callLocalAuthRoute<Pick<TokenPair, 'access_token' | 'expires_in_seconds'>>('/api/auth/register', {
        phone_number: phoneNumber,
        otp_code: otpCode,
        full_name: fullName,
        user_type: 'customer',
      });
      setAccessTokenBoth(result.access_token);
      await fetchMe(result.access_token);
    },
    [fetchMe, setAccessTokenBoth],
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

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      user,
      isLoading,
      isAuthenticated: accessToken !== null,
      requestOtp,
      verifyOtp,
      register,
      logout,
      authedFetch,
    }),
    [accessToken, user, isLoading, requestOtp, verifyOtp, register, logout, authedFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth لازم يتستخدم جوّه AuthProvider');
  return ctx;
}
