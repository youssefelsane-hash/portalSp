-- قرار مالي صريح: أي خصم (كوبون أو عمارة) تتحمله المنصة/الشركة فقط.
-- حذف المفتاح يمنع إعدادًا قديمًا من إعادة تحميل الخصم على مستحق الفني.
DELETE FROM settings WHERE key = 'commission_base.discount_reduces_technician_share';
