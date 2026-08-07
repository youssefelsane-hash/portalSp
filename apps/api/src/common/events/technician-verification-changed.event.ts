import { TechnicianVerificationStatus } from '../../modules/technicians/entities/technician-profile.entity';

export const TECHNICIAN_VERIFICATION_CHANGED_EVENT = 'technician.verification_changed';

export class TechnicianVerificationChangedEvent {
  constructor(
    public readonly technicianProfileId: string,
    public readonly technicianUserId: string,
    public readonly previousStatus: TechnicianVerificationStatus,
    public readonly newStatus: TechnicianVerificationStatus,
    public readonly reason: string | null,
  ) {}
}
