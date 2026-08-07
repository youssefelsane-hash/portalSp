export const COMPLAINT_FILED_EVENT = 'complaint.filed';

export class ComplaintFiledEvent {
  constructor(
    public readonly complaintId: string,
    public readonly complaintNumber: string,
    public readonly title: string,
  ) {}
}
