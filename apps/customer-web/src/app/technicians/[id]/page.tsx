'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { fetchTechnicianProfile, TechnicianProfileDto } from '@/lib/technicians';
import { formatEgp } from '@/lib/orders';
import { ApiError } from '@/lib/api-client';

// بروفايل الفني العام (docs/08 §82 — توازي الميزات مع apps/customer-app's TechnicianProfileScreen).
// معرض الأعمال/الشهادات مؤجّلين عمدًا لدفعة لاحقة (عرض فيديوهات مضمّنة محتاج تصميم embed منفصل
// للويب، نفس القرار اللي اتاخد وقت التطبيق الأول — راجع docs/08 §82 القايمة الموثّقة).
export default function TechnicianProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, authedFetch } = useAuth();

  const [profile, setProfile] = useState<TechnicianProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push(`/login?next=/technicians/${id}`);
      return;
    }
    if (isAuthenticated) {
      fetchTechnicianProfile(authedFetch, id)
        .then(setProfile)
        .catch((err) => setError(err instanceof ApiError ? err.message : 'تعذّر تحميل بروفايل الفني'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, authLoading, id]);

  if (authLoading || !profile) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        {error ? <p className="text-danger">{error}</p> : <div className="h-64 animate-pulse rounded-xl bg-surface-variant" />}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-center gap-4">
        {profile.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- صور فنيين خارجية من التخزين، مش أصول ثابتة معروفة وقت الـbuild
          <img src={profile.avatar_url} alt={profile.full_name} className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-variant text-2xl">👤</div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{profile.full_name}</h1>
            {profile.is_trust_verified && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary" title="فني موثّق">
                ✓ موثّق
              </span>
            )}
          </div>
          <p className="text-sm text-muted">{profile.technician_code}</p>
          {profile.years_of_experience > 0 && <p className="text-sm text-muted">{profile.years_of_experience} سنين خبرة</p>}
        </div>
      </div>

      {profile.bio && <p className="mt-4 text-sm">{profile.bio}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="التقييم"
          value={profile.total_ratings_count > 0 ? `${profile.average_rating.toFixed(1)} (${profile.total_ratings_count})` : 'لسه من غير تقييم'}
        />
        <StatCard label="طلبات مكتملة" value={String(profile.completed_orders_count)} />
        <StatCard label="الالتزام بالمواعيد" value={profile.on_time_rate !== null ? `${profile.on_time_rate}%` : '—'} />
        <StatCard label="معدل الإلغاء" value={profile.cancellation_rate !== null ? `${profile.cancellation_rate}%` : '—'} />
      </div>

      {(profile.avg_arrival_minutes !== null || profile.avg_completion_minutes !== null) && (
        <div className="mt-3 flex flex-wrap justify-around gap-2 text-xs text-muted">
          {profile.avg_arrival_minutes !== null && <span>بيوصل خلال ~{profile.avg_arrival_minutes} دقيقة</span>}
          {profile.avg_completion_minutes !== null && <span>بينفّذ الشغل في ~{profile.avg_completion_minutes} دقيقة</span>}
        </div>
      )}

      {profile.zones.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">مناطق العمل</h2>
          <div className="flex flex-wrap gap-2">
            {profile.zones.map((zone) => (
              <span key={zone.id} className="rounded-full border border-border px-3 py-1 text-sm">
                {zone.name_ar}
              </span>
            ))}
          </div>
        </section>
      )}

      {profile.services.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">الخدمات</h2>
          <ul className="space-y-1 text-sm">
            {profile.services.map((service) => (
              <li key={service.id} className="flex justify-between rounded-lg border border-border px-3 py-2">
                <span>{service.name_ar}</span>
                <span className="font-medium">{formatEgp(service.base_price_cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.recent_reviews.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">آخر التقييمات</h2>
          <ul className="space-y-2">
            {profile.recent_reviews.map((review, i) => (
              <li key={i} className="rounded-lg border border-border px-3 py-2 text-sm">
                <div className="font-medium">{'★'.repeat(review.overall_rating)}{'☆'.repeat(5 - review.overall_rating)}</div>
                {review.comment && <p className="mt-1 text-muted">{review.comment}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-center">
      <div className="font-semibold">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
