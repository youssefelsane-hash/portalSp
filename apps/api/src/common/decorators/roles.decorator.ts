import { SetMetadata } from '@nestjs/common';
import { UserType } from '../../modules/auth/entities/user.entity';

export const ROLES_KEY = 'userTypes';

// RBAC على مستوى user_type (customer | technician | admin | partner) — docs/01-master-plan.md §7.1
export const Roles = (...userTypes: UserType[]) => SetMetadata(ROLES_KEY, userTypes);
