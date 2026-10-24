-- PostgreSQL schema. Timestamps are timestamptz (returned to the app as ISO-8601 UTC strings).
CREATE TABLE admin_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','staff')),
  active SMALLINT NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  flash TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE categories (
  id BIGSERIAL PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('laundry','cyber','food')),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_published SMALLINT NOT NULL DEFAULT 1 CHECK (is_published IN (0,1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (section, slug)
);

-- One table for laundry services, cyber cafe services and (optional) food menu items.
-- Prices are integer minor units (cents of a shilling): no floating point.
CREATE TABLE items (
  id BIGSERIAL PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('laundry','cyber','food')),
  category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  pricing_type TEXT NOT NULL DEFAULT 'fixed' CHECK (pricing_type IN ('fixed','quote')),
  price_minor INTEGER CHECK (price_minor IS NULL OR (price_minor >= 0 AND price_minor <= 100000000)),
  currency TEXT NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  pricing_unit TEXT NOT NULL DEFAULT '',
  conditions TEXT NOT NULL DEFAULT '',
  image_path TEXT,
  image_alt TEXT NOT NULL DEFAULT '',
  availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available','unavailable')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  featured SMALLINT NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  UNIQUE (section, slug),
  CHECK (status = 'draft' OR pricing_type = 'quote' OR price_minor IS NOT NULL),
  CHECK (pricing_type = 'fixed' OR price_minor IS NULL)
);
CREATE INDEX idx_items_public ON items(section, status, category_id);

CREATE FUNCTION items_check_section() RETURNS trigger AS $$
BEGIN
  IF (SELECT section FROM categories WHERE id = NEW.category_id) IS DISTINCT FROM NEW.section THEN
    RAISE EXCEPTION 'category does not belong to item section';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER items_section_check BEFORE INSERT OR UPDATE OF section, category_id ON items
  FOR EACH ROW EXECUTE FUNCTION items_check_section();

-- Uploaded images live in the database because the web host has no persistent disk.
CREATE TABLE images (
  name TEXT PRIMARY KEY,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  data BYTEA NOT NULL CHECK (octet_length(data) <= 2097152),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE TABLE enquiries (
  id BIGSERIAL PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_method TEXT NOT NULL CHECK (contact_method IN ('phone','email','whatsapp')),
  contact_value TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('laundry','cyber','food','other')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','resolved','archived')),
  internal_notes TEXT NOT NULL DEFAULT '',
  dedupe_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_enquiries_status ON enquiries(status, created_at);
CREATE INDEX idx_enquiries_dedupe ON enquiries(dedupe_hash, created_at);

CREATE TABLE audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_events(created_at);
