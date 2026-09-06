import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';

export class UpdateStaffDto {
  @IsOptional()
  @IsIn(['manager', 'supervisor', 'worker'])
  team_role?: 'manager' | 'supervisor' | 'worker';

  // null صريح = شيل الفرع، undefined = مفيش تعديل
  @IsOptional()
  @IsUUID()
  branch_id?: string | null;

  /**
   * **«حصري للشركة»** (ADR-0080) — العضو ده مايظهرش كفرد خالص؛ يوصله شغل عن طريق الشركة بس.
   * قرار الشركة نفسها (المالك/المدير) لأنه بيخدم مصلحتها، والأدمن يقدر يعدّله كمان من بروفايل
   * الفني. الفني نفسه بيشوف حالته ومابيغيّرهاش — تركها له بيلغي الغرض منها.
   */
  @IsOptional()
  @IsBoolean()
  company_exclusive?: boolean;
}
