'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { SupportTicketResponseDto, SupportTicketStatus } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  TICKET_CHANNEL_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  ticketStatusBadgeVariant,
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

  useEffect(() => {
    if (isLoading) return;
    const query = statusFilter === 'all' ? '' : `?ticket_status=${statusFilter}`;
    authedFetch<SupportTicketResponseDto[]>(`/admin/support-tickets${query}`)
      .then(setTickets)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل تذاكر الدعم'));
  }, [isLoading, authedFetch, statusFilter]);

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">تذاكر الدعم</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          تذاكر دعم عامة (سؤال فاتورة، مشكلة تقنية، ...) — منفصلة عن شكاوى الطلبات في "الشكاوى".
        </p>
      </div>

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
      {!tickets && !error && <p className="text-muted-foreground">جاري التحميل…</p>}
      {tickets && tickets.length === 0 && <p className="text-muted-foreground">مفيش تذاكر</p>}

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
                  <Badge variant={ticketStatusBadgeVariant(ticket.ticket_status)}>
                    {TICKET_STATUS_LABELS[ticket.ticket_status]}
                  </Badge>
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
