# ADR-0022: الفريق المفضّل (Preferred Crew) — شبكة تفضيل نظير-لنظير دائمة

**الحالة:** معتمد
**التاريخ:** 2026-08-21

## السياق

طلب المالك الصريح (docs/08 §36، الجزء ج، بند 20-34) بيوضّح إن المطلوب **نموذج تالت** منفصل تمامًا
عن الاتنين الموجودين فعلاً:

1. **`order_team_members`/`OrderTeamService`** (§31/§35.1-3) — طاقم فعلي لطلب واحد بعينه، مؤقت
   (بيتكون وقت الطلب، مبيعيشش بعده)، القائد بيختار أعضاءه من المجمع العام أو فريقه الدائم لو عنده.
2. **`technician_companies`** — علاقة توظيف تنظيمية (شركة/فرع)، فيها مالك/موظفين، مرتبطة بحساب
   قانوني/إداري (اعتماد §1.5).
3. **`assistant_technician_id`/`assistant_link_status`** (docs/06 §3.7، "معاه مساعد؟") — علاقة
   **غير متماثلة** (فني رئيسي واحد + مساعد تابع واحد بالظبط)، محتاجة موافقة أدمن صراحة قبل ما تبقى
   رسمية (مسؤولية/أجر مرتبطين بيها).

المطلوب الجديد: **فريق مفضّل نظير-لنظير دائم** — فني يقدر يبني قايمة زملاء يحب يشتغل معاهم بشكل
متكرر، مستقلة عن اللي فوق، تُستخدم كإشارة أولوية إضافية وقت تجنيد طاقم طلب فريق (فوق منطق §35.1-3
الموجود، مش بديل ليه). العلاقة دي **مش توظيف ولا مسؤولية قانونية** — أقرب لـ"قايمة مفضّلة" منها
لعلاقة شركة/مساعد، فمفيش داعي منطقي لموافقة أدمن عليها (عكس المساعد اللي فيه أجر/مسؤولية مرتبطة).

## القرار

### نموذج البيانات

جدول جديد `technician_preferred_crew_members` (migration منفصلة، مش تعديل على أي migration
سابقة):

```sql
CREATE TYPE preferred_crew_member_status AS ENUM ('invited', 'accepted', 'declined', 'removed');

CREATE TABLE technician_preferred_crew_members (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  owner_technician_id   UUID NOT NULL REFERENCES technician_profiles(id),
  member_technician_id  UUID NOT NULL REFERENCES technician_profiles(id),
  status            preferred_crew_member_status NOT NULL DEFAULT 'invited',
  invited_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at      TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ NULL,
  CHECK (owner_technician_id != member_technician_id)
);
-- فهرس فريد جزئي — علاقة واحدة "حية" بس بين نفس الاتنين في أي وقت (مش unique عادي، عشان لو
-- الفني اتشال وبعدين اتدعى تاني يبقى صف جديد، مش تصادم مع القديم المحذوف/المرفوض).
CREATE UNIQUE INDEX idx_preferred_crew_active_pair ON technician_preferred_crew_members
  (owner_technician_id, member_technician_id) WHERE status IN ('invited', 'accepted');
```

- **اتجاه واحد بس (owner→member)، مش صف متبادل تلقائي**: لو فني أ دعا فني ب وقبل، ده صف واحد
  (`owner=أ, member=ب, status=accepted`). العلاقة **مش متماثلة تلقائيًا** — لو ب عايز أ يبقى ضمن
  قايمته هو كمان، لازم يدعوه بنفسه (صف تاني منفصل `owner=ب, member=أ`). قرار مقصود: بساطة أكتر
  (صف واحد وحالة واحدة واضحة لكل دعوة)، وبيعكس الواقع الفعلي (فني ممكن يفضّل زميل معيّن من غير ما
  الزميل ده يفضّله بالمثل بالضرورة).
