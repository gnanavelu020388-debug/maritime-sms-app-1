-- ============================================================================
-- MARITIME SMS PLATFORM — CONSOLIDATED STANDALONE SCHEMA
-- ============================================================================
-- This is the complete database schema for the maritime multi-tenant SMS
-- platform, consolidated from 22 Supabase migrations into a single file
-- that runs on ANY standard PostgreSQL 14+ instance (Cloud Run, RDS,
-- Docker, VM, etc.).
--
-- IMPORTANT: This file uses standard Postgres features only:
--   - Tables, indexes, constraints
--   - Row Level Security (RLS) policies
--   - SECURITY DEFINER functions
--   - JSONB columns
--
-- The ONLY Supabase-specific parts are:
--   1. auth.users — Supabase's managed user table. See the AUTH section
--      below for how to replace it with your own users table.
--   2. auth.uid() — Supabase's helper that returns the current user's UUID.
--      Replaced with a custom function you control (see AUTH section).
--
-- Run this entire file in one go against a fresh Postgres database.
-- ============================================================================

-- ============================================================================
-- AUTH LAYER — Replace Supabase auth with your own
-- ============================================================================
-- In Supabase, `auth.users` is a managed table and `auth.uid()` returns the
-- current JWT-authenticated user's ID. On your own Postgres, you need:
--
-- 1. A `users` table (or use your auth provider's table)
-- 2. A function that returns the current user's ID from your session/JWT
--
-- Option A: If you use a JWT-based auth in your backend (e.g. Cloud Run
-- verifies the JWT and sets a session variable):
--
--   SET LOCAL request.jwt.claim.sub = '<user-uuid>';
--
-- Then this function reads it:

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  encrypted_password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- auth.uid() — returns the current user's UUID from the session JWT claim.
-- Your Cloud Run backend should SET LOCAL request.jwt.claim.sub = '<uuid>'
-- at the start of each request, or you can use a custom GUC.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- ============================================================================
-- TABLE 1: super_admins — Platform-level admin whitelist
-- ============================================================================
CREATE TABLE IF NOT EXISTS super_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  internal_role text NOT NULL DEFAULT 'super_admin'
    CHECK (internal_role IN ('super_admin','platform_auditor','global_support')),
  display_name text
);

ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 2: tenants — Shipping company accounts
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL,
  contact_email text NOT NULL,
  plan text NOT NULL DEFAULT 'Standard',
  status text NOT NULL DEFAULT 'provisioning',
  vessels_max int NOT NULL DEFAULT 5,
  seats_max int NOT NULL DEFAULT 25,
  storage_gb_max bigint NOT NULL DEFAULT 50,
  monthly_revenue numeric NOT NULL DEFAULT 0,
  region text NOT NULL DEFAULT 'EMEA',
  mfa_enforced bool NOT NULL DEFAULT true,
  modules text[] NOT NULL DEFAULT '{}',
  sms_version text NOT NULL DEFAULT '1.0.0',
  created_at timestamptz NOT NULL DEFAULT now(),
  contract_expires timestamptz NOT NULL DEFAULT (now() + interval '365 days'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 3: tenant_users — People within a tenant/company
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenant_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  auth_uid uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  employee_id text,
  passport_number text,
  seaman_book_number text,
  nationality text,
  rank text NOT NULL DEFAULT 'Crew',
  role text NOT NULL DEFAULT 'vessel',
  status text NOT NULL DEFAULT 'invited',
  fleet_scope text NOT NULL DEFAULT 'global',
  assigned_vessel_ids text[] NOT NULL DEFAULT '{}',
  assigned_fleet_profile_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 4: vessels — Ship profiles
-- ============================================================================
CREATE TABLE IF NOT EXISTS vessels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  imo_number text UNIQUE NOT NULL,
  call_sign text,
  flag_state text,
  port_of_registry text,
  gross_tonnage numeric,
  kw_power numeric,
  vessel_type text,
  class_society text,
  sms_active_version text NOT NULL DEFAULT '1.0.0',
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vessels ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 5: crew_assignments — Sign-on/sign-off history
-- ============================================================================
CREATE TABLE IF NOT EXISTS crew_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id uuid NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
  rank text NOT NULL,
  signed_on_at timestamptz NOT NULL DEFAULT now(),
  signed_off_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crew_assignments ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 6: sms_documents — The safety management document tree
-- ============================================================================
CREATE TABLE IF NOT EXISTS sms_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES sms_documents(id) ON DELETE CASCADE,
  tree_kind text NOT NULL,
  label text NOT NULL,
  node_kind text NOT NULL CHECK (node_kind IN ('folder','document')),
  content_kind text CHECK (content_kind IN ('rich_text','pdf')),
  content text,
  is_regulatory_header boolean NOT NULL DEFAULT false,
  approval_state text NOT NULL DEFAULT 'approved' CHECK (approval_state IN ('draft','pending_dpa','approved','rejected')),
  version text NOT NULL DEFAULT '1.0.0',
  sort_order int NOT NULL DEFAULT 0,
  profile_id uuid REFERENCES sms_profiles(id) ON DELETE SET NULL,
  author_name text,
  author_role text,
  author_origin text,
  rejection_comments text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sms_documents ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 7: audit_logs — Immutable append-only compliance ledger
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id uuid,
  actor_email text NOT NULL,
  category text NOT NULL,
  action text NOT NULL,
  target text,
  ip_address text,
  location text,
  severity text NOT NULL DEFAULT 'info',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 8: sms_delta_packages — Satellite delta sync patches
-- ============================================================================
CREATE TABLE IF NOT EXISTS sms_delta_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_version text NOT NULL,
  to_version text NOT NULL,
  delta_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  deployed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sms_delta_packages ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 9: sms_profiles — Fleet-wide SMS templates
-- ============================================================================
CREATE TABLE IF NOT EXISTS sms_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  version text NOT NULL DEFAULT '1.0.0',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE sms_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 10: sms_profile_vessels — Vessel-to-profile assignment (1:1)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sms_profile_vessels (
  profile_id uuid NOT NULL REFERENCES sms_profiles(id) ON DELETE CASCADE,
  vessel_id uuid NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  assigned_at timestamptz DEFAULT now(),
  PRIMARY KEY (profile_id, vessel_id)
);

ALTER TABLE sms_profile_vessels ENABLE ROW LEVEL SECURITY;

-- Unique index enforces 1 vessel = 1 profile (mutual exclusivity)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_profile_vessels_vessel_unique
  ON sms_profile_vessels(vessel_id);

-- ============================================================================
-- TABLE 11: tenant_feature_flags — Per-tenant module enablement
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenant_feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  custom_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, feature_key)
);

