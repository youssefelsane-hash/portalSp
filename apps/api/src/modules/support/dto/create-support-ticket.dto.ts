import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { SupportChannel, SupportTicketPriority } from '../entities/support-ticket.entity';

// ملحوظة: جدول support_tickets في docs/02-data-dictionary.md §8.4 معندوش عمود نص/وصف —
// بس subject. مش هنخترع عمود جديد محتاج migration مش موجودة في القاموس؛ الموضوع هو التذكرة،
// وأي تفاصيل إضافية المفروض تتقال عبر chat_threads (thread_type=support_chat) بعد فتح التذكرة —
// ده لسه مش متوصّل، موثّق كفجوة في README.
export class CreateSupportTicketDto {
  @IsString()
  @Length(3, 200)
  subject: string;

  @IsString()
  @Length(2, 60)
  category: string;

  @IsEnum(SupportChannel)
  channel: SupportChannel;

  @IsOptional()
  @IsEnum(SupportTicketPriority)
  priority?: SupportTicketPriority;
}
