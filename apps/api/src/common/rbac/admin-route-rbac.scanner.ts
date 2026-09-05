import { PATH_METADATA } from '@nestjs/common/constants';
import { ANY_ADMIN_KEY } from '../decorators/any-admin.decorator';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserType } from '../../modules/auth/entities/user.entity';

export interface AdminRouteDeclaration {
  controller: string;
  handler: string;
  path: string;
  /** اسم الصلاحية من `@RequirePermission`، أو null لو المسار معلَن `@AnyAdmin`. */
  permission: string | null;
  /** سبب الفتح من `@AnyAdmin`، أو null لو المسار عليه صلاحية. */
  anyAdminReason: string | null;
}

export interface AdminRouteRbacReport {
  declared: AdminRouteDeclaration[];
  /** مسارات مقصورة على الأدمن بلا `@RequirePermission` ولا `@AnyAdmin` — الفئة اللي بتفشّل الإقلاع. */
  undeclared: { controller: string; handler: string; path: string }[];
}

type Ctor = new (...args: never[]) => unknown;

/**
 * منطق تدقيق S-1 كدالة نقية على قايمة كلاسات الـcontrollers — عشان نفس القواعد بالحرف تشتغل
 * في مكانين: `AdminRouteRbacValidator` (وقت إقلاع التطبيق، بياخد الكلاسات من `DiscoveryService`)
 * والـspec/سكريبت CI (بياخدهم بالـimport المباشر، من غير ما يقوّم التطبيق كله بطوابيره).
 *
 * **القاعدة**: مسار عليه `@Roles(UserType.ADMIN)` **لوحده** لازم يعلن `@RequirePermission('...')`
 * أو `@AnyAdmin('السبب')`. مسار مشترك مع عميل/فني مستثنى لأن العميل/الفني مالهمش أدوار في
 * `role_permissions` أصلاً — التفويض هناك resource-scoped جوّه الـservice، مش RBAC.
 */
export function scanAdminRoutes(controllers: readonly Ctor[]): AdminRouteRbacReport {
  const declared: AdminRouteDeclaration[] = [];
  const undeclared: AdminRouteRbacReport['undeclared'] = [];

  for (const controller of controllers) {
    const prototype = controller.prototype as object | undefined;
    if (!prototype) continue;
    const controllerName = controller.name;
    const basePath = readPath(controller);

    for (const methodName of Object.getOwnPropertyNames(prototype)) {
      if (methodName === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
      const handler = descriptor?.value as unknown;
      if (typeof handler !== 'function') continue;
      // الميتاداتا بتتحط على الدالة نفسها؛ مفيش HTTP method decorator = مش مسار أصلاً.
      if (Reflect.getMetadata(PATH_METADATA, handler as object) === undefined) continue;
      if (!isAdminOnlyRoute(controller, handler)) continue;

      const permission = readOwnOrClass<string>(REQUIRE_PERMISSION_KEY, controller, handler);
      const anyAdminReason = readOwnOrClass<string>(ANY_ADMIN_KEY, controller, handler);
      const path = `/${basePath}/${readPath(handler)}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';

      if (permission === undefined && anyAdminReason === undefined) {
        undeclared.push({ controller: controllerName, handler: methodName, path });
        continue;
      }
      declared.push({
        controller: controllerName,
        handler: methodName,
        path,
        permission: permission ?? null,
        anyAdminReason: anyAdminReason ?? null,
      });
    }
  }

  const byRoute = (a: { controller: string; handler: string }, b: { controller: string; handler: string }): number =>
    a.controller.localeCompare(b.controller) || a.handler.localeCompare(b.handler);
  return { declared: declared.sort(byRoute), undeclared: undeclared.sort(byRoute) };
}

export function formatUndeclared(undeclared: AdminRouteRbacReport['undeclared']): string {
  const lines = undeclared.map((r) => `  - ${r.controller}.${r.handler}  (${r.path})`).join('\n');
  return (
    `${undeclared.length} مسار مقصور على الأدمن من غير إعلان صلاحية.\n` +
    `كل مسار عليه @Roles(UserType.ADMIN) لوحده لازم يكون عليه @RequirePermission('...') ` +
    `أو @AnyAdmin('السبب') — من غير ده أي موظف عنده حساب أدمن يقدر ينده عليه.\n${lines}`
  );
}

function isAdminOnlyRoute(controller: Ctor, handler: unknown): boolean {
  const roles = readOwnOrClass<UserType[]>(ROLES_KEY, controller, handler);
  return Array.isArray(roles) && roles.length === 1 && roles[0] === UserType.ADMIN;
}

/** نفس أسبقية `Reflector.getAllAndOverride`: الدالة بتغلب الكلاس. */
function readOwnOrClass<T>(key: string, controller: Ctor, handler: unknown): T | undefined {
  const onHandler = Reflect.getMetadata(key, handler as object) as T | undefined;
  if (onHandler !== undefined) return onHandler;
  return Reflect.getMetadata(key, controller) as T | undefined;
}

function readPath(target: unknown): string {
  if (target === undefined || target === null) return '';
  const value = Reflect.getMetadata(PATH_METADATA, target as object) as string | string[] | undefined;
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