ALTER TABLE tenant_feature_flags ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 12: tenant_sync_config — Per-tenant auto-sync frequency
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenant_sync_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  auto_sync_interval_hours integer NOT NULL DEFAULT 6
    CHECK (auto_sync_interval_hours BETWEEN 1 AND 24),
  manual_replicate_enabled boolean NOT NULL DEFAULT true,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_sync_config ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 13: sms_document_versions — Document revision history
-- ============================================================================
CREATE TABLE IF NOT EXISTS sms_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES sms_documents(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  version_label text NOT NULL,
  content text,
  content_kind text DEFAULT 'rich_text',
  uploaded_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sms_document_versions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 14: vessel_sync_outbox — Unified bottom-up sync queue
-- ============================================================================
CREATE TABLE IF NOT EXISTS vessel_sync_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vessel_id uuid NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  operation text NOT NULL DEFAULT 'upsert',
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz
);

ALTER TABLE vessel_sync_outbox ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 15: vessel_sync_state — Per-vessel connectivity status
-- ============================================================================
CREATE TABLE IF NOT EXISTS vessel_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vessel_id uuid NOT NULL UNIQUE REFERENCES vessels(id) ON DELETE CASCADE,
  connection_mode text NOT NULL DEFAULT 'VESSEL_SERVER_LAN',
  server_reachable boolean NOT NULL DEFAULT false,
  last_heartbeat_at timestamptz,
  last_sync_at timestamptz,
  pending_outbox_count integer NOT NULL DEFAULT 0,
  failed_outbox_count integer NOT NULL DEFAULT 0,
  active_module_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_payloads_synced bigint NOT NULL DEFAULT 0,
  total_bytes_synced bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vessel_sync_state ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 16: module_definitions — Platform-wide module display names
-- ============================================================================
CREATE TABLE IF NOT EXISTS module_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE module_definitions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 17: user_session_tokens — Single concurrent login enforcement
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_session_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  session_token text NOT NULL,
  device_info text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_session_tokens ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 18: tenant_security_settings — Per-tenant security config
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenant_security_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  inactivity_timeout_minutes integer NOT NULL DEFAULT 15
    CHECK (inactivity_timeout_minutes >= 1 AND inactivity_timeout_minutes <= 480),
  enforce_single_session boolean NOT NULL DEFAULT true,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_security_settings ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 19: rank_permissions — Per-rank app permission matrix
-- ============================================================================
CREATE TABLE IF NOT EXISTS rank_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rank text NOT NULL,
  apps jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, rank)
);

ALTER TABLE rank_permissions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TABLE 20: tenant_rank_definitions — Custom rank labels per tenant
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenant_rank_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rank text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_custom boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, rank)
);

ALTER TABLE tenant_rank_definitions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- HELPER FUNCTIONS (SECURITY DEFINER — bypass RLS safely)
-- ============================================================================

-- is_super_admin() — true if the current user is in the super_admins table
CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM super_admins WHERE auth_uid = auth.uid());
$$;

-- auth_tenant_id() — returns the caller's tenant_id (bypasses RLS to avoid recursion)
CREATE OR REPLACE FUNCTION auth_tenant_id() RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT tenant_id FROM tenant_users WHERE auth_uid = auth.uid() LIMIT 1;
$$;

-- auth_tenant_role() — returns the caller's role within their tenant
CREATE OR REPLACE FUNCTION auth_tenant_role() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM tenant_users WHERE auth_uid = auth.uid() LIMIT 1;
$$;

-- my_internal_role() — returns the super_admin's internal role classification
CREATE OR REPLACE FUNCTION my_internal_role() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT internal_role FROM super_admins WHERE auth_uid = auth.uid();
$$;

-- is_tenant_archived() — checks if a tenant is archived (blocks login)
CREATE OR REPLACE FUNCTION is_tenant_archived(tenant_uuid uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM tenants WHERE id = tenant_uuid AND status = 'archived');
$$;

-- is_active_vessel_crew() — true if caller has an active crew assignment in a tenant
CREATE OR REPLACE FUNCTION is_active_vessel_crew(p_tenant_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT tu.id INTO v_user_id
  FROM tenant_users tu
  WHERE tu.auth_uid = auth.uid()
    AND tu.tenant_id = p_tenant_id
    AND tu.role = 'vessel';

  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM crew_assignments ca
    WHERE ca.user_id = v_user_id
      AND ca.tenant_id = p_tenant_id
      AND ca.signed_off_at IS NULL
  );
END;
$$;

