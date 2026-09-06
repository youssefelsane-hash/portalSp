INSERT INTO settings (key, value, value_type, group_name, description, is_public)
VALUES ('matching.additional_request_batch_size', '4', 'number', 'matching',
        'عدد المؤهلين في دفعة طلب الشغل الإضافي المجدول (1 إلى 100)، اختيار العميل يظل حصريًا', false)
ON CONFLICT (key) DO NOTHING;
