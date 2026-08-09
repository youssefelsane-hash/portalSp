-- baytak — 0042: إضافة fawry_reference لـ payment_method enum
-- تفعيل بوابة FawryPay (كود مرجعي "ادفع في أقرب فوري" — أوسع شبكة دفع كاش في مصر) كطريقة دفع
-- تانية جنب Paymob، مش بديل ليها. عمود payment_gateway في جدول payments (0008_finance.sql)
-- كان أصلاً معلّق عليه "-- paymob | fawry | manual" من أول يوم، فالجدول جاهز بالكامل — العمود
-- الوحيد الناقص هو قيمة enum جديدة لـ payment_method نفسه.
-- ADD VALUE هنا آمن جوّه transaction (PostgreSQL 12+) طالما مش بنستخدم القيمة الجديدة في
-- نفس الـ migration — مرجع: apps/api/src/modules/payments/README.md.
ALTER TYPE payment_method ADD VALUE 'fawry_reference';