-- claim_tenant_user() — links a new auth user to a pre-provisioned tenant_users row
CREATE OR REPLACE FUNCTION claim_tenant_user() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text;
  v_rows int;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL THEN
    RETURN false;
  END IF;

  UPDATE tenant_users
  SET auth_uid = auth.uid(), status = 'active', updated_at = now()
  WHERE email = lower(v_email) AND auth_uid IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- get_my_active_assignment() — returns the caller's active crew assignment
CREATE OR REPLACE FUNCTION get_my_active_assignment()
RETURNS TABLE (
  assignment_id uuid,
  vessel_id uuid,
  vessel_name text,
  tenant_id uuid,
  user_id uuid,
  rank text,
  signed_on_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT ca.id, ca.vessel_id, v.name, ca.tenant_id, ca.user_id, ca.rank, ca.signed_on_at
  FROM crew_assignments ca
  JOIN vessels v ON v.id = ca.vessel_id
  WHERE ca.signed_off_at IS NULL
    AND ca.user_id = (SELECT tu.id FROM tenant_users tu WHERE tu.auth_uid = auth.uid() LIMIT 1)
  LIMIT 1;
END;
$$;

-- update_tenant_security_setting() — Company Admin updates own tenant security
CREATE OR REPLACE FUNCTION update_tenant_security_setting(
  p_tenant_id uuid,
  p_inactivity_timeout_minutes integer,
  p_enforce_single_session boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_users
    WHERE auth_uid = auth.uid() AND tenant_id = p_tenant_id AND role = 'company_admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized: only Company Admins can update security settings';
  END IF;

  INSERT INTO tenant_security_settings (tenant_id, inactivity_timeout_minutes, enforce_single_session, updated_by, updated_at)
  VALUES (p_tenant_id, p_inactivity_timeout_minutes, p_enforce_single_session,
          (SELECT email FROM tenant_users WHERE auth_uid = auth.uid()), now())
  ON CONFLICT (tenant_id) DO UPDATE
  SET inactivity_timeout_minutes = EXCLUDED.inactivity_timeout_minutes,
      enforce_single_session = EXCLUDED.enforce_single_session,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();
  RETURN true;
END;
$$;

-- upsert_rank_permission() — Company Admin upserts a rank's permission profile
CREATE OR REPLACE FUNCTION upsert_rank_permission(
  p_tenant_id uuid,
  p_rank text,
  p_apps jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_users
    WHERE auth_uid = auth.uid() AND tenant_id = p_tenant_id AND role = 'company_admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized: only Company Admins can update rank permissions';
  END IF;

  INSERT INTO rank_permissions (tenant_id, rank, apps, updated_by, updated_at)
  VALUES (p_tenant_id, p_rank, p_apps,
          (SELECT email FROM tenant_users WHERE auth_uid = auth.uid()), now())
  ON CONFLICT (tenant_id, rank) DO UPDATE
  SET apps = EXCLUDED.apps, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN true;
END;
$$;

-- ============================================================================
-- RLS POLICIES — super_admins
-- ============================================================================
DROP POLICY IF EXISTS "super_admins_read_self" ON super_admins;
CREATE POLICY "super_admins_read_self" ON super_admins
  FOR SELECT TO authenticated
  USING (auth_uid = auth.uid());

DROP POLICY IF EXISTS "super_admins_insert" ON super_admins;
CREATE POLICY "super_admins_insert" ON super_admins
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR NOT EXISTS (SELECT 1 FROM super_admins));

-- ============================================================================
-- RLS POLICIES — tenants
-- ============================================================================
DROP POLICY IF EXISTS "tenants_sa_select" ON tenants;
CREATE POLICY "tenants_sa_select" ON tenants FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "tenants_sa_insert" ON tenants;
CREATE POLICY "tenants_sa_insert" ON tenants FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "tenants_sa_update" ON tenants;
CREATE POLICY "tenants_sa_update" ON tenants FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "tenants_sa_delete" ON tenants;
CREATE POLICY "tenants_sa_delete" ON tenants FOR DELETE TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "tenants_own_read" ON tenants;
CREATE POLICY "tenants_own_read" ON tenants
  FOR SELECT TO authenticated
  USING (NOT is_super_admin() AND tenants.id = auth_tenant_id());

-- ============================================================================
-- RLS POLICIES — tenant_users
-- ============================================================================
DROP POLICY IF EXISTS "tenant_users_sa_select" ON tenant_users;
CREATE POLICY "tenant_users_sa_select" ON tenant_users FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "tenant_users_sa_insert" ON tenant_users;
CREATE POLICY "tenant_users_sa_insert" ON tenant_users FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "tenant_users_sa_update" ON tenant_users;
CREATE POLICY "tenant_users_sa_update" ON tenant_users FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "tenant_users_sa_delete" ON tenant_users;
CREATE POLICY "tenant_users_sa_delete" ON tenant_users FOR DELETE TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "tenant_users_own_tenant_read" ON tenant_users;
CREATE POLICY "tenant_users_own_tenant_read" ON tenant_users
  FOR SELECT TO authenticated
  USING (NOT is_super_admin() AND tenant_id = auth_tenant_id());

DROP POLICY IF EXISTS "tenant_users_company_admin_manage" ON tenant_users;
CREATE POLICY "tenant_users_company_admin_manage" ON tenant_users
  FOR ALL TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() IN ('company_admin', 'dpa')
  )
  WITH CHECK (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() IN ('company_admin', 'dpa')
  );

DROP POLICY IF EXISTS "tenant_users_self_update" ON tenant_users;
CREATE POLICY "tenant_users_self_update" ON tenant_users
  FOR UPDATE TO authenticated
  USING (auth_uid = auth.uid())
  WITH CHECK (auth_uid = auth.uid());

DROP POLICY IF EXISTS "tenant_users_claim_by_email" ON tenant_users;
CREATE POLICY "tenant_users_claim_by_email" ON tenant_users
  FOR UPDATE TO authenticated
  USING (
    auth_uid IS NULL
    AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
  WITH CHECK (auth_uid = auth.uid());

-- ============================================================================
-- RLS POLICIES — vessels
-- ============================================================================
DROP POLICY IF EXISTS "vessels_sa_select" ON vessels;
CREATE POLICY "vessels_sa_select" ON vessels FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "vessels_sa_insert" ON vessels;
CREATE POLICY "vessels_sa_insert" ON vessels FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "vessels_sa_update" ON vessels;
CREATE POLICY "vessels_sa_update" ON vessels FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "vessels_sa_delete" ON vessels;
CREATE POLICY "vessels_sa_delete" ON vessels FOR DELETE TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "vessels_tenant_read" ON vessels;
CREATE POLICY "vessels_tenant_read" ON vessels
  FOR SELECT TO authenticated
  USING (NOT is_super_admin() AND tenant_id = auth_tenant_id());

DROP POLICY IF EXISTS "vessels_tenant_company_admin_write" ON vessels;
CREATE POLICY "vessels_tenant_company_admin_write" ON vessels
  FOR ALL TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() = 'company_admin'
  )
  WITH CHECK (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() = 'company_admin'
  );

-- ============================================================================
-- RLS POLICIES — crew_assignments
-- ============================================================================
DROP POLICY IF EXISTS "crew_sa_select" ON crew_assignments;
CREATE POLICY "crew_sa_select" ON crew_assignments FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "crew_sa_insert" ON crew_assignments;
CREATE POLICY "crew_sa_insert" ON crew_assignments FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "crew_sa_update" ON crew_assignments;
CREATE POLICY "crew_sa_update" ON crew_assignments FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "crew_sa_delete" ON crew_assignments;
CREATE POLICY "crew_sa_delete" ON crew_assignments FOR DELETE TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "ca_dpa_select_crew_assignments" ON crew_assignments;
CREATE POLICY "ca_dpa_select_crew_assignments" ON crew_assignments FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tenant_users tu
      WHERE tu.auth_uid = auth.uid() AND tu.tenant_id = crew_assignments.tenant_id
        AND tu.role IN ('company_admin', 'dpa'))
  );

