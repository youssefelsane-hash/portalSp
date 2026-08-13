// اسم الطابور وشكل الوظيفة اللي بتتنفّذ لما بث المطابقة الفعلي لطلب مجدول "بعيد" (ADR-0009 بند
// 1-2، P0-9) يتأجّل بدل ما يحصل فورًا وقت الإنشاء. الفرق عن matching-rounds.queue.ts: ده بيأجّل
// *بداية* أول جولة بث خالص (قبل ما OrderAssignment واحد يتعمل)، مش انتهاء مهلة جولة قايمة بالفعل.
export const MATCHING_DISPATCH_QUEUE = 'matching-dispatch';
export const DEFERRED_DISPATCH_JOB = 'deferred-dispatch';

export interface DeferredDispatchJobData {
  orderId: string;
}

export function deferredDispatchJobId(orderId: string): string {
  return `deferred-${orderId}`;
}
