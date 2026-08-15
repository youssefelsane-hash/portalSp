import { IsEnum, IsString, Length } from 'class-validator';

// docs/08 §22 بند 13-14 — الأدمن بيراجع النزاع (بلاغ الفني + تأكيد العميل لو موجود) ويقرر:
// retry = الفني يعيد محاولة التحصيل (الطلب يرجع WORK_COMPLETED، collectCash() تشتغل عادي تاني)
// confirm_received = الأدمن راجع وقرر إن الكاش فعلاً اتحصّل (تسوية إدارية مباشرة)
export enum CashDisputeOutcome {
  RETRY = 'retry',
  CONFIRM_RECEIVED = 'confirm_received',
}

export class ResolveCashDisputeDto {
  @IsEnum(CashDisputeOutcome)
  outcome: CashDisputeOutcome;

  @IsString()
  @Length(5, 1000)
  admin_notes: string;
}
