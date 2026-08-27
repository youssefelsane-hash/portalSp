'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { CampaignResponseDto, CampaignType, CampaignsListResponseDto, CreateCampaignBody } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  periodic_promo: 'إعلان دوري',
  abandoned_intent: 'استرجاع اهتمام متروك',
};

const CAMPAIGN_TYPE_HINTS: Record<CampaignType, string> = {
  periodic_promo: 'بيتبعت كل كام يوم لعميل مؤهل بخدمة عشوائية من اللي الأدمن سمح بالإعلان عنها.',
  abandoned_intent: 'بيتبعت للعميل اللي بصّ على خدمة وما حجزهاش — بعد المهلة اللي تحتها.',
};

export default function CampaignsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [campaigns, setCampaigns] = useState<CampaignResponseDto[] | null>(null);
  const [variables, setVariables] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newType, setNewType] = useState<CampaignType>('periodic_promo');

  function load() {
    authedFetch<CampaignsListResponseDto>('/admin/campaigns')
      .then((res) => {
        setCampaigns(res.items);
        setVariables(res.available_variables);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الحملات'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const body: CreateCampaignBody = {
      campaign_type: newType,
      name: form.get('name') as string,
      title_template_ar: form.get('title_template_ar') as string,
      body_template_ar: form.get('body_template_ar') as string,
      cooldown_days: Number(form.get('cooldown_days')) || 4,
      priority: Number(form.get('priority')) || 100,
    };
    // مهلة الزناد ليها معنى في الاسترجاع بس — الباك-إند بيرفضها على الحملات الدورية صراحةً.
    if (newType === 'abandoned_intent') {
      const delay = Number(form.get('trigger_delay_minutes'));
      if (delay) body.trigger_delay_minutes = delay;
    }

    setIsSaving(true);
    setError(null);
    try {
      await authedFetch('/admin/campaigns', { method: 'POST', body: JSON.stringify(body) });
      setShowNew(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleActive(campaign: CampaignResponseDto) {
    setError(null);
    try {
      await authedFetch(`/admin/campaigns/${campaign.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !campaign.is_active }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في تغيير حالة الحملة');
    }
  }

  async function handleDelete(id: string) {
    try {
      await authedFetch(`/admin/campaigns/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في حذف الحملة');
    }
  }

  async function runSweep() {
    setError(null);
    setNotice(null);
    try {
      const res = await authedFetch<{ sent: number }>('/admin/campaigns/run-sweep', { method: 'POST' });
      setNotice(
        res.sent > 0
          ? `اتبعت ${res.sent} إشعار تسويقي دلوقتي.`
          : 'مفيش إشعارات اتبعتت — يا إما مفيش عميل مؤهل دلوقتي، يا إما إحنا جوّه ساعات الهدوء.',
      );
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في تشغيل الدورة');
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="الحملات التسويقية"
        description="إشعارات تلقائية بتفكّر العميل بالخدمات. النص قالب فيه متغيّرات، والمنصة بتملاه بأسماء خدمات حقيقية."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={runSweep}>
              تشغيل دورة دلوقتي
            </Button>
            <Button onClick={() => setShowNew((v) => !v)}>{showNew ? 'إلغاء' : 'حملة جديدة'}</Button>
          </div>
        }
      />

      {error && <div className="mb-4 rounded-md bg-danger/10 p-3 text-sm text-danger">{error}</div>}
      {notice && <div className="mb-4 rounded-md bg-muted p-3 text-sm text-muted-foreground">{notice}</div>}

      <Card className="mb-4">
        <CardContent className="space-y-2 p-4 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">مهم:</span> الخدمة ما بتتعلنش إلا لو الأدمن علّمها
            «قابلة للإعلان» في صفحة الكتالوج. الافتراضي إن مفيش خدمة بتتعلن.
          </p>
          <p>
            المتغيّرات المتاحة في القالب:{' '}
            {variables.map((v) => (
              <code key={v} className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">{`{{${v}}}`}</code>
            ))}
          </p>
        </CardContent>
      </Card>

      {showNew && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="campaign_type">نوع الحملة</Label>
                <SelectNative
                  id="campaign_type"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as CampaignType)}
                >
                  <option value="periodic_promo">{CAMPAIGN_TYPE_LABELS.periodic_promo}</option>
                  <option value="abandoned_intent">{CAMPAIGN_TYPE_LABELS.abandoned_intent}</option>
                </SelectNative>
                <p className="mt-1 text-xs text-muted-foreground">{CAMPAIGN_TYPE_HINTS[newType]}</p>
              </div>
              <div>
                <Label htmlFor="name">اسم الحملة (للإدارة بس)</Label>
                <Input id="name" name="name" required minLength={3} maxLength={120} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="title_template_ar">عنوان الإشعار</Label>
                <Input
                  id="title_template_ar"
                  name="title_template_ar"
                  required
                  maxLength={160}
                  placeholder="محتاج {{service_name}}؟"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="body_template_ar">نص الإشعار</Label>
                <textarea
                  id="body_template_ar"
                  name="body_template_ar"
                  required
                  rows={3}
                  maxLength={1000}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="فنيينا موجودين في منطقتك. اطلب {{service_name}} دلوقتي."
                />
              </div>
              <div>
                <Label htmlFor="cooldown_days">أقل عدد أيام بين إرسالين لنفس العميل</Label>
                <Input id="cooldown_days" name="cooldown_days" type="number" min={1} max={90} defaultValue={4} />
              </div>
              <div>
                <Label htmlFor="priority">الأولوية (الأعلى بيظهر أكتر)</Label>
                <Input id="priority" name="priority" type="number" min={1} max={1000} defaultValue={100} />
              </div>
              {newType === 'abandoned_intent' && (
                <div>
                  <Label htmlFor="trigger_delay_minutes">يتبعت بعد كام دقيقة من الاهتمام المتروك</Label>
                  <Input
                    id="trigger_delay_minutes"
                    name="trigger_delay_minutes"
                    type="number"
                    min={1}
                    max={10080}
                    defaultValue={60}
                  />
                </div>
              )}
              <div className="sm:col-span-2">
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? 'بيتحفظ...' : 'حفظ الحملة'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {campaigns === null && <TableSkeleton columns={5} />}

      {campaigns !== null && campaigns.length === 0 && (
        <EmptyState title="مفيش حملات لسه" description="أنشئ حملة عشان الأبليكيشن يبدأ يفكّر العملاء بالخدمات." />
      )}

      {campaigns !== null && campaigns.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الحملة</TableHead>
              <TableHead>الشكل النهائي للعميل</TableHead>
              <TableHead>الإعدادات</TableHead>
              <TableHead>آخر 30 يوم</TableHead>
              <TableHead>إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((campaign) => (
              <TableRow key={campaign.id}>
                <TableCell>
                  <div className="font-medium">{campaign.name}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="outline">{CAMPAIGN_TYPE_LABELS[campaign.campaign_type]}</Badge>
                    <Badge variant={campaign.is_active ? 'default' : 'outline'}>
                      {campaign.is_active ? 'شغالة' : 'موقوفة'}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="max-w-sm">
                  {/* معاينة بأسماء وهمية — الأدمن يشوف الشكل اللي هيوصل للعميل مش القالب الخام. */}
                  <div className="text-sm font-medium">{campaign.preview_title}</div>
                  <div className="text-xs text-muted-foreground">{campaign.preview_body}</div>
                  {campaign.unknown_variables.length > 0 && (
                    <div className="mt-1 text-[11px] text-danger">
                      متغيّرات مش معروفة هتتشال من النص: {campaign.unknown_variables.join('، ')}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <div>فاصل {campaign.cooldown_days} يوم</div>
                  <div>أولوية {campaign.priority}</div>
                  {campaign.trigger_delay_minutes !== null && <div>بعد {campaign.trigger_delay_minutes} دقيقة</div>}
                </TableCell>
                <TableCell>
                  <div className="font-medium">{campaign.sends_30d}</div>
                  <div className="text-xs text-muted-foreground">
                    {campaign.last_sent_at
                      ? new Date(campaign.last_sent_at).toLocaleDateString('ar-EG-u-nu-latn')
                      : 'ما اتبعتتش لسه'}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => toggleActive(campaign)}>
                      {campaign.is_active ? 'إيقاف' : 'تشغيل'}
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button variant="outline" size="sm">
                          حذف
                        </Button>
                      }
                      title="حذف الحملة"
                      description={`هتتحذف حملة «${campaign.name}». سجل الإرسال بيفضل موجود للتحليل.`}
                      onConfirm={() => handleDelete(campaign.id)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

    </AppShell>
  );
}
