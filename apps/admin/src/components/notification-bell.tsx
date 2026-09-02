'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/auth-context';

interface AdminNotification {
  id: string;
  notification_type: string;
  title_ar: string;
  body_ar: string;
  deep_link: string | null;
  read_at: string | null;
  created_at: string;
}

const POLL_INTERVAL_MS = 60_000;

/**
 * **صندوق إشعارات الأدمن (ADR-0067).**
 *
 * `NotificationRoutingService.routeToRole()` كانت بتكتب صف `in_app` لكل موظف في الدور المستهدف
 * من يوم ما اتبنت — **ومافيش أي شاشة في لوحة الإدارة كانت بتقراه**. يعني كل التوجيهات (نقص طاقم،
 * طلب طوارئ، تحويل InstaPay، سعر خارج النطاق، عرض منتهي…) كانت بتتسجّل في القاعدة وتموت هناك.
 * الجرس ده هو المستهلك الناقص — نفس الـendpoints الموجودة (`GET /notifications`)، مفيش API جديد.
 *
 * الـdeep link بيتخزّن بصيغة `/admin/...` (مسار الأدمن الكامل زي ما الـlisteners بتكتبه)، والراوتر
 * هنا شغّال جوّه تطبيق الأدمن نفسه فبنشيل البادئة — التخزين مابيتغيّرش عشان القنوات التانية
 * (push/email) محتاجاه كامل.
 */
export function NotificationBell() {
  const { authedFetch, authedFetchPaginated } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<AdminNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  // فشل التحميل مابيتعرضش كـtoast: الجرس عنصر ثانوي في كل صفحة، وإزعاج المستخدم بخطأ شبكة
  // عابر كل دقيقة أسوأ من إنه يفضل ساكت لحد التحميل اللي بعده.
  const failing = useRef(false);

  const load = useCallback(async () => {
    try {
      // **لازم `authedFetchPaginated` مش `authedFetch`**: الـinterceptor العام بيفرد
      // `{items, meta}` لـ`data: items`، يعني `apiFetch` بيرجّع **المصفوفة نفسها** مش غلاف فيه
      // `items`. استخدام `authedFetch` هنا كان بيدّي `undefined` وبيكسّر القشرة كلها.
      const [list, count] = await Promise.all([
        authedFetchPaginated<AdminNotification>('/notifications?per_page=15'),
        authedFetch<{ unread_count: number }>('/notifications/unread-count'),
      ]);
      // الجرس عنصر في **قشرة كل الصفحات**: أي مفاجأة في شكل البيانات كانت هتوقّع لوحة الإدارة
      // كلها (RootLayout → AppShell → NotificationBell)، مش الجرس بس. الحارس ده بيخلي أسوأ حالة
      // «جرس فاضي» مش «الموقع واقع».
      setItems(Array.isArray(list.items) ? list.items : []);
      setUnread(count.unread_count);
      failing.current = false;
    } catch {
      failing.current = true;
    }
  }, [authedFetch, authedFetchPaginated]);

  // التحميل الأول والتحديث الدوري الاتنين بيتنفذوا من نفس المؤقّت (النظام الخارجي)، مش من جسم
  // الـeffect — نداء setState مباشرة جوّه الـeffect بيعمل cascading renders (react-hooks/set-state-in-effect).
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function openNotification(notification: AdminNotification) {
    setOpen(false);
    if (!notification.read_at) {
      try {
        await authedFetch(`/notifications/${notification.id}/read`, { method: 'PATCH' });
        setItems((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n)),
        );
        setUnread((prev) => Math.max(0, prev - 1));
      } catch {
        // التنقل أهم من علامة القراءة — الفشل هنا مايمنعش الأدمن يوصل للطلب.
      }
    }
    if (notification.deep_link) {
      router.push(notification.deep_link.replace(/^\/admin/, '') || '/');
    }
  }

  async function markAllRead() {
    try {
      await authedFetch('/notifications/read-all', { method: 'PATCH' });
      setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
      setUnread(0);
    } catch {
      /* نفس السبب فوق */
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="relative" aria-label="الإشعارات">
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -end-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>الإشعارات</span>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-auto p-0 text-xs" onClick={markAllRead}>
              علّم الكل كمقروء
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">مفيش إشعارات لسه</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="flex flex-col items-start gap-1 whitespace-normal"
                onSelect={(event) => {
                  event.preventDefault();
                  void openNotification(n);
                }}
              >
                <span className={`text-sm ${n.read_at ? 'font-normal' : 'font-semibold'}`}>{n.title_ar}</span>
                <span className="text-xs text-muted-foreground">{n.body_ar}</span>
                <span className="text-[10px] text-muted-foreground/70">
                  {new Date(n.created_at).toLocaleString('ar-EG')}
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
