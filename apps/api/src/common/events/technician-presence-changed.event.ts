export const TECHNICIAN_PRESENCE_CHANGED_EVENT = 'technician.presence_changed';

export class TechnicianPresenceChangedEvent {
  constructor(
    public readonly userId: string,
    public readonly online: boolean,
  ) {}
}
