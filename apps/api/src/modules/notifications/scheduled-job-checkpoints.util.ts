// checkpoints تذكير scheduled_job (ADR-0012، docs/08 §15) — مش فاصل ثابت متكرر زي action_required،
// سلسلة نقاط مبنية على الموعد المستهدف نفسه: فورًا (بيتبعت وقت الإنشاء، مش من هنا)، بعدها لو
// لسه ما اتفتحش: بعد N دقيقة، صبح اليوم اللي قبل الموعد، وقبل الموعد بفترة أخيرة. أي checkpoint
// بره النطاق [الإنشاء, الموعد) بيتفلتر تلقائيًا — موعد قريب جدًا يعني checkpoints أقل، مش تراكم
// تذكيرات فات ميعادها.

export interface ScheduledJobCheckpointSettings {
  afterMinutes: number;
  dayBeforeHourUtc: number;
  preAppointmentMinutes: number;
}

/** بيرجّع الأوقات المرشّحة للتذكير الدوري (مش شاملة الإرسال الأول وقت الإنشاء) — مرتبة تصاعديًا. */
export function computeScheduledJobCheckpoints(
  createdAt: Date,
  targetAt: Date,
  settings: ScheduledJobCheckpointSettings,
): Date[] {
  const candidates: Date[] = [];

  candidates.push(new Date(createdAt.getTime() + settings.afterMinutes * 60_000));

  const dayBefore = new Date(targetAt);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  dayBefore.setUTCHours(settings.dayBeforeHourUtc, 0, 0, 0);
  candidates.push(dayBefore);

  candidates.push(new Date(targetAt.getTime() - settings.preAppointmentMinutes * 60_000));

  return candidates.filter((t) => t > createdAt && t < targetAt).sort((a, b) => a.getTime() - b.getTime());
}
