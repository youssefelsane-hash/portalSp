'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ShieldAlert, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatEgp } from '@/lib/format';
import { useAdminQuery } from '@/lib/use-admin-query';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/table-skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/**
 * **مركز المخاطر والتلاعب** (ADR-0085، طلب مالك docs/08 §140).
 *
 * الفرق عن `/review-center` اللي جنبها **مش في الشكل — في وحدة التحليل**:
 *
 * | | مركز المراجعة (0084) | مركز المخاطر (هنا) |
 * |---|---|---|
 * | الصف = | فعل على طلب | **شخص** |
 * | السؤال | الفعل ده سليم؟ | الشخص ده سلوكه شاذ؟ |
 * | المرجع | تقدير المراجع | **أقرانه في نفس الفئة** |
 *
 * **القاعدة الحاكمة في العرض**: مفيش درجة بتتعرض بلا أسبابها. الصف بيقول «ليه» قبل ما يقول
 * «كام» — موظف بيشوف «٨٩» بلا تفصيل مش هيقدر يقرر، فإما هيتجاهل الشاشة أو يعاقب حد بلا أساس.
 */

const LEVEL_LABELS: Record<string, string> = {
  normal: 'عادي',
  watch: 'مراقبة',
  medium: 'متوسط',
  high: 'عالي',
  critical: 'حرج',
};

const LEVEL_CLASS: Record<string, string> = {
  normal: 'bg-slate-100 text-slate-700',
  watch: 'bg-amber-100 text-amber-800',
  medium: 'bg-orange-100 text-orange-800',
  high: 'bg-red-100 text-red-800',
  critical: 'bg-red-600 text-white',
};

export const BUCKET_LABELS: Record<string, string> = {
  pricing_abuse: 'إساءة تسعير',
  parts_manipulation: 'تلاعب بقطع الغيار',
  order_abuse: 'إساءة استخدام الطلبات',
  off_platform_leakage: 'تسريب خارج المنصة',
  customer_abuse: 'إساءة من العميل',
  collusion_fraud: 'تواطؤ / احتيال',
};

const ACTOR_LABELS: Record<string, string> = {
  technician: 'فني',
  assistant: 'مساعد',
  customer: 'عميل',
  company: 'شركة',
};

const CASE_STATUS_LABELS: Record<string, string> = {
  needs_review: 'محتاج مراجعة',
  monitoring: 'تحت المتابعة',
  investigating: 'تحقيق جارٍ',
  cleared: 'اتبرّأ',
  confirmed_manipulation: 'تلاعب مؤكَّد',
};

type QueueRow = {
  actorUserId: string;
  actorType: string;
  fullName: string | null;
  phoneNumber: string | null;
  score: number;
  level: string;
  topBucket: string | null;
  topReasons: string[];
  signalCount: number;
  ordersInWindow: number;
  moneyAtRiskCents: number;
  complaintsAgainst: number;
  caseId: string | null;
  caseStatus: string | null;
  lastSignalAt: string | null;
  trend: 'up' | 'down' | 'flat';
};

type Overview = {
  high_risk_actors: number;
  critical_actors: number;
  actors_with_signals: number;
  cases_waiting_review: number;
  pending_signals: number;
  confirmed_manipulation_this_month: number;
  false_positives: number;
  by_bucket: { bucket: string; signals: number }[];
  daily_trend: { day: string; signals: number }[];
};

