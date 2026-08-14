// موثوقية توليد الطلبات المتكررة (docs/08 §19 بند 20) — بيتصدّر مرة واحدة بس لكل "نوبة فشل"
// (لما consecutive_failure_count يوصل لسقف RecurringOrdersService.MAX_CONSECUTIVE_FAILURES ويتم
// تخطّي الموعد ده — العدّاد بيرجع صفر بعدها، فمفيش تكرار للإشعار نفسه لنفس النوبة).
export const RECURRING_TEMPLATE_GENERATION_FAILING_EVENT = 'orders.recurring_template_generation_failing';

export class RecurringTemplateGenerationFailingEvent {
  constructor(
    public readonly templateId: string,
    public readonly customerId: string,
    public readonly attempts: number,
    public readonly reason: string,
  ) {}
}
