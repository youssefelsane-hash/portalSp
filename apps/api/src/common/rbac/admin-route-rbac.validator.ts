import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AdminRouteDeclaration, formatUndeclared, scanAdminRoutes } from './admin-route-rbac.scanner';

/**
 * حارس بنيوي لتدقيق S-1: **مسار مقصور على الأدمن لازم يعلن صلاحيته**.
 *
 * `PermissionsGuard` fail-open بالتصميم (مسار بلا `@RequirePermission` بيعدّي) — وده منطقي
 * كسلوك guard، بس معناه إن الغياب مايتلاحظش. وقت التدقيق كان فيه ٩٢ مسار أدمن مالهمش أي صلاحية،
 * فيهم بيانات شخصية للعملاء وكشوف أرباح فنيين — وكل موظف في النظام `user_type='admin'`، يعني
 * `@Roles(ADMIN)` مش حدّ صلاحيات أصلاً، هو بس «مش عميل ولا فني».
 *
 * الحل مش مراجعة بالعين (اللي هي اللي فشلت أصلاً) — الحل إن **الغياب يبقى مستحيل**: الفحص ده
 * بيمشي على كل الـcontrollers المسجّلة وقت الإقلاع، والتطبيق مابيقومش لو لقى مسار غير معلَن.
 * أوضح بكتير من ثغرة صامتة في الإنتاج.
 *
 * الفحص التاني: كل اسم صلاحية مذكور في `@RequirePermission` لازم يكون موجود فعلاً في كتالوج
 * `permissions`. اسم مكتوب غلط بيفشل **مقفول** (محدش يقدر ينفّذ العملية أبدًا، ولا حتى بدور كامل)
 * — بَقّة صامتة تانية، بس في الاتجاه المعاكس.
 */
@Injectable()
export class AdminRouteRbacValidator implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminRouteRbacValidator.name);

  constructor(
    private readonly discovery: DiscoveryService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const controllers = this.discovery
      .getControllers()
      .map((w) => w.metatype)
      .filter((m): m is new (...args: never[]) => unknown => typeof m === 'function');
    const report = scanAdminRoutes(controllers);

    if (report.undeclared.length > 0) {
      throw new Error(formatUndeclared(report.undeclared));
    }

    await this.assertPermissionsExistInCatalog(report.declared);

    const withPermission = report.declared.filter((d) => d.permission !== null).length;
    this.logger.log(
      `تحقق RBAC: ${report.declared.length} مسار أدمن معلَن — ${withPermission} بصلاحية دقيقة، ` +
        `${report.declared.length - withPermission} مفتوح لأي أدمن بسبب مكتوب.`,
    );
  }

  private async assertPermissionsExistInCatalog(declared: AdminRouteDeclaration[]): Promise<void> {
    const referenced = Array.from(new Set(declared.map((d) => d.permission).filter((p): p is string => p !== null)));
    if (referenced.length === 0) return;

    let known: Set<string>;
    try {
      const rows = await this.dataSource.query<{ name: string }[]>(
        `SELECT name FROM permissions WHERE name = ANY($1::text[])`,
        [referenced],
      );
      known = new Set(rows.map((r) => r.name));
    } catch (err) {
      // قاعدة لسه ماتطبّقتش عليها الـmigrations (أول إقلاع على بيئة جديدة) — الفحص البنيوي فوق
      // مالوش علاقة بالقاعدة وخلص خلاص، فمفيش سبب نمنع الإقلاع هنا.
      this.logger.warn(`تخطّي فحص كتالوج الصلاحيات: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const missing = referenced.filter((name) => !known.has(name));
    if (missing.length > 0) {
      throw new Error(
        `صلاحيات مذكورة في @RequirePermission ومش موجودة في كتالوج permissions: ${missing.join(', ')}.\n` +
          `اسم غلط معناه إن العملية دي مقفولة على الكل للأبد (حتى بدور كامل) — لازم migration تضيفها.`,
      );
    }
  }
}