- **حد أقصى قابل للتعديل**: `settings` key جديد `matching.preferred_crew_max_size` (افتراضي 10،
  نفس نمط `SettingsService` الموجود بالكامل — Redis cache + DB fallback). بيتفحص وقت الدعوة
  (`inviteMember()`) على عدد `accepted` بس (مش `invited` المعلّقة).
- **صفر موافقة أدمن**: العلاقة دي قايمة تفضيل شخصية بحتة، مش توظيف — دعوة/قبول/رفض/إزالة كلها
  بين الفنيين نفسهم مباشرة، زي `OrderTeamService.addMember()` بالظبط (بلا موافقة العميل المُضاف
  حتى في السياق ده، فبالأولى بلا موافقة أدمن في علاقة أضعف مسؤولية).

### الأولوية في تجنيد الطاقم (§36.17)

`OrderTeamService.listRecruitCandidates()`/`recruitMember()` (§35.1-3) عندها بالفعل ترتيب أولوية
لـ`isLeaderTeamMember` (نفس `technician_companies`). الفريق المفضّل بيضيف **مستوى أولوية تاني**
فوقه مباشرة: الترتيب بيبقى `isLeaderTeamMember DESC, isPreferredCrewMember DESC, distanceKm ASC,
...`. **صفر تجاوز لقواعد الأهلية/القدرة الموجودة** — الفريق المفضّل بيأثر على *الترتيب* بس، مش على
*الاستبعاد*؛ فني مش مؤهّل (فئة/نطاق/رتبة) لسه بيتستبعد حتى لو في الفريق المفضّل لقائد الطلب.

### الحدود المعمارية

- **مفيش أي تعديل على `order_team_members`/`technician_companies`/`assistant_link_status`** —
  الثلاثة الموجودين يفضلوا زي ما هما بالحرف، النموذج الجديد إضافي بحت.
- **`OrderTeamService`** (مش موديول جديد) هو اللي هيستهلك الجدول الجديد — نفس مبدأ ADR-0021 §5
  ("صفر مصدر حقيقة تاني")، الفريق المفضّل إشارة أولوية إضافية جوّه نفس آلية التجنيد الموجودة، مش
  مسار تجنيد موازي.

## البدائل اللي اتقيّمت

- **صف متبادل تلقائي (mutual) بدل اتجاه واحد**: اترفض — بيعقّد منطق "مين دعا مين" ومينفعش يعكس
  حالة واقعية (فني أ يحب يشتغل مع ب بس ب مش بالضرورة عايز نفس الحاجة).
- **موافقة أدمن على العضوية** (زي `assistant_link_status`): اترفض — العلاقة دي أضعف بكتير من علاقة
  المساعد (مفيش أجر/مسؤولية قانونية مرتبطة مباشرة)، وموافقة أدمن هتبطّئ فايدة الميزة (قايمة سريعة
  التحديث) من غير داعي حقيقي للمخاطرة.
- **تعديل `technician_companies` ليشمل عضوية "خفيفة" غير رسمية**: اترفض — بيخلط علاقتين مختلفتين
  جوهريًا (توظيف رسمي مقابل تفضيل شخصي) في نفس الجدول، هيصعّب أي استعلام مستقبلي محتاج يميّز بينهم.

## الأثر

- Migration جديدة (`infra/migrations/`) + `TechnicianPreferredCrewMember` entity جديد.
- `OrderTeamService` (`listRecruitCandidates()`) — إضافة `isPreferredCrewMember` للترتيب، صفر
  تغيير في منطق الاستبعاد الحالي.
- `TechniciansService`/controller جديد (أو ملحق) لـ endpoints الدعوة/القبول/الرفض/الإزالة/القايمة.
- `apps/technician-app` — شاشة إدارة فريق مفضّل جديدة (§36.18، منفصلة عن UI فريق-لكل-طلب).
- `apps/admin` — رؤية/تحكم (§36.19).
- صفر تعديل على `order_team_members`/`technician_companies`/`assistant_link_status` الموجودين.
