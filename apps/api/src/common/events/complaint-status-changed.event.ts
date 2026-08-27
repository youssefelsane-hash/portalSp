export const COMPLAINT_STATUS_CHANGED_EVENT = 'complaint.status_changed';

// نفس بلاغ ComplaintMessageAddedEvent (docs/08 §73 بند 2) — resolve()/reject()/close() كانوا
// برضه بيغيروا حالة الشكوى بلا أي إشعار لصاحبها. نوع إشعار واحد (`complaint_resolved`) كافي
// للتلاتة — الفرق في نص الرسالة بس (statusLabel)، مش في السياسة/القناة.
export class ComplaintStatusChangedEvent {
  constructor(
    public readonly complaintId: string,
    public readonly complaintNumber: string,
    public readonly recipientUserId: string,
    public readonly statusLabelAr: string,
  ) {}
}
