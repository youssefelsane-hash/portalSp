-- baytak — 0104: صلاحية تصحيح محفظة يدوي (docs/08 §20 بند 5) — كانت فجوة حقيقية: AdminWalletController
-- قراءة بس (GET)، صفر مسار لأدمن/مالية يصحّح رصيد فني (مثلاً تحصيل كاش اتسجّل غلط، الفني قال حصّل
-- 1000 والصح 900). المطلوب صراحة: التصحيحات لازم تفضل قابلة للتتبع (append-only، مش مسح وإعادة
-- كتابة) وتحتاج صلاحية أدمن/مالية مخصوصة + سجل تدقيق — نفس مبدأ 0099 بالحرف (default-deny، finance بس).

INSERT INTO permissions (name, resource, action) VALUES
  ('wallets.adjust', 'wallets', 'adjust');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'wallets.adjust'
WHERE r.name = 'finance';
