/**
 * حذف حركات محفظة في تنظيف الاختبارات **مع إرجاع أرصدة المحافظ المتأثرة**.
 *
 * ## البَقّة اللي بيقفلها
 *
 * كل سبيك مالي بيمسح حركاته في `afterAll` بـ`DELETE FROM wallet_transactions WHERE …`. المشكلة
 * إن كل تسوية بتكتب **قيد مزدوج**: طرف على محفظة الفني، وطرف مقابل على **محفظة المنصة
 * المشتركة**. السبيك بيمسح الصفوف، بس `wallets.balance_cents` بيفضل شايل أثرها — ومحفظة
 * المنصة دي مابتتمسحش أبدًا، فالأثر بيتراكم عبر كل تشغيلة.
 *
 * المقاس على قاعدة التطوير قبل الإصلاح: رصيد محفظة المنصة −1,490,054.06 ج.م مقابل مجموع
 * حركاتها −639,192.00 ج.م — انحراف ~850 ألف جنيه، **كله من تنظيف اختبارات**.
 *
 * الضرر مش في رقم غلط على قاعدة تطوير: `/admin/analytics/money/reconciliation` هو العدّاد
 * المفروض يمسك كسر حقيقي في الدفتر، وهو بيقول ٢٣٤ مخالفة على طول. عدّاد إنذار دايمًا موجب
 * بيتعوّد الناس يتجاهلوه، وساعتها الكسر الحقيقي بيعدّي وسط الضوضاء.
 *
 * ## ليه الطرح بالأثر المسجّل مش إعادة الحساب
 *
 * كان ممكن نعمل `balance = SUM(الحركات الباقية)`. اترفض: ده **بيكتب فوق** أي حالة قايمة
 * ويداري انحراف حقيقي بدل ما يكشفه. الدالة دي بتطرح بالظبط أثر الصفوف المحذوفة —
 * `balance_after_cents − balance_before_cents` زي ما اتسجّل وقت الكتابة — فبترجّع الرصيد
 * للحالة اللي كان عليها قبل السبيك بالحرف، ولا بتلمس أي حاجة تانية.
 *
 * العمودين دول بيسجّلوا **الرصيد الدفتري** (`balance + reserved`)، و`doubleEntry` مابيلمسش
 * `reserved` خالص، فالفرق بينهم = التغيّر في `balance_cents` بالظبط.
 *
 * ## وليه بنعيد حياكة السلسلة كمان
 *
 * فحص المطابقة بيقيس حاجتين: تطابق الرصيد (فلوس ضايعة أو متخلقة)، **وتسلسل السلسلة**
 * (`balance_before` بتاع كل حركة = `balance_after` بتاعت اللي قبلها). حذف حركة من **نص**
 * تاريخ محفظة بيكسر التسلسل حتميًا مهما ظبطنا الرصيد — الصفوف الباقية لسه شايلة أرقام
 * بتشاور على صف اتشال.
 *
 * ده كان بيسيب ٢٣٣ مخالفة تسلسل على محفظة المنصة. فالدالة بتعيد حساب `balance_before/after`
 * للحركات الباقية على المحافظ المتأثرة بس — التاريخ بيفضل متصل، وعدّاد لوحة الأدمن يفضل
 * يعني حاجة.
 */

/** نفس شكل `q` المستخدم في السبيكات: `(sql, params) => dataSource.query(sql, params)`. */
export type SpecQuery = (sql: string, params?: unknown[]) => Promise<unknown>;

/**
 * بيمسح حركات المحفظة المطابقة للشرط وبيرجّع أرصدة المحافظ المتأثرة.
 *
 * @param q دالة الاستعلام بتاعت السبيك.
 * @param whereSql شرط `WHERE` **بلا** الكلمة نفسها، مثال: `reference_type = 'order' AND reference_id = ANY($1::uuid[])`.
 * @param params معاملات الشرط.
 * @returns عدد الصفوف اللي اتمسحت — مفيد لو السبيك عايز يتأكد إنه نضّف حاجة فعلاً.
 *
 * @example
 * await deleteWalletTransactions(q, `reference_type = 'order' AND reference_id = ANY($1::uuid[])`, [orderIds]);
 */
export async function deleteWalletTransactions(
  q: SpecQuery,
  whereSql: string,
  params?: unknown[],
): Promise<number> {
  // الحذف والطرح في عبارة واحدة: لو السبيك وقع بين الاتنين، كنا هنسيب نفس الانحراف اللي
  // الدالة دي موجودة عشانه. `effect` بيتجمّع لكل محفظة قبل ما يتطرح مرة واحدة.
  const affected = (await q(
    `WITH deleted AS (
       DELETE FROM wallet_transactions
        WHERE ${whereSql}
       RETURNING wallet_id, balance_after_cents - balance_before_cents AS effect_cents
     ), per_wallet AS (
       SELECT wallet_id, SUM(effect_cents)::bigint AS effect_cents, COUNT(*)::int AS deleted_rows
         FROM deleted
        GROUP BY wallet_id
     ), restored AS (
       UPDATE wallets w
          SET balance_cents = w.balance_cents - p.effect_cents
         FROM per_wallet p
        WHERE w.id = p.wallet_id
       RETURNING w.id AS wallet_id, p.deleted_rows
     )
     -- العبارة بتنتهي بـ\`SELECT\` عمدًا: \`UPDATE … RETURNING\` بيرجع من TypeORM بشكل
     -- \`[صفوف, عدد]\` مش مصفوفة صفوف، فالقراءة منه كانت بتطلع \`NaN\`.
     SELECT wallet_id, deleted_rows FROM restored`,
    params,
  )) as { wallet_id: string; deleted_rows: number }[];

  if (affected.length === 0) return 0;

  // **عبارة تانية مستقلة عن قصد.** في Postgres، تعديلات CTE مابتبقاش مرئية لباقي أجزاء
  // **نفس** العبارة — كلهم بيشوفوا نفس الـsnapshot. فلو الحياكة اتعملت جوّه العبارة فوق،
  // كانت هتحسب المجاميع التراكمية وهي **لسه شايفة الصفوف المحذوفة**، وتكتب أرقام غلط على
  // الصفوف الباقية. الفصل هنا هو اللي بيخلّيها تقرا الحالة بعد الحذف فعلاً.
  await q(
    `UPDATE wallet_transactions t
        SET balance_before_cents = c.before_cents,
            balance_after_cents = c.after_cents
       FROM (
         SELECT x.id,
                COALESCE(SUM(x.effect) OVER (
                  PARTITION BY x.wallet_id ORDER BY x.created_at, x.id
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::int AS before_cents,
                SUM(x.effect) OVER (
                  PARTITION BY x.wallet_id ORDER BY x.created_at, x.id)::int AS after_cents
           FROM (
             SELECT id, wallet_id, created_at,
                    CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END AS effect
               FROM wallet_transactions
              WHERE wallet_id = ANY($1::uuid[])
           ) x
       ) c
      WHERE t.id = c.id
        AND (t.balance_before_cents <> c.before_cents OR t.balance_after_cents <> c.after_cents)`,
    [affected.map((row) => row.wallet_id)],
  );

  return affected.reduce((total, row) => total + Number(row.deleted_rows), 0);
}
