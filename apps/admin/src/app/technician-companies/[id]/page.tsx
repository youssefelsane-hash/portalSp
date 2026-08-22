'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { CompanyDetailResponseDto, CompanyOrderSummaryResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { VERIFICATION_STATUS_LABELS, LEVEL_LABELS } from '@/lib/technician-labels';
import { ORDER_STATUS_LABELS, BOOKING_MODE_LABELS } from '@/lib/order-labels';
import { formatEgp } from '@/lib/format';

// مساحة عمل الشركة (ADR-0033) — نفس تجميع الحالات المستخدم لـ"نشط" في apps/technician-app
// (ACTIVE_TECHNICIAN_ORDER_STATUSES بالباك-إند)، مترجم هنا للعرض بس — صفر endpoint إحصائيات منفصل.
const ACTIVE_ORDER_STATUSES = new Set(['accepted', 'technician_on_way', 'technician_arrived', 'in_progress', 'awaiting_quote_approval']);

const TEAM_ROLE_LABELS: Record<string, string> = {
  independent: 'مستقل',
  owner: 'مالك',
  manager: 'مدير',
  supervisor: 'مشرف',
  worker: 'عامل',
};

export default function TechnicianCompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, authedFetch } = useAuth();
  const [detail, setDetail] = useState<CompanyDetailResponseDto | null>(null);
  const [orders, setOrders] = useState<CompanyOrderSummaryResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    authedFetch<CompanyDetailResponseDto>(`/admin/technician-companies/${id}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل تفاصيل الشركة'));
    authedFetch<CompanyOrderSummaryResponseDto[]>(`/admin/technician-companies/${id}/orders`)
      .then(setOrders)
      .catch(() => setOrders([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, id]);

  const activeOrdersCount = orders?.filter((o) => ACTIVE_ORDER_STATUSES.has(o.order_status)).length ?? 0;
  const completedOrdersCount = orders?.filter((o) => o.order_status === 'completed').length ?? 0;

  return (
    <AppShell>
      {error && <p className="text-destructive">{error}</p>}
      {!detail && !error && <p className="text-muted-foreground">جاري التحميل…</p>}

      {detail && (
        <div className="space-y-6">
          <PageHeader
            title={detail.company.name}
            actions={
              <Badge variant={detail.company.is_active ? 'secondary' : 'outline'}>
                {detail.company.is_active ? 'نشطة' : 'غير نشطة'}
              </Badge>
            }
          />

          {orders && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">إجمالي الطلبات</p>
                  <p className="text-2xl font-bold">{orders.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">جارية دلوقتي</p>
                  <p className="text-2xl font-bold">{activeOrdersCount}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">مكتملة</p>
                  <p className="text-2xl font-bold">{completedOrdersCount}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">إجمالي القيمة</p>
                  <p className="text-2xl font-bold">{formatEgp(orders.reduce((sum, o) => sum + o.total_amount_cents, 0))}</p>
                </CardContent>
              </Card>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">بيانات الشركة</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">السجل التجاري: </span>
                <span dir="ltr">{detail.company.commercial_registration_number ?? '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">تاريخ الإنشاء: </span>
                {new Date(detail.company.created_at).toLocaleDateString('ar-EG-u-nu-latn')}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">الفروع ({detail.branches.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.branches.length === 0 ? (
                <EmptyState title="مفيش فروع لسه" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الاسم</TableHead>
                      <TableHead>العنوان</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.branches.map((branch) => (
                      <TableRow key={branch.id}>
                        <TableCell>{branch.name}</TableCell>
                        <TableCell>{branch.address_line ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={branch.is_active ? 'secondary' : 'outline'}>
                            {branch.is_active ? 'نشط' : 'غير نشط'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">الأعضاء ({detail.staff.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الكود</TableHead>
                    <TableHead>الدور بالشركة</TableHead>
                    <TableHead>المستوى</TableHead>
                    <TableHead>حالة التوثيق</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.staff.map((member) => (
                    <TableRow key={member.user_id}>
                      <TableCell>{member.full_name}</TableCell>
                      <TableCell dir="ltr" className="text-start">
                        {member.technician_code}
                      </TableCell>
                      <TableCell>{TEAM_ROLE_LABELS[member.team_role] ?? member.team_role}</TableCell>
                      <TableCell>{LEVEL_LABELS[member.current_level as keyof typeof LEVEL_LABELS] ?? member.current_level}</TableCell>
                      <TableCell>
                        {VERIFICATION_STATUS_LABELS[member.verification_status as keyof typeof VERIFICATION_STATUS_LABELS] ??
                          member.verification_status}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">الطلبات ({orders?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {!orders ? (
                <p className="text-sm text-muted-foreground">جاري التحميل…</p>
              ) : orders.length === 0 ? (
                <EmptyState title="مفيش طلبات اتعيّنت للشركة دي لسه" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الطلب</TableHead>
                      <TableHead>الخدمة</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>وضع الحجز</TableHead>
                      <TableHead>الموعد</TableHead>
                      <TableHead>الفني المسؤول</TableHead>
                      <TableHead>المنطقة</TableHead>
                      <TableHead>الإجمالي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell dir="ltr" className="text-start">
                          {order.order_number}
                        </TableCell>
                        <TableCell>{order.service_name_ar}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{ORDER_STATUS_LABELS[order.order_status as keyof typeof ORDER_STATUS_LABELS] ?? order.order_status}</Badge>
                        </TableCell>
                        <TableCell>{BOOKING_MODE_LABELS[order.booking_mode] ?? order.booking_mode}</TableCell>
                        <TableCell>
                          {order.scheduled_at ? new Date(order.scheduled_at).toLocaleString('ar-EG-u-nu-latn') : '—'}
                        </TableCell>
                        <TableCell>{order.technician_name ?? '—'}</TableCell>
                        <TableCell>{order.zone_name_ar ?? '—'}</TableCell>
                        <TableCell>{formatEgp(order.total_amount_cents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
