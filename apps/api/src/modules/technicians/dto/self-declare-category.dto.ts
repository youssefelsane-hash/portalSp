import { IsUUID } from 'class-validator';

// ADR-0018 §8 — الفني بيصرّح بفئة/تخصص (trade) كامل مش خدمة واحدة (GET /service-categories
// الموجود بالفعل)، نفس فلسفة self-declare-service.dto.ts بالحرف بس بلا skill_level (مفهوم
// مستوى المهارة معناه بس على خدمة واحدة محددة، مش فئة كاملة).
export class SelfDeclareCategoryDto {
  @IsUUID()
  category_id: string;
}
