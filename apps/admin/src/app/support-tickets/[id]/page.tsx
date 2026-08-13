'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { EmployeeResponseDto, SupportTicketResponseDto, SupportTicketStatus } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import {
  TICKET_ALLOWED_TRANSITIONS,
  TICKET_CHANNEL_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  ticketStatusTone,
} from '@/lib/support-ticket-labels';

export default function SupportTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, authedFetch, authedFetchPaginated } = useAuth();
  const [ticket, setTicket] = useState<SupportTicketResponseDto | null>(null);
  const [employees, setEmployees] = useState<EmployeeResponseDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function load() {
    authedFetch<SupportTicketResponseDto>(`/support-tickets/${id}`)
      .then(setTicket)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل التذكرة'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    authedFetchPaginated<EmployeeResponseDto>('/admin/employees?is_active=true&per_page=100')
      .then((res) => setEmployees(res.items))
      .catch(() => setEmployees([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, id]);

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const assignedToUserId = form.get('assigned_to_user_id') as string;
    if (!assignedToUserId) return;
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/support-tickets/${id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ assigned_to_user_id: assignedToUserId }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function transitionTo(status: SupportTicketStatus) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/support-tickets/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ ticket_status: status }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  const assignedEmployee = employees.find((e) => e.user_id === ticket?.assigned_to_user_id);

  return (
    <AppShell>
      {error && <p className="text-destructive">{error}</p>}
      {!ticket && !error && <p className="text-muted-foreground">جاري التحميل…</p>}

      {ticket && (
        <div className="space-y-6">
          <PageHeader
            title={ticket.subject}
            description={
              <span dir="ltr" className="font-mono">
                {ticket.ticket_number}
              </span>
            }
            actions={
              <StatusChip tone={ticketStatusTone(ticket.ticket_status)}>
                {TICKET_STATUS_LABELS[ticket.ticket_status]}
              </StatusChip>
            }
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">البيانات</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">الفئة: </span>
                {ticket.category}
              </div>
              <div>
                <span className="text-muted-foreground">الأولوية: </span>
                {TICKET_PRIORITY_LABELS[ticket.priority]}
              </div>
              <div>
                <span className="text-muted-foreground">القناة: </span>
                {TICKET_CHANNEL_LABELS[ticket.channel]}
              </div>
              <div>
                <span className="text-muted-foreground">تاريخ الإنشاء: </span>
                {new Date(ticket.created_at).toLocaleString('ar-EG-u-nu-latn')}
              </div>
              <div>
                <span className="text-muted-foreground">أول رد: </span>
                {ticket.first_response_at ? new Date(ticket.first_response_at).toLocaleString('ar-EG-u-nu-latn') : '—'}
              </div>
              <div>
                <span className="text-muted-foreground">تاريخ الحل: </span>
                {ticket.resolved_at ? new Date(ticket.resolved_at).toLocaleString('ar-EG-u-nu-latn') : '—'}
              </div>
              <div>
                <span className="text-muted-foreground">تقييم الرضا: </span>
                {ticket.satisfaction_rating !== null ? `${ticket.satisfaction_rating}/5` : 'لسه ما اتقيّمتش'}
              </div>
              <div>
                <span className="text-muted-foreground">صاحب التذكرة (user_id): </span>
                <span dir="ltr" className="font-mono text-xs">
                  {ticket.user_id}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">التعيين</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                <span className="text-muted-foreground">معيّنة لـ: </span>
                {assignedEmployee ? assignedEmployee.full_name : ticket.assigned_to_user_id ? ticket.assigned_to_user_id : 'غير معيّنة'}
              </p>
              <form onSubmit={handleAssign} className="flex items-end gap-2">
                <div className="flex-1">
                  <SelectNative name="assigned_to_user_id" defaultValue="">
                    <option value="" disabled>
                      اختار موظف
                    </option>
                    {employees.map((emp) => (
                      <option key={emp.user_id} value={emp.user_id}>
                        {emp.full_name} ({emp.department})
                      </option>
                    ))}
                  </SelectNative>
                </div>
                <Button type="submit" size="sm" disabled={isSaving}>
                  تعيين
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">تغيير الحالة</CardTitle>
            </CardHeader>
            <CardContent>
              {TICKET_ALLOWED_TRANSITIONS[ticket.ticket_status].length === 0 ? (
                <p className="text-sm text-muted-foreground">مقفولة نهائياً — مفيش تحويل حالة متاح.</p>
              ) : (
                <div className="flex gap-2">
                  {TICKET_ALLOWED_TRANSITIONS[ticket.ticket_status].map((next) => (
                    <Button key={next} size="sm" variant="outline" disabled={isSaving} onClick={() => transitionTo(next)}>
                      {next === 'in_progress' && ticket.ticket_status === 'resolved' ? 'إعادة فتح' : TICKET_STATUS_LABELS[next]}
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