DROP POLICY IF EXISTS "vessel_select_own_assignment" ON crew_assignments;
CREATE POLICY "vessel_select_own_assignment" ON crew_assignments FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tenant_users tu
      WHERE tu.auth_uid = auth.uid() AND tu.id = crew_assignments.user_id)
  );

DROP POLICY IF EXISTS "ca_dpa_insert_crew_assignments" ON crew_assignments;
CREATE POLICY "ca_dpa_insert_crew_assignments" ON crew_assignments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM tenant_users tu
      WHERE tu.auth_uid = auth.uid() AND tu.tenant_id = crew_assignments.tenant_id
        AND tu.role IN ('company_admin', 'dpa'))
  );

DROP POLICY IF EXISTS "ca_dpa_update_crew_assignments" ON crew_assignments;
CREATE POLICY "ca_dpa_update_crew_assignments" ON crew_assignments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tenant_users tu
      WHERE tu.auth_uid = auth.uid() AND tu.tenant_id = crew_assignments.tenant_id
        AND tu.role IN ('company_admin', 'dpa'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM tenant_users tu
      WHERE tu.auth_uid = auth.uid() AND tu.tenant_id = crew_assignments.tenant_id
        AND tu.role IN ('company_admin', 'dpa'))
  );

-- ============================================================================
-- RLS POLICIES — sms_documents
-- ============================================================================
DROP POLICY IF EXISTS "sms_docs_sa_select" ON sms_documents;
CREATE POLICY "sms_docs_sa_select" ON sms_documents FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "sms_docs_sa_insert" ON sms_documents;
CREATE POLICY "sms_docs_sa_insert" ON sms_documents FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sms_docs_sa_update" ON sms_documents;
CREATE POLICY "sms_docs_sa_update" ON sms_documents FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sms_docs_sa_delete" ON sms_documents;
CREATE POLICY "sms_docs_sa_delete" ON sms_documents FOR DELETE TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "ca_dpa_select_sms_documents" ON sms_documents;
CREATE POLICY "ca_dpa_select_sms_documents" ON sms_documents FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tenant_users tu
      WHERE tu.auth_uid = auth.uid() AND tu.tenant_id = sms_documents.tenant_id
        AND tu.role IN ('company_admin', 'dpa'))
  );

DROP POLICY IF EXISTS "vessel_select_sms_documents" ON sms_documents;
CREATE POLICY "vessel_select_sms_documents" ON sms_documents FOR SELECT
  TO authenticated
  USING (approval_state = 'approved' AND is_active_vessel_crew(tenant_id));

DROP POLICY IF EXISTS "ca_dpa_insert_sms_documents" ON sms_documents;
CREATE POLICY "ca_dpa_insert_sms_documents" ON sms_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() IN ('company_admin', 'dpa')
  );

DROP POLICY IF EXISTS "ca_dpa_update_sms_documents" ON sms_documents;
CREATE POLICY "ca_dpa_update_sms_documents" ON sms_documents FOR UPDATE
  TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() IN ('company_admin', 'dpa')
  )
  WITH CHECK (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() IN ('company_admin', 'dpa')
  );

