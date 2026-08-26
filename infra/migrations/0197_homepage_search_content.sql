-- baytak - 0197: admin-managed customer homepage search copy.
-- One JSON value keeps mobile/web wording in sync and preserves the previous copy as defaults.

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  (
    'homepage.search_content',
    '{"eyebrow":"أساعدك إزاي؟","title":"محتاج مساعدة في إيه؟","description":"قول لينا مشكلتك بكلامك العادي، أو تصفّح الفئات تحت","placeholder":"وصّف مشكلتك... زي \"المياه بتنزل من تحت الحوض\""}',
    'json',
    'homepage',
    'Customer homepage search eyebrow, title, description, and input placeholder shared by web and mobile',
    true
  );
