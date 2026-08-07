import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

// صلاحية دقيقة فوق RolesGuard — مش بديل عنه. لازم المستخدم يكون admin الأول (RolesGuard)
// وبعدين يكون عنده الصلاحية دي تحديداً عبر user_roles→role_permissions (PermissionsGuard).
export const RequirePermission = (permissionName: string) => SetMetadata(REQUIRE_PERMISSION_KEY, permissionName);
