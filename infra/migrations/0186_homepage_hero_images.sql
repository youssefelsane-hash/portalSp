-- baytak - 0186: admin-managed rotating homepage hero images.
-- Empty keeps the existing branding splash/gradient fallback fully backward compatible.

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  (
    'homepage.hero_images',
    '[]',
    'json',
    'homepage',
    'Ordered homepage hero image URLs (up to 4) shared by customer web and mobile',
    true
  );
