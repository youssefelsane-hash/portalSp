-- baytak — 0046: زرار "إعادة الحجز" — عمود اختياري لطلب فني محدّد بالاسم
-- طلب صريح ضمن اقتراحات بروفايل الفني: العميل يقدر يطلب نفس الفني اللي اشتغل معاه قبل كده.
-- تفضيل بس، مش ضمان — لو الفني مش متاح وقت المطابقة، الطلب بيكمل بالتوزيع العادي بدل ما يتلغي
-- (تفاصيل الخوارزمية في apps/api/src/modules/matching/README.md).
ALTER TABLE orders ADD COLUMN requested_technician_id UUID NULL REFERENCES technician_profiles(id);
