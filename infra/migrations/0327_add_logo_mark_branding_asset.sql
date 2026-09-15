-- ADR-0092: restore the compact logo mark only now that it has a real consumer
-- in the admin shell. The other retired branding slots remain intentionally absent.
ALTER TYPE branding_asset_type ADD VALUE IF NOT EXISTS 'logo_mark';