DROP POLICY IF EXISTS "ca_dpa_delete_sms_documents" ON sms_documents;
CREATE POLICY "ca_dpa_delete_sms_documents" ON sms_documents FOR DELETE
  TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() IN ('company_admin', 'dpa')
  );

-- ============================================================================
-- RLS POLICIES — audit_logs (append-only, no UPDATE/DELETE)
-- ============================================================================
DROP POLICY IF EXISTS "audit_insert_any" ON audit_logs;
CREATE POLICY "audit_insert_any" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "audit_super_admin_read_all" ON audit_logs;
CREATE POLICY "audit_super_admin_read_all" ON audit_logs
  FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "audit_tenant_read_own" ON audit_logs;
CREATE POLICY "audit_tenant_read_own" ON audit_logs
  FOR SELECT TO authenticated
  USING (NOT is_super_admin() AND tenant_id = auth_tenant_id());

-- ============================================================================
-- RLS POLICIES — sms_delta_packages
-- ============================================================================
DROP POLICY IF EXISTS "sms_delta_sa_select" ON sms_delta_packages;
CREATE POLICY "sms_delta_sa_select" ON sms_delta_packages FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "sms_delta_sa_insert" ON sms_delta_packages;
CREATE POLICY "sms_delta_sa_insert" ON sms_delta_packages FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sms_delta_sa_update" ON sms_delta_packages;
CREATE POLICY "sms_delta_sa_update" ON sms_delta_packages FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sms_delta_sa_delete" ON sms_delta_packages;
CREATE POLICY "sms_delta_sa_delete" ON sms_delta_packages FOR DELETE TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "sms_delta_tenant_read" ON sms_delta_packages;
CREATE POLICY "sms_delta_tenant_read" ON sms_delta_packages
  FOR SELECT TO authenticated
  USING (NOT is_super_admin() AND tenant_id = auth_tenant_id());

DROP POLICY IF EXISTS "sms_delta_tenant_admin_write" ON sms_delta_packages;
CREATE POLICY "sms_delta_tenant_admin_write" ON sms_delta_packages
  FOR ALL TO authenticated
  USING (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() IN ('company_admin', 'dpa')
  )
  WITH CHECK (
    NOT is_super_admin()
    AND tenant_id = auth_tenant_id()
    AND auth_tenant_role() IN ('company_admin', 'dpa')
  );

-- ============================================================================
-- RLS POLICIES — sms_profiles
-- ============================================================================
DROP POLICY IF EXISTS "select_own_sms_profiles" ON sms_profiles;
CREATE POLICY "select_own_sms_profiles" ON sms_profiles
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
    AND tenant_id = sms_profiles.tenant_id)
    OR is_super_admin());

DROP POLICY IF EXISTS "insert_own_sms_profiles" ON sms_profiles;
CREATE POLICY "insert_own_sms_profiles" ON sms_profiles
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
    AND tenant_id = sms_profiles.tenant_id));

DROP POLICY IF EXISTS "update_own_sms_profiles" ON sms_profiles;
CREATE POLICY "update_own_sms_profiles" ON sms_profiles
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
    AND tenant_id = sms_profiles.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
    AND tenant_id = sms_profiles.tenant_id));

DROP POLICY IF EXISTS "delete_own_sms_profiles" ON sms_profiles;
CREATE POLICY "delete_own_sms_profiles" ON sms_profiles
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
    AND tenant_id = sms_profiles.tenant_id));

-- ============================================================================
-- RLS POLICIES — sms_profile_vessels
-- ============================================================================
DROP POLICY IF EXISTS "select_own_profile_vessels" ON sms_profile_vessels;
CREATE POLICY "select_own_profile_vessels" ON sms_profile_vessels
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM sms_profiles WHERE id = profile_id AND EXISTS (
      SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
        AND tenant_id = sms_profiles.tenant_id
    )) OR is_super_admin()
  );

DROP POLICY IF EXISTS "insert_own_profile_vessels" ON sms_profile_vessels;
CREATE POLICY "insert_own_profile_vessels" ON sms_profile_vessels
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM sms_profiles WHERE id = profile_id AND EXISTS (
      SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
        AND tenant_id = sms_profiles.tenant_id
    ))
  );

DROP POLICY IF EXISTS "delete_own_profile_vessels" ON sms_profile_vessels;
CREATE POLICY "delete_own_profile_vessels" ON sms_profile_vessels
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM sms_profiles WHERE id = profile_id AND EXISTS (
      SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
        AND tenant_id = sms_profiles.tenant_id
    ))
  );

-- ============================================================================
-- RLS POLICIES — tenant_feature_flags
-- ============================================================================
DROP POLICY IF EXISTS "sa_select_all_feature_flags" ON tenant_feature_flags;
CREATE POLICY "sa_select_all_feature_flags" ON tenant_feature_flags
  FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "sa_insert_all_feature_flags" ON tenant_feature_flags;
CREATE POLICY "sa_insert_all_feature_flags" ON tenant_feature_flags
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sa_update_all_feature_flags" ON tenant_feature_flags;
CREATE POLICY "sa_update_all_feature_flags" ON tenant_feature_flags
  FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sa_delete_all_feature_flags" ON tenant_feature_flags;
CREATE POLICY "sa_delete_all_feature_flags" ON tenant_feature_flags
  FOR DELETE TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "tenant_select_own_feature_flags" ON tenant_feature_flags;
CREATE POLICY "tenant_select_own_feature_flags" ON tenant_feature_flags
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
      AND tenant_id = tenant_feature_flags.tenant_id)
  );

