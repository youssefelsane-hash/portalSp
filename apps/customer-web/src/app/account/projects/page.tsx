'use client';

import { AccountRow, AccountSection } from '@/components/account-section';
import { fetchMyProjects } from '@/lib/account';
import { formatEgp } from '@/lib/orders';

export default function ProjectsPage() {
  return (
    <AccountSection title="مشاريعي" load={fetchMyProjects} emptyText="مفيش مشاريع لسه">
      {(projects) => (
        <div className="space-y-2">
          {projects.map((p) => (
            <AccountRow
              key={p.id}
              href={`/projects/${p.id}`}
              title={p.name_ar}
              subtitle={`#${p.project_number}`}
              trailing={
                // القيمة المعتمدة أدق من التقدير، فبتتفضّل عليه — ولو الاتنين مش موجودين المشروع
                // لسه في مرحلة المعاينة فمفيش رقم نعرضه أصلاً.
                p.approved_quote_total_cents !== null || p.budget_estimate_cents !== null ? (
                  <span className="font-semibold text-primary">
                    {formatEgp(p.approved_quote_total_cents ?? p.budget_estimate_cents ?? 0)}
                  </span>
                ) : undefined
              }
            />
          ))}
        </div>
      )}
    </AccountSection>
  );
}
