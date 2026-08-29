'use client';

import { AccountRow, AccountSection } from '@/components/account-section';
import { fetchFavorites, removeFavorite } from '@/lib/account';
import { useAuth } from '@/lib/auth-context';

export default function FavoritesPage() {
  const { authedFetch } = useAuth();
  return (
    <AccountSection title="المفضّلة" load={fetchFavorites} emptyText="مفيش فنيين في المفضّلة — احفظ اللي عجبك شغله عشان تلاقيه بسرعة">
      {(favorites, reload) => (
        <div className="space-y-2">
          {favorites.map((fav) => (
            <AccountRow
              key={fav.technician_id}
              href={`/technicians/${fav.technician_id}`}
              title={fav.full_name}
              subtitle={`${Number(fav.average_rating).toFixed(1)} ★ (${fav.total_ratings_count}) · ${fav.completed_orders_count} طلب مكتمل`}
              trailing={
                <button
                  type="button"
                  onClick={async (e) => {
                    // الصف كله لينك، فلازم نمنع التنقّل قبل الحذف.
                    e.preventDefault();
                    e.stopPropagation();
                    await removeFavorite(authedFetch, fav.technician_id);
                    reload();
                  }}
                  className="text-danger underline-offset-4 hover:underline"
                >
                  شيل
                </button>
              }
            />
          ))}
        </div>
      )}
    </AccountSection>
  );
}
