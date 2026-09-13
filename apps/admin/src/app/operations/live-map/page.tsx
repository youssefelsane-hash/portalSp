'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { MapPinned, RefreshCw, Route } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { useAdminQuery } from '@/lib/use-admin-query';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { MapLegend, OperationsLiveMap, type LiveMapOrder, type LiveMapTechnician } from '@/components/operations-live-map';

type LiveMapSnapshot = {
  generated_at: string;
  technicians: LiveMapTechnician[];
  orders: LiveMapOrder[];
};

function formatTimestamp(value: string | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
}

export default function OperationsLiveMapPage() {
  const { authedFetch } = useAuth();
  const query = useAdminQuery<LiveMapSnapshot>(
    'operations-live-map',
    () => authedFetch<LiveMapSnapshot>('/admin/operations/live-map'),
    'تعذّر تحميل بيانات الخريطة الحية',
  );
  useAdminLiveRefresh(['orders', 'technicians'], query.reload);

  useEffect(() => {
    const interval = window.setInterval(query.reload, 30_000);
    return () => window.clearInterval(interval);
  }, [query.reload]);

  const snapshot = query.data;
  const assignedOrders = snapshot?.orders.filter((order) => order.technician_id).length ?? 0;

  return (
    <AppShell>
      <PageHeader
        title="الخريطة الحية"
        description="توزيع الفنيين والطلبات التشغيلية من آخر GPS وصل للنظام وعناوين العملاء المحفوظة. الخط المنقط يربط الفني بالطلب المعيّن له."
        actions={<Button variant="outline" onClick={query.reload} disabled={query.loading}><RefreshCw className="size-4" />تحديث الآن</Button>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Metric label="فنيين بموقع GPS" value={snapshot?.technicians.length ?? 0} />
        <Metric label="طلبات تشغيلية" value={snapshot?.orders.length ?? 0} />
        <Metric label="طلبات مرتبطة بفني" value={assignedOrders} />
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><MapPinned className="size-5 text-primary" />خريطة التوزيع</CardTitle>
              <CardDescription className="mt-1">آخر تحديث للبيانات: {formatTimestamp(snapshot?.generated_at)}. التحديث التلقائي كل 30 ثانية.</CardDescription>
            </div>
            <MapLegend />
          </div>
        </CardHeader>
        <CardContent>
          {query.loading && !snapshot && <Skeleton className="h-[62vh] min-h-[34rem] w-full" />}
          {query.error && <p className="text-sm text-destructive">{query.error}</p>}
          {snapshot && snapshot.technicians.length === 0 && snapshot.orders.length === 0 && (
            <EmptyState icon={MapPinned} title="لا توجد نقاط على الخريطة الآن" description="تظهر النقاط عندما يرسل فني موقعه أو يكون لطلب تشغيلي عنوان محفوظ." />
          )}
          {snapshot && (snapshot.technicians.length > 0 || snapshot.orders.length > 0) && (
            <OperationsLiveMap technicians={snapshot.technicians} orders={snapshot.orders} />
          )}
        </CardContent>
      </Card>

      {snapshot && snapshot.orders.length > 0 && (
        <Card className="mt-5">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Route className="size-4" />طلبات تحتاج متابعة على الخريطة</CardTitle></CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {snapshot.orders.slice(0, 12).map((order) => (
              <Link key={order.id} href={`/orders/${order.id}`} className="rounded-lg border p-3 transition-colors hover:bg-accent/50">
                <p className="font-medium">{order.order_number}</p>
                <p className="text-sm text-muted-foreground">{order.service_name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{order.technician_id ? 'مربوط بفني على الخريطة' : 'بانتظار التوزيع'} · {order.status}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></CardContent></Card>;
}
