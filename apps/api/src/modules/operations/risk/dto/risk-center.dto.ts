import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { RISK_QUEUE_SORTS, type RiskQueueSort } from '../risk-center.service';

/** قيم مطابقة لـ`CHECK` بتاع الجداول بالحرف — مصدرين للقايمة ممنوع يختلفوا. */
export const RISK_VERDICTS = ['pending', 'legitimate', 'suspicious', 'confirmed_abuse', 'insufficient_evidence'] as const;
export const RISK_CASE_STATUSES = ['needs_review', 'monitoring', 'investigating', 'cleared', 'confirmed_manipulation'] as const;
export const RISK_ACTION_TYPES = [
  'monitor', 'manual_review', 'reduce_matching_priority', 'matching_hold',
  'suspend_account', 'restore_account', 'clear_no_action',
] as const;
export const RISK_BUCKETS = [
  'pricing_abuse', 'parts_manipulation', 'order_abuse',
  'off_platform_leakage', 'customer_abuse', 'collusion_fraud',
] as const;

export class RiskQueueQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  min_score?: number;

  @IsOptional()
  @IsIn(['technician', 'assistant', 'customer', 'company'])
  actor_type?: string;

  @IsOptional()
  @IsIn(RISK_BUCKETS as unknown as string[])
  bucket?: string;

  @IsOptional()
  @IsIn(RISK_CASE_STATUSES as unknown as string[])
  case_status?: string;

  @IsOptional()
  @IsIn(RISK_QUEUE_SORTS as unknown as string[])
  sort?: RiskQueueSort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

/**
 * حكم المراجع على إشارة.
 *
 * **الملاحظات إجبارية**: الحكم بيغيّر درجة إنسان فورًا، وحكم بلا سبب مكتوب مابيراجعش — نفس
 * قاعدة التبرير الإجباري في ADR-0084 §2.
 */
export class RecordRiskVerdictDto {
  @IsIn(RISK_VERDICTS as unknown as string[])
  verdict: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  notes: string;
}

export class UpsertRiskCaseDto {
  @IsOptional()
  @IsIn(RISK_CASE_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsUUID()
  assigned_to_user_id?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  notes?: string;
}

export class RecordRiskActionDto {
  @IsIn(RISK_ACTION_TYPES as unknown as string[])
  action_type: string;

  /** ١٠ حروف على الأقل — خانة بتتملا بنقطة مابتساءلش حد. */
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason: string;

  @IsOptional()
  @IsISO8601()
  expires_at?: string;
}

export class RunRiskDetectorsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  window_days?: number;
}
