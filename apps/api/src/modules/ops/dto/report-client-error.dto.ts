import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * أنواع الأخطاء (ADR-0114). **قايمة مقفولة** مش نص حر: ده مسار كتابة عام، وحقل تجميع حر
 * معناه إن اللي بيبعت بيقدر يفتّت التجميع أو يكبّر الجدول بقيم بلا معنى.
 */
export const CLIENT_ERROR_KINDS = ['render', 'api', 'network', 'unhandled_rejection', 'not_found'] as const;
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];

export const CLIENT_ERROR_APPS = ['customer-web', 'admin'] as const;

export class ReportClientErrorDto {
  @IsIn(CLIENT_ERROR_APPS)
  app: string;

  @IsIn(CLIENT_ERROR_KINDS)
  kind: ClientErrorKind;

  @IsString()
  @MaxLength(300)
  page_path: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  error_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error_message?: string;

  /** من `error.tsx`. مقصوص — بعد الـminify الباقي مش بيزود تشخيص. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  component_stack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  api_path?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(599)
  api_status?: number;
}
