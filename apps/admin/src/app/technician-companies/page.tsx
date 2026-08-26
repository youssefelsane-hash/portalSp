'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpLeft, Building2, Layers3, ShieldCheck, Users } from 'lucide-react';
import type { CompanyListRowDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/table-skeleton';
import { Badge } from '@/components/ui/badge';

export default function TechnicianCompaniesPage() {
  const { isLoading, authedFetch } = useAuth();
  const [companies, setCompanies] = useState<CompanyListRowDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    authedFetch<CompanyListRowDto[]>('/admin/technician-companies')
      .then(setCompanies)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الشركات'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const commercialCompanies = companies?.filter((company) => Boolean(company.commercial_registration_number)) ?? [];
  const professionalTeams = companies?.filter((company) => !company.commercial_registration_number) ?? [];
  const activeCount = companies?.filter((company) => company.is_active).length ?? 0;
  const totalStaff = companies?.reduce((sum, company) => sum + company.staff_count, 0) ?? 0;

  return (
    <AppShell>
      <PageHeader
        title="مركز الشركات والفرق"
        description="صورة تشغيلية واضحة للكيانات المهنية، طواقمها، فروعها، وحضورها في شبكة التنفيذ."
      />

      <section className="relative mb-6 overflow-hidden rounded-3xl border border-amber-200/70 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.22),transparent_36%),linear-gradient(135deg,#172033,#243047_58%,#172033)] p-6 text-white shadow-xl shadow-slate-950/10 md:p-8">
        <div className="absolute -bottom-20 -left-12 h-52 w-52 rounded-full border border-white/10" />
        <div className="relative grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-medium text-amber-100">
              <ShieldCheck className="h-4 w-4" />
              شبكة التنفيذ المؤسسية
            </div>
            <h2 className="max-w-xl text-2xl font-semibold leading-relaxed md:text-3xl">الشركة كيان تنفيذي، مش مجرد اسم في قائمة الفنيين.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
              الشركات المسجلة تظهر بهوية مستقلة، ويُراعى حجم طاقمها في مطابقة الأعمال الجماعية الكبيرة بدون ظلم الفنيين المستقلين.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <CompanyMetric label="شركات مسجلة" value={commercialCompanies.length} icon={Building2} />
            <CompanyMetric label="فرق مهنية" value={professionalTeams.length} icon={Layers3} />
            <CompanyMetric label="كيانات نشطة" value={activeCount} icon={ShieldCheck} />
            <CompanyMetric label="إجمالي الأعضاء" value={totalStaff} icon={Users} />
          </div>
        </div>
      </section>

      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!companies && !error && <TableSkeleton columns={6} />}
      {companies && companies.length === 0 && <EmptyState title="مفيش شركات/فرق لسه" />}

      {companies && companies.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {companies.map((company) => {
            const isCommercial = Boolean(company.commercial_registration_number);
            return (
              <Link
                key={company.id}
                href={`/technician-companies/${company.id}`}
                className={`group relative overflow-hidden rounded-2xl border bg-card p-5 transition duration-300 hover:-translate-y-1 hover:shadow-xl ${
                  isCommercial ? 'border-amber-300/70 shadow-amber-950/5' : 'border-border'
                }`}
              >
                {isCommercial && <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-amber-300 via-amber-500 to-orange-600" />}
                <div className="flex items-start justify-between gap-3">
                  <div className={`grid h-12 w-12 place-items-center rounded-2xl ${isCommercial ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
                    {isCommercial ? <Building2 className="h-6 w-6" /> : <Layers3 className="h-6 w-6" />}
                  </div>
                  <div className="flex items-center gap-2">
                    {company.is_trust_verified && (
                      <Badge className="bg-[#1D9BF0] text-white hover:bg-[#1D9BF0]">موثّقة ✓</Badge>
                    )}
                    <Badge variant={company.is_active ? 'secondary' : 'outline'}>{company.is_active ? 'نشطة' : 'متوقفة'}</Badge>
                    <ArrowUpLeft className="h-4 w-4 text-muted-foreground transition group-hover:-translate-x-1 group-hover:-translate-y-1" />
                  </div>
                </div>

                <div className="mt-5">
                  <p className={`text-xs font-medium ${isCommercial ? 'text-amber-700' : 'text-muted-foreground'}`}>
                    {isCommercial ? 'شركة مسجلة' : 'فريق مهني'}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold">{company.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isCommercial ? `سجل تجاري: ${company.commercial_registration_number}` : 'كيان فريق بدون سجل تجاري'}
                  </p>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-muted/60 p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Users className="h-4 w-4" /> الأعضاء</div>
                    <p className="mt-1 text-xl font-semibold">{company.staff_count}</p>
                  </div>
                  <div className="rounded-xl bg-muted/60 p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Building2 className="h-4 w-4" /> الفروع</div>
                    <p className="mt-1 text-xl font-semibold">{company.branch_count}</p>
                  </div>
                </div>

                <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                  انضم للشبكة في {new Date(company.created_at).toLocaleDateString('ar-EG-u-nu-latn')}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

function CompanyMetric({ label, value, icon: Icon }: {
  label: string;
  value: number;
  icon: typeof Building2;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-xs text-slate-300"><Icon className="h-4 w-4 text-amber-300" />{label}</div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value.toLocaleString('ar-EG-u-nu-latn')}</p>
    </div>
  );
}
