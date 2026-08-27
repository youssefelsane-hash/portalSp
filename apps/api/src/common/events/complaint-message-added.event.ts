export const COMPLAINT_MESSAGE_ADDED_EVENT = 'complaint.message_added';

// بلاغ مالك صريح 2026-08-27 (docs/08 §73 بند 2): الأدمن يرد على شكوى، الرسالة توصل، بس صاحب الشكوى
// مبيوصلوش أي إشعار خالص إنه اترد عليه. بيتصدّر بس لما المُرسل أدمن والرسالة مش ملاحظة داخلية —
// راجع SupportService.addMessage().
export class ComplaintMessageAddedEvent {
  constructor(
    public readonly complaintId: string,
    public readonly complaintNumber: string,
    public readonly recipientUserId: string,
  ) {}
}
