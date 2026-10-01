// checkpoints تذكير scheduled_job (ADR-0012، docs/08 §15) — مش فاصل ثابت متكرر زي action_required،
// سلسلة نقاط مبنية على الموعد المستهدف نفسه: فورًا (بيتبعت وقت الإنشاء، مش من هنا)، بعدها لو
// لسه ما اتفتحش: بعد N دقيقة، صبح اليوم اللي قبل الموعد، وقبل الموعد بفترة أخيرة. أي checkpoint
// بره النطاق [الإنشاء, الموعد) بيتفلتر تلقائيًا — موعد قريب جدًا يعني checkpoints أقل، مش تراكم
// تذكيرات فات ميعادها.

const MIN_GAP_BETWEEN_CHECKPOINTS_MS = 30 * 60_000;

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

  const inRange = candidates.filter((t) => t > createdAt && t < targetAt).sort((a, b) => a.getTime() - b.getTime());
  // نقطتين قريبين من بعض (مثلاً «بعد ساعة» و«صبح اليوم اللي قبله» وقعوا نفس الساعة) كانوا بيطلعوا
  // تذكيرين ورا بعض — للمستخدم ده إزعاج مش تذكير. الأولى بس هي اللي بتفضل.
  const distinct: Date[] = [];
  for (const t of inRange) {
    const previous = distinct[distinct.length - 1];
    if (previous && t.getTime() - previous.getTime() < MIN_GAP_BETWEEN_CHECKPOINTS_MS) continue;
    distinct.push(t);
  }
  return distinct;
}