-- ============================================================================
-- RLS POLICIES — tenant_sync_config
-- ============================================================================
DROP POLICY IF EXISTS "sa_select_all_sync_config" ON tenant_sync_config;
CREATE POLICY "sa_select_all_sync_config" ON tenant_sync_config
  FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "sa_insert_all_sync_config" ON tenant_sync_config;
CREATE POLICY "sa_insert_all_sync_config" ON tenant_sync_config
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sa_update_all_sync_config" ON tenant_sync_config;
CREATE POLICY "sa_update_all_sync_config" ON tenant_sync_config
  FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "tenant_select_own_sync_config" ON tenant_sync_config;
CREATE POLICY "tenant_select_own_sync_config" ON tenant_sync_config
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
      AND tenant_id = tenant_sync_config.tenant_id)
  );

-- ============================================================================
-- RLS POLICIES — sms_document_versions
-- ============================================================================
DROP POLICY IF EXISTS "sa_select_all_doc_versions" ON sms_document_versions;
CREATE POLICY "sa_select_all_doc_versions" ON sms_document_versions
  FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "sa_insert_all_doc_versions" ON sms_document_versions;
CREATE POLICY "sa_insert_all_doc_versions" ON sms_document_versions
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "tenant_select_own_doc_versions" ON sms_document_versions;
CREATE POLICY "tenant_select_own_doc_versions" ON sms_document_versions
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
      AND tenant_id = sms_document_versions.tenant_id)
  );

DROP POLICY IF EXISTS "tenant_insert_own_doc_versions" ON sms_document_versions;
CREATE POLICY "tenant_insert_own_doc_versions" ON sms_document_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT is_super_admin()
    AND EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
      AND tenant_id = sms_document_versions.tenant_id)
  );

-- ============================================================================
-- RLS POLICIES — vessel_sync_outbox
-- ============================================================================
DROP POLICY IF EXISTS "sa_select_all_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "sa_select_all_sync_outbox" ON vessel_sync_outbox
  FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "sa_insert_all_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "sa_insert_all_sync_outbox" ON vessel_sync_outbox
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sa_update_all_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "sa_update_all_sync_outbox" ON vessel_sync_outbox
  FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sa_delete_all_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "sa_delete_all_sync_outbox" ON vessel_sync_outbox
  FOR DELETE TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "tenant_select_own_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "tenant_select_own_sync_outbox" ON vessel_sync_outbox
  FOR SELECT TO authenticated
  USING (NOT is_super_admin() AND tenant_id = auth_tenant_id());

DROP POLICY IF EXISTS "tenant_insert_own_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "tenant_insert_own_sync_outbox" ON vessel_sync_outbox
  FOR INSERT TO authenticated
  WITH CHECK (NOT is_super_admin() AND tenant_id = auth_tenant_id());

DROP POLICY IF EXISTS "tenant_update_own_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "tenant_update_own_sync_outbox" ON vessel_sync_outbox
  FOR UPDATE TO authenticated
  USING (NOT is_super_admin() AND tenant_id = auth_tenant_id())
  WITH CHECK (NOT is_super_admin() AND tenant_id = auth_tenant_id());

DROP POLICY IF EXISTS "tenant_delete_own_sync_outbox" ON vessel_sync_outbox;
CREATE POLICY "tenant_delete_own_sync_outbox" ON vessel_sync_outbox
  FOR DELETE TO authenticated
  USING (NOT is_super_admin() AND tenant_id = auth_tenant_id());

-- ============================================================================
-- RLS POLICIES — vessel_sync_state
-- ============================================================================
DROP POLICY IF EXISTS "sa_select_all_sync_state" ON vessel_sync_state;
CREATE POLICY "sa_select_all_sync_state" ON vessel_sync_state
  FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "sa_insert_all_sync_state" ON vessel_sync_state;
CREATE POLICY "sa_insert_all_sync_state" ON vessel_sync_state
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sa_update_all_sync_state" ON vessel_sync_state;
CREATE POLICY "sa_update_all_sync_state" ON vessel_sync_state
  FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sa_delete_all_sync_state" ON vessel_sync_state;
CREATE POLICY "sa_delete_all_sync_state" ON vessel_sync_state
  FOR DELETE TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "tenant_select_own_sync_state" ON vessel_sync_state;
CREATE POLICY "tenant_select_own_sync_state" ON vessel_sync_state
  FOR SELECT TO authenticated
  USING (NOT is_super_admin() AND tenant_id = auth_tenant_id());

DROP POLICY IF EXISTS "tenant_insert_own_sync_state" ON vessel_sync_state;
CREATE POLICY "tenant_insert_own_sync_state" ON vessel_sync_state
  FOR INSERT TO authenticated
  WITH CHECK (NOT is_super_admin() AND tenant_id = auth_tenant_id());

DROP POLICY IF EXISTS "tenant_update_own_sync_state" ON vessel_sync_state;
CREATE POLICY "tenant_update_own_sync_state" ON vessel_sync_state
  FOR UPDATE TO authenticated
  USING (NOT is_super_admin() AND tenant_id = auth_tenant_id())
  WITH CHECK (NOT is_super_admin() AND tenant_id = auth_tenant_id());

-- ============================================================================
-- RLS POLICIES — module_definitions
-- ============================================================================
DROP POLICY IF EXISTS "sa_select_all_module_defs" ON module_definitions;
CREATE POLICY "sa_select_all_module_defs" ON module_definitions
  FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "sa_insert_all_module_defs" ON module_definitions;
CREATE POLICY "sa_insert_all_module_defs" ON module_definitions
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sa_update_all_module_defs" ON module_definitions;
CREATE POLICY "sa_update_all_module_defs" ON module_definitions
  FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sa_delete_all_module_defs" ON module_definitions;
