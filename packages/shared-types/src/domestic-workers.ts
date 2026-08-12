// قطاع الخدمات المنزلية (docs/08 §12, ADR-0004) — مطابق لـ
// apps/api/src/modules/domestic-workers/dto/worker-response.dto.ts وreview-worker.dto.ts.
export interface WorkerResponseDto {
  id: string;
  worker_code: string;
  bio: string | null;
  years_of_experience: number;
  specialties: string[];
  hourly_rate_cents: number | null;
  monthly_rate_cents: number | null;
  verification_status: string;
  verification_notes: string | null;
  is_available: boolean;
  average_rating: number;
  total_ratings_count: number;
  completed_bookings_count: number;
  created_at: string;
}

export interface ReviewWorkerBody {
  status: 'approved' | 'rejected';
  notes?: string;
}
