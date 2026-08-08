import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateFeatureFlagDto } from './create-feature-flag.dto';

// الـ key ثابت بعد الإنشاء — نفس فلسفة slug في catalog، عشان أي كود تاني بيستخدم
// FeatureFlagsService.isEnabled(key) يفضل يشتغل صح من غير ما ينكسر بتغيير اسم.
export class UpdateFeatureFlagDto extends PartialType(OmitType(CreateFeatureFlagDto, ['key'] as const)) {}
