/**
 * **نطاق المنفّذ — الشرط الواحد اللي الفني والشركة بيعدّوا منه** (ADR-0079).
 *
 * طلب المالك بالحرف (2026-09-06): «أنا عايز الشركة يكون عندها نفس اللي عند الفني بالضبط…
 * ما تعملهاش حاجات زي الفني، لأ، دخّلها على **نفس اللاين**… بحيث لما أنا أغيّر حاجة كلها
 * ترفليكت في بعض مرة واحدة، ما نقعدش نعدّل في كل مكان».
 *
 * `technician_services` / `technician_categories` / `technician_zones` بقت جداول **نطاق
 * منفّذ**: الصف يخصّ فني فرد (`technician_id`) أو شركة (`company_id`)، واحد بالظبط (مفروض
 * بـ`chk_*_owner` على مستوى القاعدة). فالقاعدة هنا جملة SQL **واحدة** بيتغيّر فيها اسم عمود
 * المالك بس — أي قاعدة أهلية جديدة بتتكتب مرة وبتسري على الاتنين **بالبناء**، مش بالمراجعة.
 */

/** عمود المالك في جداول النطاق — القيمتين الوحيدتين الممكنتين (القيد في القاعدة بيفرض واحد بالظبط). */
export type ProviderOwnerColumn = 'technician_id' | 'company_id';

export interface ProviderScopeOpts {
  /** عمود المالك اللي هيتقارن بيه — `technician_id` للفرد، `company_id` للشركة. */
  ownerColumn: ProviderOwnerColumn;
  /** تعبير SQL لمعرّف المالك، مثلاً `tp.id` أو `tc.id` أو `$1`. */
  ownerIdExpr: string;
  /** تعبير SQL لمعرّف الخدمة المطلوبة، مثلاً `$1` أو `svc.id`. */
  serviceIdExpr: string;
  /** تعبير SQL لمعرّف فئة الخدمة، مثلاً `svc.category_id`. */
  categoryIdExpr: string;
  /**
   * alias لـ`LEFT JOIN technician_services` لو الاستعلام عامله بالفعل (مثلاً `ts`) — بنستخدم
   * `<alias>.id IS NOT NULL` زي ما كان بالظبط. لو مش موجود، الدالة بتبني `EXISTS` بنفسها.
   *
   * **للشركة مايتبعتش**: الـJOIN القايم في استعلامات الحجز معمول على خدمات **العضو**، فلو
   * اتبعت هنا الشرط هيقيس نطاق العضو ويسمّيه نطاق الشركة.
   */
  directServiceAlias?: string;
}

/**
 * «المنفّذ ده مؤهّل للخدمة دي؟» — خدمة معتمدة مباشرة **أو** فئتها معتمدة، ناقص أي حجب صريح.
 *
 * قايمة الحجب (`technician_excluded_services`) بتفضل على الفني بس: الحجب قرار على شخص بعينه،
 * والشركة بتتضبط بنطاقها هي (تشيل الخدمة من نطاقها بدل ما تحجبها). لو احتجنا حجب على مستوى
 * الشركة بعدين، بيتضاف هنا مرة واحدة ويسري على الاتنين.
 */
export function providerServiceQualificationCondition(opts: ProviderScopeOpts): string {
  const { ownerColumn, ownerIdExpr, serviceIdExpr, categoryIdExpr } = opts;

  const directlyApproved = opts.directServiceAlias
    ? `${opts.directServiceAlias}.id IS NOT NULL`
    : `EXISTS (
             SELECT 1 FROM technician_services direct_svc
             WHERE direct_svc.${ownerColumn} = ${ownerIdExpr}
               AND direct_svc.service_id = ${serviceIdExpr}
               AND direct_svc.is_active = true
               AND direct_svc.verification_status = 'approved'
           )`;

  const qualified = `(
          ${directlyApproved}
          OR EXISTS (
            SELECT 1 FROM technician_categories tec_cat
            WHERE tec_cat.${ownerColumn} = ${ownerIdExpr}
              AND tec_cat.category_id = ${categoryIdExpr}
              AND tec_cat.is_active = true AND tec_cat.verification_status = 'approved'
          )
        )`;

  if (ownerColumn === 'company_id') return qualified;

  // ADR-0049 — حجب الأدمن لخدمة بعينها عن الفني ده. مفروض على دور الفني والمساعد الاتنين.
  return `${qualified}
        AND NOT EXISTS (
          SELECT 1 FROM technician_excluded_services tes
          WHERE tes.technician_id = ${ownerIdExpr}
            AND tes.service_id = ${serviceIdExpr}
        )`;
}

/** «المنفّذ ده بيغطّي المنطقة دي؟» — نفس الجدول ونفس الشرط للاتنين. */
export function providerZoneCondition(opts: {
  ownerColumn: ProviderOwnerColumn;
  ownerIdExpr: string;
  zoneIdExpr: string;
}): string {
  return `EXISTS (
          SELECT 1 FROM technician_zones pz
          WHERE pz.${opts.ownerColumn} = ${opts.ownerIdExpr}
            AND pz.service_zone_id = ${opts.zoneIdExpr}
            AND pz.is_active = true AND pz.deleted_at IS NULL
        )`;
}

/**
 * «الشركة دي ضابطة نطاق خاص بيها أصلاً؟»
 *
 * ADR-0079 — النطاق **بيضيّق مايوسّعش**، والشركة اللي الأدمن ماضبطلهاش نطاق بتفضل بالسلوك
 * القديم بالحرف (الاشتقاق من الأعضاء). فالترحيل بلا أي تغيير سلوكي لحد ما الأدمن يضبط شركة
 * بعينها — مش علم عام بيقلب الدنيا على كل الشركات مرة واحدة.
 */
export function companyHasOwnScopeExpr(companyIdExpr: string): string {
  return `(
          EXISTS (SELECT 1 FROM technician_services cs
                   WHERE cs.company_id = ${companyIdExpr} AND cs.is_active = true
                     AND cs.verification_status = 'approved')
          OR EXISTS (SELECT 1 FROM technician_categories cc
                      WHERE cc.company_id = ${companyIdExpr} AND cc.is_active = true
                        AND cc.verification_status = 'approved')
        )`;
}

/** نفس السؤال للمناطق — منفصل لأن الشركة ممكن تضبط خدماتها بس أو مناطقها بس. */
export function companyHasOwnZoneScopeExpr(companyIdExpr: string): string {
  return `EXISTS (
          SELECT 1 FROM technician_zones cz
          WHERE cz.company_id = ${companyIdExpr} AND cz.is_active = true AND cz.deleted_at IS NULL
        )`;
}
