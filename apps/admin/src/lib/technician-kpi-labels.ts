import type { KpiSnapshotStatus } from '@baytak/shared-types';

export const KPI_STATUS_LABELS: Record<KpiSnapshotStatus, string> = {
  calculated: 'محسوبة',
  approved: 'اتوافق عليها',
  paid: 'اتصرفت',
  rejected: 'مرفوضة',
};

export const KPI_STATUS_TONE: Record<KpiSnapshotStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  calculated: 'neutral',
  approved: 'info',
  paid: 'success',
  rejected: 'danger',
};
