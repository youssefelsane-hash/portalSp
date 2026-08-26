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

export function useAdminLiveRefresh(topics: readonly AdminTopic[], refresh: (event: AdminLiveEvent) => void): void {
  const subscribe = useContext(AdminRealtimeContext);
  const onLiveEvent = useEffectEvent(refresh);
  const topicKey = topics.join(',');

  useEffect(() => {
    if (!subscribe) return;
    const allowedTopics = new Set<AdminTopic>(topicKey.split(',').filter(Boolean) as AdminTopic[]);
    return subscribe((event) => {
      if (allowedTopics.has(event.topic)) onLiveEvent(event);
    });
  }, [subscribe, topicKey]);
}
