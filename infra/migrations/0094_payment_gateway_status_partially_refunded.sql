-- baytak — 0094: قيمة enum جديدة لازم تكون في migration منفصلة (ALTER TYPE ... ADD VALUE ميقدرش
-- يتستخدم في نفس transaction اللي فيها statement بيستخدم القيمة الجديدة، حتى لو كل migration
-- بيشتغل في transaction لوحده — نفس سابقة 0042_fawry_payment_method.sql بالحرف).
ALTER TYPE payment_gateway_status ADD VALUE 'partially_refunded';
