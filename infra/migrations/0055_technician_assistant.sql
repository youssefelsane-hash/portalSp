-- baytak (صُنّاع) — 0055: "معاه مساعد؟" في بروفايل الفني (docs/06 §3.7، docs/07 الجزء د)
-- المالك: "كل صنايعي في البروفايل بتاعه يبقى فيه سؤال معاه مساعد؟... لو الصنايعي عايز يضيف مساعد
-- بنفسه من بروفايله يقدر يعمل ده، وبعدين الإدارة توافق على الإضافة دي". ربط بـtechnician_code
-- (Employee ID) بالظبط زي ما طلب المالك — مش UUID خام، أسهل للفني يعرفه (نفس نمط
-- POST /technician/company/staff الموجود بالفعل).
CREATE TYPE technician_assistant_link_status AS ENUM ('none', 'pending_approval', 'approved');

ALTER TABLE technician_profiles ADD COLUMN assistant_technician_id UUID NULL REFERENCES technician_profiles(id);
ALTER TABLE technician_profiles ADD COLUMN assistant_link_status technician_assistant_link_status NOT NULL DEFAULT 'none';
