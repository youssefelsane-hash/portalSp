export const SECURITY_EVENT_CREATED_EVENT = 'security.event_created';

// بيتطلق أول مرة الحدث يتخلق بس (مش على كل increment تجميع — Part 5 §13 "لا 47 كارت منفصل").
// security-event-routing.listener.ts بيسمعه ويوجّه لـsuper_admin عبر محرك التوجيه الموجود.
export class SecurityEventCreatedEvent {
  constructor(
    public readonly securityEventId: string,
    public readonly eventType: string,
    public readonly severity: string,
    public readonly actorUserId: string | null,
  ) {}
}
