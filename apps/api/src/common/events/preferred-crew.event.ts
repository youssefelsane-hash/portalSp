// الفريق المفضّل (docs/08 §36.19، ADR-0022) — نفس فلسفة WORK_OPPORTUNITY_OFFERED_EVENT بالحرف:
// PreferredCrewService (موديول technicians) ماله معرفة بالإشعارات خالص، المستمع (notifications
// module) هو المسؤول عن قرار القناة/النص. الحدث بيتصدّر مباشرة (مش جوّه transaction) — العملية
// نفسها بسيطة (صف واحد INSERT/UPDATE بلا قفل)، صفر خطر تعارض يستاهل نفس حذر order-team.service.ts.
export const PREFERRED_CREW_INVITED_EVENT = 'technicians.preferred_crew_invited';
export const PREFERRED_CREW_ACCEPTED_EVENT = 'technicians.preferred_crew_accepted';

export class PreferredCrewInvitedEvent {
  constructor(
    public readonly membershipId: string,
    public readonly ownerTechnicianId: string,
    public readonly memberTechnicianId: string,
  ) {}
}

export class PreferredCrewAcceptedEvent {
  constructor(
    public readonly membershipId: string,
    public readonly ownerTechnicianId: string,
    public readonly memberTechnicianId: string,
  ) {}
}
