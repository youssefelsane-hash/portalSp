import { TechnicianServiceVerificationStatus } from '../../modules/catalog/entities/technician-service.entity';

export const TECHNICIAN_CATEGORY_VERIFICATION_CHANGED_EVENT = 'technician_category.verification_changed';

export class TechnicianCategoryVerificationChangedEvent {
  constructor(
    public readonly technicianCategoryId: string,
    public readonly technicianUserId: string,
    public readonly categoryNameAr: string,
    public readonly previousStatus: TechnicianServiceVerificationStatus,
    public readonly newStatus: TechnicianServiceVerificationStatus,
    public readonly reason: string | null,
  ) {}
}
