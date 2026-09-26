'use client';

import { useEffect, useState } from 'react';
import { notifyNetworkSuccess, subscribeConnectivity, type ConnectivityStatus } from '@/lib/connectivity';

/**
 * شريط واحد أعلى الصفحة لحالة الاتصال (طلب مالك 2026-09-25).
 *
 * `role="status"` مش `alert`: ده تغيير حالة مستمر مش إنذار لحظي، و`alert` بيقطع قارئ الشاشة على
 * المستخدم في نص أي حاجة بيعملها.
 *
 * بيختفي لوحده مع أول نداء ناجح — مفيش زرار إغلاق عن قصد: زرار إغلاق على حالة لسه قايمة بيخلّي
 * المستخدم يخفي المعلومة اللي بتفسّر إن الصفحة مش بتتحدّث.
 */
export function ConnectivityBanner() {
  const [status, setStatus] = useState<ConnectivityStatus>('ok');

  useEffect(() => subscribeConnectivity(setStatus), []);

  useEffect(() => {
    if (status !== 'server-unreachable') return;
    let active = true;
    let pending: AbortController | null = null;

    async function checkConnection() {
      if (pending) return;
      const controller = new AbortController();
      pending = controller;
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      try {
        const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
        const response = await fetch(`${base}/health`, { cache: 'no-store', signal: controller.signal });
        if (active && response.ok) notifyNetworkSuccess();
      } catch {
        // The banner stays visible until the API is reachable again.
      } finally {
        window.clearTimeout(timeout);
        pending = null;
      }
    }

    void checkConnection();
    const timer = window.setInterval(() => void checkConnection(), 15_000);
    return () => {
      active = false;
      pending?.abort();
      window.clearInterval(timer);
    };
  }, [status]);

  if (status === 'ok') return null;

  const isOffline = status === 'offline';
  return (
    <div
      role="status"
      data-testid={isOffline ? 'offline-banner' : 'server-unreachable-banner'}
      className="sticky top-0 z-50 w-full bg-danger/10 px-4 py-2 text-center text-xs font-medium text-danger sm:text-sm"
    >
      {isOffline
        ? 'مفيش إنترنت — اتأكد من الاتصال، وأي حاجة عملتها هتكمّل لوحدها لما يرجع'
        : 'مش قادرين نوصل للسيرفر دلوقتي — بنحاول تاني، ما تقفلش الصفحة'}
    </div>
  );
}
