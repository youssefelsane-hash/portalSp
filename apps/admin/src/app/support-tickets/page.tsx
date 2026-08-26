'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { SupportTicketResponseDto, SupportTicketStatus } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusChip } from '@/components/status-chip';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  TICKET_CHANNEL_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  ticketStatusTone,
} from '@/lib/support-ticket-labels';

const STATUS_FILTERS: { value: SupportTicketStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'open', label: 'مفتوحة' },
  { value: 'in_progress', label: 'قيد المعالجة' },
  { value: 'resolved', label: 'اتحلّت' },
  { value: 'closed', label: 'مقفولة' },
];

export default function SupportTicketsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [tickets, setTickets] = useState<SupportTicketResponseDto[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | 'all'>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const query = statusFilter === 'all' ? '' : `?ticket_status=${statusFilter}`;
    authedFetch<SupportTicketResponseDto[]>(`/admin/support-tickets${query}`)
      .then(setTickets)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل تذاكر الدعم'));
  }, [authedFetch, statusFilter]);

  useEffect(() => {
    if (isLoading) return;
    load();
  }, [isLoading, load]);
  // docs/08 §63.ب1 — تحديث حي: الباك-إند بيبثّ الأحداث دي أصلاً، الصفحة كانت بتفوّتها
  // فكانت محتاجة refresh يدوي. الجلب اتحوّل لـuseCallback عشان يتنادى من المكانين.
  useAdminLiveRefresh(['support'], load);

  return (
    <AppShell>
      <PageHeader
        title="تذاكر الدعم"
        description='تذاكر دعم عامة (سؤال فاتورة، مشكلة تقنية، ...) — منفصلة عن شكاوى الطلبات في "الشكاوى".'
      />

      <div className="mb-4 flex gap-2">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={statusFilter === f.value ? 'default' : 'outline'}
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!tickets && !error && <TableSkeleton columns={7} />}
      {tickets && tickets.length === 0 && <EmptyState title="مفيش تذاكر" />}

      {tickets && tickets.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الرقم</TableHead>
              <TableHead>الموضوع</TableHead>
              <TableHead>الفئة</TableHead>
              <TableHead>الأولوية</TableHead>
              <TableHead>القناة</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>تاريخ الإنشاء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tickets.map((ticket) => (
              <TableRow key={ticket.id}>
                <TableCell dir="ltr" className="text-start font-mono text-xs">
                  <Link href={`/support-tickets/${ticket.id}`} className="hover:underline">
                    {ticket.ticket_number}
                  </Link>
                </TableCell>
                <TableCell>{ticket.subject}</TableCell>
                <TableCell>{ticket.category}</TableCell>
                <TableCell>{TICKET_PRIORITY_LABELS[ticket.priority]}</TableCell>
                <TableCell>{TICKET_CHANNEL_LABELS[ticket.channel]}</TableCell>
                <TableCell>
                  <StatusChip tone={ticketStatusTone(ticket.ticket_status)}>
                    {TICKET_STATUS_LABELS[ticket.ticket_status]}
                  </StatusChip>
                </TableCell>
                <TableCell>{new Date(ticket.created_at).toLocaleDateString('ar-EG-u-nu-latn')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
