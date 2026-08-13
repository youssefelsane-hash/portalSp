import type { KpiSnapshotStatus } from '@baytak/shared-types';

export const KPI_STATUS_LABELS: Record<KpiSnapshotStatus, string> = {
  calculated: 'محسوبة',
  approved: 'اتوافق عليها',
  paid: 'اتصرفت',
  rejected: 'مرفوضة',
};

export const KPI_STATUS_BADGE_VARIANT: Record<KpiSnapshotStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  calculated: 'outline',
  approved: 'secondary',
  paid: 'default',
  rejected: 'destructive',
};