export default function RiskCenterPage() {
  const { authedFetch } = useAuth();
  const [minScore, setMinScore] = useState('0');
  const [actorType, setActorType] = useState('');
  const [bucket, setBucket] = useState('');
  const [sort, setSort] = useState('score');

  const overview = useAdminQuery<Overview>(
    'risk-overview',
    () => authedFetch<Overview>('/admin/risk-center/overview'),
    'تعذّر تحميل ملخّص المخاطر',
  );

  const params = new URLSearchParams({ limit: '200' });
  if (minScore !== '0') params.set('min_score', minScore);
  if (actorType) params.set('actor_type', actorType);
  if (bucket) params.set('bucket', bucket);
  if (sort !== 'score') params.set('sort', sort);

  const queue = useAdminQuery<QueueRow[]>(
    `risk-queue:${params.toString()}`,
    () => authedFetch<QueueRow[]>(`/admin/risk-center/queue?${params.toString()}`),
    'تعذّر تحميل طابور المراجعة',
  );

  return (
    <AppShell>
      <PageHeader
        title="مركز المخاطر والتلاعب"
        description="السيستم بيلقط الأنماط ويجيب الحالات في طابور — والمراجعة والقرار للإنسان. كل درجة مكتوب جنبها أسبابها."
      />

      {/* ═══ الملخّص التنفيذي ═══ */}
      {overview.data && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <SummaryTile label="خطورة عالية" value={overview.data.high_risk_actors} tone="danger" />
          <SummaryTile label="حالات حرجة" value={overview.data.critical_actors} tone="danger" />
          <SummaryTile label="حالات مفتوحة" value={overview.data.cases_waiting_review} />
          <SummaryTile label="إشارات بلا حكم" value={overview.data.pending_signals} />
          <SummaryTile label="تلاعب مؤكَّد هذا الشهر" value={overview.data.confirmed_manipulation_this_month} tone="danger" />
          {/* **الإنذارات الكاذبة مؤشر صحة للشاشة نفسها**: لو الرقم ده بيكبر بسرعة، يبقى
              الكاشفات محتاجة ضبط — مش الناس محتاجة عقاب. */}
          <SummaryTile label="إنذارات كاذبة" value={overview.data.false_positives} tone="muted" />
        </div>
      )}

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        {overview.data && overview.data.by_bucket.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">الإشارات حسب نوع التلاعب — آخر ٣٠ يوم</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {overview.data.by_bucket.map((row) => (
                <Badge key={row.bucket} variant="outline" className="text-sm">
                  {BUCKET_LABELS[row.bucket] ?? row.bucket}: {row.signals}
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}
        {overview.data && overview.data.daily_trend.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">اتجاه الإشارات اليومي — آخر ٣٠ يوم</CardTitle></CardHeader>
            <CardContent>
              <DailyTrendChart points={overview.data.daily_trend} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* ═══ طابور المراجعة ═══ */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">طابور المراجعة — صف لكل شخص</CardTitle>
          <div className="flex flex-wrap gap-2">
            <SelectNative value={minScore} onChange={(e) => setMinScore(e.target.value)} className="h-9 w-40">
              <option value="0">كل الدرجات</option>
              <option value="30">٣٠+ مراقبة</option>
              <option value="50">٥٠+ متوسط</option>
              <option value="70">٧٠+ عالي</option>
              <option value="85">٨٥+ حرج</option>
            </SelectNative>
            <SelectNative value={actorType} onChange={(e) => setActorType(e.target.value)} className="h-9 w-36">
              <option value="">كل الأنواع</option>
              {Object.entries(ACTOR_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </SelectNative>
            <SelectNative value={bucket} onChange={(e) => setBucket(e.target.value)} className="h-9 w-48">
              <option value="">كل أنواع التلاعب</option>
              {Object.entries(BUCKET_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </SelectNative>
            <SelectNative value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 w-52">
              <option value="score">ترتيب: الدرجة</option>
              <option value="money">ترتيب: الفلوس المعرّضة</option>
              <option value="complaints">ترتيب: الشكاوى</option>
              <option value="frequency">ترتيب: تكرار الإشارات</option>
              <option value="recent">ترتيب: أحدث إشارة</option>
            </SelectNative>
          </div>
        </CardHeader>
        <CardContent>
          {queue.loading && <TableSkeleton rows={6} />}
          {queue.error && <p className="text-sm text-destructive">{queue.error}</p>}
          {!queue.loading && !queue.error && (queue.data?.length ?? 0) === 0 && (
            <EmptyState
              icon={ShieldAlert}
              title="مفيش حالات محتاجة مراجعة"
              description="مفيش أي شخص سلوكه خارج نطاق أقرانه في الفترة دي. ده الوضع الطبيعي."
            />
          )}
          {!queue.loading && (queue.data?.length ?? 0) > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الدرجة</TableHead>
                    <TableHead>الشخص</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>السبب الأساسي</TableHead>
                    {/* **مش «فلوس ضايعة»** — قيمة الطلبات اللي المراجعة لسه ماحسمتهاش. */}
                    <TableHead title="قيمة الطلبات اللي عليها إشارة لسه من غير حكم — مش مبلغ ضايع، ده ترتيب أولوية للمراجعة">
                      فلوس تحت المراجعة
                    </TableHead>
                    <TableHead>شكاوى ٩٠ يوم</TableHead>
                    <TableHead>طلبات ٣٠ يوم</TableHead>
                    <TableHead>الاتجاه</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.data?.map((row) => (
                    <TableRow key={row.actorUserId}>
                      <TableCell>
                        <span className={`inline-flex h-8 min-w-[3rem] items-center justify-center rounded-md px-2 font-bold ${LEVEL_CLASS[row.level] ?? ''}`}>
                          {row.score}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">{LEVEL_LABELS[row.level]}</span>
                      </TableCell>
                      <TableCell>
                        <Link href={`/risk-center/${row.actorUserId}`} className="font-medium underline">
                          {row.fullName ?? '—'}
                        </Link>
                        <span dir="ltr" className="mt-0.5 block text-xs text-muted-foreground">{row.phoneNumber}</span>
                      </TableCell>
                      <TableCell>{ACTOR_LABELS[row.actorType] ?? row.actorType}</TableCell>
                      <TableCell>
                        {row.topBucket && (
                          <Badge variant="outline">{BUCKET_LABELS[row.topBucket] ?? row.topBucket}</Badge>
                        )}
                        {/* **الأسباب مكتوبة، مش مخفية وراء ضغطة.** ده أهم عمود في الجدول. */}
                        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          {row.topReasons.map((reason) => <li key={reason}>• {reason}</li>)}
                        </ul>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.moneyAtRiskCents > 0
                          ? <span className="font-medium">{formatEgp(row.moneyAtRiskCents)}</span>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {row.complaintsAgainst > 0
                          ? <Badge variant="outline" className="border-amber-300 text-amber-800">{row.complaintsAgainst}</Badge>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>{row.ordersInWindow}</TableCell>
                      <TableCell>
                        <TrendIcon trend={row.trend} />
                      </TableCell>
                      <TableCell>
                        {row.caseStatus
                          ? <Badge variant="secondary">{CASE_STATUS_LABELS[row.caseStatus] ?? row.caseStatus}</Badge>
                          : <span className="text-xs text-muted-foreground">لسه مفتوحتش</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        النظام <strong>مابيحظرش حد تلقائيًا</strong>. كل إجراء بيحتاج مراجعة بشرية وتأكيد إضافي —
        إشارة غلط واحدة ممكن توقف رزق إنسان، وتكلفة الخطأ هنا مش متماثلة.
      </p>
    </AppShell>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'muted' }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-bold ${tone === 'danger' && value > 0 ? 'text-destructive' : tone === 'muted' ? 'text-muted-foreground' : ''}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * رسم اتجاه يومي بأعمدة CSS — **بلا مكتبة رسوم**.
 *
 * إضافة `recharts` (نص ميجا) عشان ٣٠ عمود على شاشة واحدة مش مقايضة عاقلة، والمالك طلب صراحةً
 * إننا «نضيف بس من غير ما نبوّظ حاجة شغالة» — وإضافة تبعية جديدة بتلمس كل الـbundle.
 */
function DailyTrendChart({ points }: { points: { day: string; signals: number }[] }) {
  const max = Math.max(...points.map((p) => p.signals), 1);
  return (
    <div>
      <div className="flex h-28 items-end gap-1" dir="ltr">
        {points.map((point) => (
          <div
            key={point.day}
            className="flex-1 rounded-t bg-destructive/70"
            // ارتفاع أدنى ٣px: يوم فيه إشارة واحدة لازم يفضل مرئي، مش شريط بصفر ارتفاع.
            style={{ height: `${Math.max(3, (point.signals / max) * 100)}%` }}
            title={`${point.day}: ${point.signals}`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground" dir="ltr">
        <span>{points[0]?.day}</span>
        <span>أعلى يوم: {max}</span>
        <span>{points[points.length - 1]?.day}</span>
      </div>
    </div>
  );
}

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up') return <span className="flex items-center gap-1 text-destructive"><TrendingUp className="h-4 w-4" />بيتدهور</span>;
  if (trend === 'down') return <span className="flex items-center gap-1 text-emerald-700"><TrendingDown className="h-4 w-4" />بيتحسّن</span>;
  return <span className="flex items-center gap-1 text-muted-foreground"><Minus className="h-4 w-4" />ثابت</span>;
}
