'use client';

import { createContext, useCallback, useContext, useEffect, useEffectEvent, useRef, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './auth-context';

export type AdminTopic =
  | 'orders'
  | 'technicians'
  | 'payments'
  | 'payouts'
  | 'refunds'
  | 'support'
  | 'installments'
  | 'recurring'
  | 'settings'
  | 'security'
  | 'ratings'
  | 'projects'
  | 'warranty';

export interface AdminLiveEvent {
  topic: AdminTopic;
  entity: string;
  action: string;
  entity_id: string | null;
  at: string;
  data?: Record<string, unknown>;
}

type Listener = (event: AdminLiveEvent) => void;
type Subscribe = (listener: Listener) => () => void;

const AdminRealtimeContext = createContext<Subscribe | null>(null);
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1').replace(/\/api\/v1\/?$/, '');

export function AdminRealtimeProvider({ children }: { children: ReactNode }) {
  const { accessToken } = useAuth();
  const listeners = useRef(new Set<Listener>());

  const subscribe = useCallback<Subscribe>((listener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  useEffect(() => {
    if (!accessToken) return;

    const socket = io(`${API_ORIGIN}/admin`, {
      auth: { token: accessToken },
      forceNew: true,
    });

    socket.on('connect', () => {
      socket.emit('admin:subscribe');
    });
    socket.on('admin:live', (event: AdminLiveEvent) => {
      for (const listener of listeners.current) listener(event);
    });

    return () => {
      socket.disconnect();
    };
  }, [accessToken]);

  return <AdminRealtimeContext.Provider value={subscribe}>{children}</AdminRealtimeContext.Provider>;
}

/**
 * تحديث حي لصفحة أدمن عند وصول حدث على مواضيع محددة.
 *
 * **`Promise<void>` مقبولة عمدًا في `refresh`** (docs/08 §133): كل الـ30 صفحة اللي بتستخدم
 * الهوك دي بتمرّر دالة `load()` غير متزامنة. التوقيع القديم كان `=> void` بس، فالـPromise
 * كانت بتضيع — أي فشل في تحديث حي (توكن انتهى، السيرفر رجّع 500) بيبقى unhandled rejection
 * والصفحة بتفضل على بيانات قديمة بلا أي إشارة. المعالجة هنا في مكان واحد بدل 30.
 */
export function useAdminLiveRefresh(
  topics: readonly AdminTopic[],
  refresh: (event: AdminLiveEvent) => void | Promise<void>,
): void {
  const subscribe = useContext(AdminRealtimeContext);
  const onLiveEvent = useEffectEvent(refresh);
  const topicKey = topics.join(',');

  useEffect(() => {
    if (!subscribe) return;
    const allowedTopics = new Set<AdminTopic>(topicKey.split(',').filter(Boolean) as AdminTopic[]);
    return subscribe((event) => {
      if (!allowedTopics.has(event.topic)) return;
      const result = onLiveEvent(event);
      if (result instanceof Promise) {
        result.catch((err: unknown) => console.error('فشل التحديث الحي للصفحة', err));
      }
    });
  }, [subscribe, topicKey]);
}
