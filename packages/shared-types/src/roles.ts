// باني الأدوار الديناميكي (ADR-0010) — مطابق لـ apps/api/src/modules/admin/permissions.service.ts
// و entities/{role,permission}.entity.ts. الـAPI بيرجّع صفوف الكيانات الخام (camelCase) من غير
// DTO mapper — نفس الفلسفة القديمة الموجودة قبل كده في notification-routing.ts.

export interface RoleResponseDto {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  isSuperAdmin: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PermissionResponseDto {
  id: string;
  name: string;
  resource: string;
  action: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface RoleDetailResponseDto {
  role: RoleResponseDto;
  permission_names: string[];
  users: { user_id: string; full_name: string; phone_number: string; assigned_at: string }[];
}

export interface CreateRoleBody {
  name: string;
  display_name: string;
  description?: string;
}

export interface UpdateRoleBody {
  display_name?: string;
  description?: string;
  is_active?: boolean;
}

export interface SetRolePermissionsBody {
  permission_names: string[];
}
