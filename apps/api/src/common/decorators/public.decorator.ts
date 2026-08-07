import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// يعفي endpoint من JwtAuthGuard العام — استخدمها بس على المسارات اللي فعلاً مفروض تكون مفتوحة
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
