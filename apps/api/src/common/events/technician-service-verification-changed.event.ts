import { TechnicianServiceVerificationStatus } from '../../modules/catalog/entities/technician-service.entity';

export const TECHNICIAN_SERVICE_VERIFICATION_CHANGED_EVENT = 'technician_service.verification_changed';

export class TechnicianServiceVerificationChangedEvent {
  constructor(
    public readonly technicianServiceId: string,
    public readonly technicianUserId: string,
    public readonly serviceNameAr: string,
    public readonly previousStatus: TechnicianServiceVerificationStatus,
    public readonly newStatus: TechnicianServiceVerificationStatus,
    public readonly reason: string | null,
  ) {}
}
