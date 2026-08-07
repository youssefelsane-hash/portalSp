import { ComplaintStatus } from './entities/complaint.entity';

// نفس فلسفة order-state-machine.ts — مصدر حقيقة واحد، مقفول، بدل ما التحقق يتشتت في كل service method
export const COMPLAINT_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  [ComplaintStatus.OPEN]: [
    ComplaintStatus.UNDER_INVESTIGATION,
    ComplaintStatus.RESOLVED,
    ComplaintStatus.REJECTED,
    ComplaintStatus.ESCALATED,
  ],
  [ComplaintStatus.UNDER_INVESTIGATION]: [
    ComplaintStatus.AWAITING_CUSTOMER,
    ComplaintStatus.AWAITING_TECHNICIAN,
    ComplaintStatus.RESOLVED,
    ComplaintStatus.REJECTED,
    ComplaintStatus.ESCALATED,
  ],
  [ComplaintStatus.AWAITING_CUSTOMER]: [ComplaintStatus.UNDER_INVESTIGATION, ComplaintStatus.RESOLVED, ComplaintStatus.REJECTED],
  [ComplaintStatus.AWAITING_TECHNICIAN]: [ComplaintStatus.UNDER_INVESTIGATION, ComplaintStatus.RESOLVED, ComplaintStatus.REJECTED],
  [ComplaintStatus.ESCALATED]: [ComplaintStatus.UNDER_INVESTIGATION, ComplaintStatus.RESOLVED, ComplaintStatus.REJECTED],
  [ComplaintStatus.RESOLVED]: [ComplaintStatus.CLOSED, ComplaintStatus.ESCALATED],
  [ComplaintStatus.REJECTED]: [ComplaintStatus.CLOSED, ComplaintStatus.ESCALATED],
  [ComplaintStatus.CLOSED]: [],
};

export function canTransitionComplaint(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return COMPLAINT_TRANSITIONS[from].includes(to);
}

export const OPEN_COMPLAINT_STATUSES: ReadonlySet<ComplaintStatus> = new Set([
  ComplaintStatus.OPEN,
  ComplaintStatus.UNDER_INVESTIGATION,
  ComplaintStatus.AWAITING_CUSTOMER,
  ComplaintStatus.AWAITING_TECHNICIAN,
  ComplaintStatus.ESCALATED,
]);
