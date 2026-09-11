'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';

/// نظير `apps/customer-app/lib/features/projects/my_projects_screen.dart` بالحرف.
///
/// بلاغ المالك (2026-09-11): «الفوتر في الويب… المشاريع بتديني 404، وده طبعًا منطقي لأنه
/// أصلًا مش موجود حاجة اسمها مشاريع في الويب، فعايزين نضيف المشاريع في الويب طبعًا».
///
/// الصفحة دي كانت **ناقصة تمامًا**: `app/projects/` فيه `[id]/page.tsx` بس (غرفة المشروع
/// الواحد)، فأي لينك على `/projects` كان 404. غرفة المشروع كانت شغالة من زمان — اللي كان
/// ناقص هو المدخل ليها.
///
/// **حالات الحالة ونصوصها متطابقة حرفيًا** مع `projectStatusLabelsAr` في التطبيق — أي حالة
/// جديدة لازم تتضاف في المكانين، وإلا العميل يشوف نص إنجليزي خام في منصة وعربي في التانية.
interface ProjectListItem {
  id: string;
  project_number: string;
  name_ar: string;
  project_type: string;
  status: string;
}

const STATUS_LABELS_AR: Record<string, string> = {
  draft: 'مسودة',
  survey_requested: 'طلب معاينة',
  survey_scheduled: 'معاينة مجدولة',
  quote_preparing: 'تحضير عرض',
  awaiting_customer_approval: 'انتظار موافقتك',
  awaiting_deposit: 'انتظار العربون',
  active: 'نشط',
  paused: 'متوقف',
  awaiting_milestone_approval: 'انتظار موافقة مرحلة',
  handover_pending: 'استلام نهائي',
  completed: 'مكتمل',
  cancelled: 'ملغي',
  disputed: 'نزاع',
};

/// الحالات اللي محتاجة تحرّك من العميل بتتلوّن — الباقي محايد. نفس منطق «انتظار موافقتك»
/// اللي بيميّز الكارت في التطبيق.
const ATTENTION_STATUSES = new Set(['awaiting_customer_approval', 'awaiting_deposit', 'disputed']);

export default function MyProjectsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, authedFetch } = useAuth();
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.push('/login?next=/projects');
      return;
    }
    let cancelled = false;
    authedFetch<ProjectListItem[]>('/me/projects')
      .then((items) => {
        if (cancelled) return;
        setProjects(items);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setProjects([]);
        setError(err instanceof ApiError ? err.message : 'تعذّر تحميل المشاريع');
      });
    return () => {
      cancelled = true;
    };
  }, [authedFetch, isAuthenticated, isLoading, router]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">مشاريعي</h1>
        <p className="mt-1 text-sm text-muted">
          تجهيز شقة أو تشطيب كامل — من المعاينة لحد التسليم في مكان واحد.
        </p>
      </header>

      {projects === null ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface-variant" />
          ))}
        </div>
      ) : error ? (
        <p className="rounded-2xl border border-border bg-surface p-6 text-center text-danger">{error}</p>
      ) : projects.length === 0 ? (
        <EmptyProjects />
      ) : (
        <ul className="motion-list space-y-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="motion-rise motion-press block rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-primary"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{project.name_ar}</p>
                    <p className="mt-0.5 text-sm text-muted" dir="ltr">
                      {project.project_number}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                      ATTENTION_STATUSES.has(project.status)
                        ? 'bg-primary/10 text-primary'
                        : 'bg-surface-variant text-muted'
                    }`}
                  >
                    {STATUS_LABELS_AR[project.status] ?? project.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/// نفس نص الحالة الفاضية في التطبيق بالحرف — الرسالة دي هي اللي بتشرح للعميل إيه المشروع
/// أصلاً، فاختلافها بين المنصتين معناه فهمين مختلفين لنفس الميزة.
function EmptyProjects() {
  return (
    <div className="rounded-2xl border border-border bg-surface px-6 py-12 text-center">
      <p className="text-lg font-semibold text-foreground">عندك شقة جديدة أو تجديد كبير؟</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
        صوّر المكان واحكي لنا اللي محتاجه، وأسطى ترتب لك المعاينة والعرض والمراحل.
      </p>
      {/* **إنشاء المشروع لسه في التطبيق بس** (`CreateProjectScreen`): بيحتاج رفع صور المكان
          واختيار عنوان محفوظ، والاتنين لهم فلو مختلف تمامًا على الويب. الرابط بيوصّل لخدمات
          التشطيب الحقيقية بدل زرار بيفتح صفحة نص خلاص — ده اللي متاح فعلاً دلوقتي، وأصدق من
          وعد بشاشة مش موجودة. فجوة موثّقة في `apps/customer-web/README.md`. */}
      <Link
        href="/search"
        className="motion-press mt-6 inline-block rounded-xl bg-primary px-6 py-3 font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        تصفّح خدمات التشطيب
      </Link>
    </div>
  );
}
