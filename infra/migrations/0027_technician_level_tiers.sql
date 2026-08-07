-- baytak — 0027: إعادة تسمية مستويات الفنيين لمطابقة الطلب (نقطة 4): جديد → موثّق → محترف →
-- بريميوم، + إضافة مستوى خامس "قائد فريق". renaming enum values بدل إعادة بناء الجدول —
-- كل البيانات الموجودة بتتحول تلقائياً (bronze كان الافتراضي، فمعظم الفنيين هيبقوا "جديد").
--
-- ADD VALUE على enum لازم يكون في transaction منفصلة عن أي استخدام للقيمة الجديدة (قيد PostgreSQL) —
-- عشان كده الجدول اللي بيستخدم 'team_leader' كصف (technician_level_config) في migration تالية (0028).

ALTER TYPE technician_level RENAME VALUE 'bronze' TO 'new';
ALTER TYPE technician_level RENAME VALUE 'silver' TO 'verified';
ALTER TYPE technician_level RENAME VALUE 'gold' TO 'professional';
ALTER TYPE technician_level RENAME VALUE 'platinum' TO 'premium';
ALTER TYPE technician_level ADD VALUE 'team_leader';
