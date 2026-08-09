-- baytak — 0047: معرض أعمال الفني عبر لينكات السوشيال ميديا (تيك توك/يوتيوب/انستجرام/فيسبوك)
-- بدل رفع وتخزين فيديوهات (تكلفة مساحة عالية)، الفني بيحط لينك لفيديو موجود بالفعل على حسابه،
-- والفيديو يتشغل مضمّن (embed) جوّه بروفايله في التطبيق. تخزين شبه صفر (نص بس)، وتسويق عضوي
-- مجاني (كل فيديو بيوصل لمتابعين الفني نفسه).
CREATE TYPE portfolio_link_platform AS ENUM ('tiktok', 'youtube', 'instagram', 'facebook');

CREATE TABLE technician_portfolio_links (
  id             UUID                       PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id  UUID                       NOT NULL REFERENCES technician_profiles(id),
  platform       portfolio_link_platform    NOT NULL,
  url            TEXT                       NOT NULL,
  title          VARCHAR(200)               NULL,
  -- بيتجاب تلقائي عن طريق oEmbed API بتاع المنصة وقت الإضافة — NULL لو الجلب فشل (رابط غلط،
  -- أو المنصة (انستجرام/فيسبوك) محتاجة مفتاح Graph API لسه مش متحط — راجع
  -- docs/03-external-integrations.md. مش بيمنع حفظ اللينك نفسه، مجرد معاينة ناقصة.
  thumbnail_url  TEXT                       NULL,
  display_order  SMALLINT                   NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ                NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ                NOT NULL DEFAULT now()
);
CREATE INDEX idx_technician_portfolio_links_technician_id ON technician_portfolio_links(technician_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_portfolio_links
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
