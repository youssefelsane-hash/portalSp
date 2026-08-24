'use client';

import { useEffect, useState } from 'react';
import type { SettingResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface PaymentChannelStatus {
  method: string;
  is_enabled: boolean;
  is_configured: boolean;
  is_available: boolean;
  unavailable_reason: string | null;
}

const PAYMENT_CHANNEL_LABELS: Record<string, string> = {
  cash: 'الدفع بعد الخدمة (كاش)',
  wallet: 'محفظة العميل',
  card: 'بطاقة Paymob',
  installment: 'التقسيط',
  instapay: 'InstaPay',
  fawry_reference: 'فوري',
};

function SettingValueEditor({
  setting,
  onSave,
  isSaving,
}: {
  setting: SettingResponseDto;
  onSave: (value: unknown) => void;
  isSaving: boolean;
}) {
  const isSecret = new Set([
    'payments.paymob.api_key',
    'payments.paymob.secret_key',
    'payments.paymob.hmac_secret',
  ]).has(setting.key);
  const [draft, setDraft] = useState(
    isSecret
      ? ''
      : setting.value_type === 'boolean' || setting.value_type === 'number' || setting.value_type === 'string'
      ? String(setting.value)
      : JSON.stringify(setting.value, null, 2),
  );

  const isDirty = isSecret
    ? draft.length > 0
    : draft !== String(setting.value) && !(setting.value_type === 'json' && draft === JSON.stringify(setting.value, null, 2));

  function handleSave() {
    let parsed: unknown = draft;
    if (setting.value_type === 'boolean') parsed = draft === 'true';
    else if (setting.value_type === 'number') parsed = Number(draft);
    else if (setting.value_type !== 'string') {
      try {
        parsed = JSON.parse(draft);
      } catch {
        window.alert('القيمة دي لازم تكون JSON صحيح');
        return;
      }
    }
    onSave(parsed);
  }

  if (setting.value_type === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={draft === 'true' ? 'default' : 'outline'}
          disabled={isSaving}
          onClick={() => {
            setDraft('true');
            onSave(true);
          }}
        >
          مفعّل
        </Button>
        <Button
          size="sm"
          variant={draft === 'false' ? 'default' : 'outline'}
          disabled={isSaving}
          onClick={() => {
            setDraft('false');
            onSave(false);
          }}
        >
          معطّل
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type={isSecret ? 'password' : undefined}
        value={draft}
        placeholder={isSecret && setting.value ? 'مُعدّ بالفعل — اكتب قيمة جديدة للتغيير' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        dir={setting.value_type === 'number' ? 'ltr' : undefined}
        className="max-w-xs"
      />
      {isDirty && (
        <Button size="sm" disabled={isSaving} onClick={handleSave}>
          حفظ
        </Button>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [settings, setSettings] = useState<SettingResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [paymentChannels, setPaymentChannels] = useState<PaymentChannelStatus[]>([]);

  function load() {
    authedFetch<SettingResponseDto[]>('/admin/settings')
      .then(setSettings)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الإعدادات'));
    authedFetch<PaymentChannelStatus[]>('/payment-channels')
      .then(setPaymentChannels)
      .catch(() => setPaymentChannels([]));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleSave(key: string, value: unknown) {
    setSavingKey(key);
    setError(null);
    try {
      await authedFetch(`/admin/settings/${key}`, { method: 'PATCH', body: JSON.stringify({ value }) });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setSavingKey(null);
    }
  }

  const groups = settings
    ? Array.from(new Set(settings.map((s) => s.group_name))).sort()
    : [];

  return (
    <AppShell>
      <PageHeader title="الإعدادات" />
      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!settings && !error && <p className="text-muted-foreground">جاري التحميل…</p>}

      {paymentChannels.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">جاهزية طرق الدفع الظاهرة للعميل</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {paymentChannels.map((channel) => (
              <div key={channel.method} className="rounded-md border p-3">
                <p className="font-medium">{PAYMENT_CHANNEL_LABELS[channel.method] ?? channel.method}</p>
                <p className={channel.is_available ? 'text-sm text-green-700' : 'text-sm text-destructive'}>
                  {channel.is_available ? 'جاهزة وتظهر للعميل' : channel.unavailable_reason ?? 'غير جاهزة'}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {groups.map((group) => (
        <Card key={group} className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">{group}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المفتاح</TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead>القيمة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settings!
                  .filter((s) => s.group_name === group)
                  .map((setting) => (
                    <TableRow key={setting.key}>
                      <TableCell dir="ltr">{setting.key}</TableCell>
                      <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                        {setting.description ?? '—'}
                      </TableCell>
                      <TableCell>
                        <SettingValueEditor
                          setting={setting}
                          isSaving={savingKey === setting.key}
                          onSave={(value) => handleSave(setting.key, value)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </AppShell>
  );
}