CREATE POLICY "sa_delete_all_module_defs" ON module_definitions
  FOR DELETE TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "tenant_select_module_defs" ON module_definitions;
CREATE POLICY "tenant_select_module_defs" ON module_definitions
  FOR SELECT TO authenticated
  USING (NOT is_super_admin());

-- ============================================================================
-- RLS POLICIES — user_session_tokens
-- ============================================================================
DROP POLICY IF EXISTS "select_own_session_token" ON user_session_tokens;
CREATE POLICY "select_own_session_token" ON user_session_tokens
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_session_token" ON user_session_tokens;
CREATE POLICY "insert_own_session_token" ON user_session_tokens
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_session_token" ON user_session_tokens;
CREATE POLICY "update_own_session_token" ON user_session_tokens
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "sa_select_all_session_tokens" ON user_session_tokens;
CREATE POLICY "sa_select_all_session_tokens" ON user_session_tokens
  FOR SELECT TO authenticated
  USING (is_super_admin());

-- ============================================================================
-- RLS POLICIES — tenant_security_settings
-- ============================================================================
DROP POLICY IF EXISTS "sa_select_all_tenant_security" ON tenant_security_settings;
CREATE POLICY "sa_select_all_tenant_security" ON tenant_security_settings
  FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "sa_insert_all_tenant_security" ON tenant_security_settings;
CREATE POLICY "sa_insert_all_tenant_security" ON tenant_security_settings
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sa_update_all_tenant_security" ON tenant_security_settings;
CREATE POLICY "sa_update_all_tenant_security" ON tenant_security_settings
  FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "tenant_select_own_security" ON tenant_security_settings;
CREATE POLICY "tenant_select_own_security" ON tenant_security_settings
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
      AND tenant_id = tenant_security_settings.tenant_id)
  );

-- ============================================================================
-- RLS POLICIES — rank_permissions
-- ============================================================================
DROP POLICY IF EXISTS "sa_select_rank_permissions" ON rank_permissions;
CREATE POLICY "sa_select_rank_permissions" ON rank_permissions
  FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "sa_insert_rank_permissions" ON rank_permissions;
CREATE POLICY "sa_insert_rank_permissions" ON rank_permissions
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sa_update_rank_permissions" ON rank_permissions;
CREATE POLICY "sa_update_rank_permissions" ON rank_permissions
  FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sa_delete_rank_permissions" ON rank_permissions;
CREATE POLICY "sa_delete_rank_permissions" ON rank_permissions
  FOR DELETE TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "ca_select_rank_permissions" ON rank_permissions;
CREATE POLICY "ca_select_rank_permissions" ON rank_permissions
  FOR SELECT TO authenticated
  USING (
    NOT is_super_admin()
    AND EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
      AND tenant_id = rank_permissions.tenant_id)
  );

DROP POLICY IF EXISTS "ca_update_rank_permissions" ON rank_permissions;
CREATE POLICY "ca_update_rank_permissions" ON rank_permissions
  FOR UPDATE TO authenticated
  USING (
    NOT is_super_admin()
    AND EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
      AND tenant_id = rank_permissions.tenant_id AND role = 'company_admin')
  )
  WITH CHECK (
    NOT is_super_admin()
    AND EXISTS (SELECT 1 FROM tenant_users WHERE auth_uid = auth.uid()
      AND tenant_id = rank_permissions.tenant_id AND role = 'company_admin')
  );

-- ============================================================================
-- RLS POLICIES — tenant_rank_definitions
-- ============================================================================
DROP POLICY IF EXISTS "select_own_rank_defs" ON tenant_rank_definitions;
CREATE POLICY "select_own_rank_defs" ON tenant_rank_definitions FOR SELECT
  TO authenticated USING (auth.uid() IN (
    SELECT tu.auth_uid FROM tenant_users tu WHERE tu.tenant_id = tenant_rank_definitions.tenant_id
  ));

DROP POLICY IF EXISTS "insert_own_rank_defs" ON tenant_rank_definitions;
CREATE POLICY "insert_own_rank_defs" ON tenant_rank_definitions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IN (
    SELECT tu.auth_uid FROM tenant_users tu WHERE tu.tenant_id = tenant_rank_definitions.tenant_id
  ));

DROP POLICY IF EXISTS "update_own_rank_defs" ON tenant_rank_definitions;
CREATE POLICY "update_own_rank_defs" ON tenant_rank_definitions FOR UPDATE
  TO authenticated USING (auth.uid() IN (
    SELECT tu.auth_uid FROM tenant_users tu WHERE tu.tenant_id = tenant_rank_definitions.tenant_id
  )) WITH CHECK (auth.uid() IN (
    SELECT tu.auth_uid FROM tenant_users tu WHERE tu.tenant_id = tenant_rank_definitions.tenant_id
  ));

DROP POLICY IF EXISTS "delete_own_rank_defs" ON tenant_rank_definitions;
CREATE POLICY "delete_own_rank_defs" ON tenant_rank_definitions FOR DELETE
  TO authenticated USING (auth.uid() IN (
    SELECT tu.auth_uid FROM tenant_users tu WHERE tu.tenant_id = tenant_rank_definitions.tenant_id
  ));

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_tenant_users_auth_uid ON tenant_users(auth_uid);
CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_id ON tenant_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vessels_tenant_id ON vessels(tenant_id);
CREATE INDEX IF NOT EXISTS idx_crew_vessel_id ON crew_assignments(vessel_id);
CREATE INDEX IF NOT EXISTS idx_sms_docs_tenant_tree ON sms_documents(tenant_id, tree_kind);
CREATE INDEX IF NOT EXISTS idx_sms_docs_parent ON sms_documents(parent_id);
CREATE INDEX IF NOT EXISTS idx_sms_documents_profile ON sms_documents(tenant_id, profile_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_delta_tenant ON sms_delta_packages(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_delta_to_version ON sms_delta_packages(tenant_id, to_version);
CREATE INDEX IF NOT EXISTS idx_sms_profiles_tenant ON sms_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sms_profile_vessels_vessel ON sms_profile_vessels(vessel_id);
CREATE INDEX IF NOT EXISTS idx_sms_profile_vessels_profile ON sms_profile_vessels(profile_id);
CREATE INDEX IF NOT EXISTS idx_sms_doc_versions_document ON sms_document_versions(tenant_id, document_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_vessel_sync_outbox_tenant_vessel ON vessel_sync_outbox(tenant_id, vessel_id, status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_vessel_sync_outbox_module ON vessel_sync_outbox(tenant_id, module_key, status);
CREATE INDEX IF NOT EXISTS idx_vessel_sync_outbox_status ON vessel_sync_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_vessel_sync_state_tenant ON vessel_sync_state(tenant_id, vessel_id);
CREATE INDEX IF NOT EXISTS idx_tenant_rank_defs_tenant ON tenant_rank_definitions(tenant_id);

-- ============================================================================
-- SEED DATA — Module definitions
-- ============================================================================
INSERT INTO module_definitions (feature_key, display_name, description, sort_order)
SELECT * FROM (VALUES
  ('sms_documentation', 'SMS Documentation', 'Safety Management System manuals, procedures, and policies', 1),
  ('rest_hours', 'Rest Hours Engine', 'MLC-compliant rest hour tracking and fatigue management', 2),
  ('haccp_galley', 'HACCP / Galley', 'Food safety, galley inspections, and HACCP compliance', 3),
  ('certification_manager', 'Certification Manager', 'Crew certification, vessel certificates, and expiry tracking', 4),
  ('satellite_sync', 'Satellite Sync', 'Priority satellite data synchronization and queue management', 5),
  ('voyage_logging', 'Voyage Logging', 'Voyage data recording and port arrival/departure logs', 6),
  ('crew_matrix', 'Crew Matrix', 'Crew competency matrices and familiarization tracking', 7),
  ('electronic_logbooks', 'Electronic Logbooks', 'Digital oil record, garbage, and cargo logbooks', 8),
  ('advanced_analytics', 'Advanced Analytics', 'Fleet performance analytics and trend dashboards', 9),
  ('risk_assessment', 'Risk Assessment', 'Operational risk assessments and mitigation tracking', 10)
) AS v(feature_key, display_name, description, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM module_definitions m WHERE m.feature_key = v.feature_key
);

-- ============================================================================
-- SEED DATA — Default rank permissions for existing tenants
-- ============================================================================
-- Run this AFTER you insert your first tenant to seed rank permissions:
-- INSERT INTO rank_permissions (tenant_id, rank, apps)
-- SELECT t.id, r.rank, r.apps
-- FROM tenants t
-- CROSS JOIN (VALUES
--   ('Master',          '{"galley":{"visible":true,"actions":{"view_inventory":true,"log_daily_meals":true,"draft_requisitions":true,"approve_food_orders":true,"manage_stores":true}},"rest_hours":{"visible":true,"actions":{"view_own":true,"log_own":true,"view_others":true,"edit_others":true,"approve_others":true}},"sms":{"visible":true,"actions":{"view":true,"search":true,"print":true,"edit":true,"upload":true,"approve":true}},"hscq":{"visible":true,"actions":{"view":true,"edit":true,"approve":true,"close":true}},"certificates":{"visible":true,"actions":{"view":true,"add":true,"edit":true,"revoke":true,"verify":true}}}'::jsonb),
--   ('Chief Engineer',  '{"galley":{"visible":true,"actions":{"view_inventory":true,"log_daily_meals":false,"draft_requisitions":false,"approve_food_orders":false,"manage_stores":false}},"rest_hours":{"visible":true,"actions":{"view_own":true,"log_own":true,"view_others":true,"edit_others":true,"approve_others":false}},"sms":{"visible":true,"actions":{"view":true,"search":true,"print":true,"edit":false,"upload":false,"approve":false}},"hscq":{"visible":true,"actions":{"view":true,"edit":true,"approve":false,"close":false}},"certificates":{"visible":true,"actions":{"view":true,"add":false,"edit":false,"revoke":false,"verify":false}}}'::jsonb),
--   ('Crew',            '{"galley":{"visible":false,"actions":{"view_inventory":false,"log_daily_meals":false,"draft_requisitions":false,"approve_food_orders":false,"manage_stores":false}},"rest_hours":{"visible":true,"actions":{"view_own":true,"log_own":true,"view_others":false,"edit_others":false,"approve_others":false}},"sms":{"visible":false,"actions":{"view":false,"search":false,"print":false,"edit":false,"upload":false,"approve":false}},"hscq":{"visible":false,"actions":{"view":false,"edit":false,"approve":false,"close":false}},"certificates":{"visible":false,"actions":{"view":false,"add":false,"edit":false,"revoke":false,"verify":false}}}'::jsonb)
-- ) AS r(rank, apps)
-- WHERE NOT EXISTS (
--   SELECT 1 FROM rank_permissions rp WHERE rp.tenant_id = t.id AND rp.rank = r.rank
-- );

-- ============================================================================
-- DONE — Your database schema is ready.
-- ============================================================================
