-- ════════════════════════════════════════════════════════════════════
-- Maritime Safety Management Platform — MySQL Schema
-- For Google Cloud SQL (MySQL 8.0)
-- Converted from the original PostgreSQL/Supabase schema.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS super_admins (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(36) PRIMARY KEY,
  -- Short sequential number for display purposes only (e.g. T-0007) — id
  -- above (the UUID) remains the real primary key used everywhere else
  tenant_no INT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
  company VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  plan VARCHAR(50) NOT NULL DEFAULT 'Standard',
  status VARCHAR(50) NOT NULL DEFAULT 'provisioning',
  vessels_max INT NOT NULL DEFAULT 5,
  seats_max INT NOT NULL DEFAULT 25,
  storage_gb_max DECIMAL(12,6) NOT NULL DEFAULT 50,
  monthly_revenue DECIMAL(10,2) NOT NULL DEFAULT 0,
  region VARCHAR(50) NOT NULL DEFAULT 'EMEA',
  mfa_enforced BOOLEAN NOT NULL DEFAULT TRUE,
  modules JSON NOT NULL,
  sms_version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  contract_expires TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Widen storage_gb_max from BIGINT to DECIMAL so quotas can express
-- sub-GB values (e.g. MB-scale demo quotas) — no-op on fresh installs
-- (already DECIMAL above), upgrades existing databases in place.
ALTER TABLE tenants MODIFY COLUMN storage_gb_max DECIMAL(12,6) NOT NULL DEFAULT 50;

-- Cached GCS storage usage per tenant, refreshed by Cloud Scheduler hitting
-- POST /api/internal/storage/refresh (server/jobs/refreshStorageUsage.js) and
-- incrementally after each upload/delete — avoids listing the bucket on
-- every /tenants request.
CREATE TABLE IF NOT EXISTS tenant_storage_cache (
  tenant_id VARCHAR(36) PRIMARY KEY,
  bytes_used BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Single-row cache of platform-wide GCS usage (sum across all tenants/
-- prefixes), refreshed alongside tenant_storage_cache.
CREATE TABLE IF NOT EXISTS platform_storage_cache (
  id TINYINT PRIMARY KEY DEFAULT 1,
  bytes_used BIGINT NOT NULL DEFAULT 0,
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Simple key/value store for platform-wide configuration, e.g. the
-- application-level storage pool (GCS has no fixed "total capacity" to read
-- from the GCP API, so this is a business-configured allocation).
CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Single-row cache of this instance's live process metrics (CPU% from
-- process.cpuUsage() deltas, API p95 response time from an in-process
-- request-timing ring buffer — see server/metrics.js), refreshed whenever
-- GET /api/platform/health is polled.
CREATE TABLE IF NOT EXISTS platform_metrics_cache (
  id TINYINT PRIMARY KEY DEFAULT 1,
  cpu_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  api_p95_ms INT NOT NULL DEFAULT 0,
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Append-only history of the same readings as platform_metrics_cache, one
-- row per GET /api/platform/health poll — lets the dashboard's date-range
-- filter (24h/7d/30d, see GET /api/platform/metrics/history) show real
-- range-scoped averages/deltas instead of only the latest snapshot.
CREATE TABLE IF NOT EXISTS platform_metrics_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  cpu_percent DECIMAL(5,2) NOT NULL,
  api_p95_ms INT NOT NULL,
  storage_bytes_used BIGINT NOT NULL,
  captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_platform_metrics_history_captured_at (captured_at)
);

CREATE TABLE IF NOT EXISTS tenant_users (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  employee_id VARCHAR(100),
  passport_number VARCHAR(100),
  seaman_book_number VARCHAR(100),
  nationality VARCHAR(100),
  `rank` VARCHAR(100) NOT NULL DEFAULT 'Crew',
  `role` VARCHAR(50) NOT NULL DEFAULT 'vessel',
  status VARCHAR(50) NOT NULL DEFAULT 'invited',
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  fleet_scope VARCHAR(20) NOT NULL DEFAULT 'global',
  assigned_vessel_ids JSON NOT NULL,
  assigned_fleet_profile_ids JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_tenant_users_tenant (tenant_id),
  INDEX idx_tenant_users_email (email)
);

CREATE TABLE IF NOT EXISTS vessels (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  imo_number VARCHAR(20) NOT NULL UNIQUE,
  call_sign VARCHAR(20),
  flag_state VARCHAR(100),
  port_of_registry VARCHAR(100),
  gross_tonnage DECIMAL(12,2),
  kw_power DECIMAL(12,2),
  vessel_type VARCHAR(100),
  class_society VARCHAR(100),
  satellite_provider VARCHAR(100),
  sms_active_version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  last_sync_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_vessels_tenant (tenant_id)
);

CREATE TABLE IF NOT EXISTS crew_assignments (
  id VARCHAR(36) PRIMARY KEY,
  vessel_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  `rank` VARCHAR(100) NOT NULL,
  signed_on_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  signed_off_at TIMESTAMP NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vessel_id) REFERENCES vessels(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES tenant_users(id) ON DELETE CASCADE,
  INDEX idx_crew_vessel (vessel_id),
  INDEX idx_crew_tenant (tenant_id)
);

CREATE TABLE IF NOT EXISTS sms_documents (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  parent_id VARCHAR(36) NULL,
  tree_kind VARCHAR(50) NOT NULL,
  label VARCHAR(500) NOT NULL,
  node_kind VARCHAR(20) NOT NULL,
  content_kind VARCHAR(20) NULL,
  content LONGTEXT,
  file_size_bytes BIGINT NULL,
  is_regulatory_header BOOLEAN NOT NULL DEFAULT FALSE,
  approval_state VARCHAR(20) NOT NULL DEFAULT 'approved',
  version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  sort_order INT NOT NULL DEFAULT 0,
  profile_id VARCHAR(36) NULL,
  author_name VARCHAR(255) NULL,
  author_role VARCHAR(100) NULL,
  author_origin VARCHAR(50) NULL,
  rejection_comments TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES sms_documents(id) ON DELETE CASCADE,
  INDEX idx_sms_docs_tenant_tree (tenant_id, tree_kind),
  INDEX idx_sms_docs_parent (parent_id)
);

CREATE TABLE IF NOT EXISTS sms_doc_tabs (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  tab_key VARCHAR(80) NOT NULL,
  label VARCHAR(255) NOT NULL,
  subtitle VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_sms_doc_tabs_tenant_key (tenant_id, tab_key)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NULL,
  actor_user_id VARCHAR(36) NULL,
  actor_email VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  action VARCHAR(255) NOT NULL,
  target VARCHAR(500),
  ip_address VARCHAR(100),
  location VARCHAR(255),
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_audit_tenant (tenant_id),
  INDEX idx_audit_created (created_at)
);

CREATE TABLE IF NOT EXISTS sms_profiles (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_sms_profiles_tenant (tenant_id)
);

CREATE TABLE IF NOT EXISTS sms_profile_vessels (
  profile_id VARCHAR(36) NOT NULL,
  vessel_id VARCHAR(36) NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (profile_id, vessel_id),
  FOREIGN KEY (profile_id) REFERENCES sms_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (vessel_id) REFERENCES vessels(id) ON DELETE CASCADE,
  INDEX idx_profile_vessels_vessel (vessel_id)
);

CREATE TABLE IF NOT EXISTS tenant_feature_flags (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  feature_key VARCHAR(100) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  custom_config JSON NOT NULL,
  updated_by VARCHAR(255),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_feature (tenant_id, feature_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant_sync_config (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL UNIQUE,
  auto_sync_interval_hours INT NOT NULL DEFAULT 6,
  manual_replicate_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by VARCHAR(255),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant_security_settings (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL UNIQUE,
  inactivity_timeout_minutes INT NOT NULL DEFAULT 15,
  enforce_single_session BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by VARCHAR(255),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rank_defs (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  `rank` VARCHAR(100) NOT NULL,
  description VARCHAR(500),
  is_custom BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_rank_defs_tenant_rank (tenant_id, `rank`)
);

CREATE TABLE IF NOT EXISTS rank_permissions (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  `rank` VARCHAR(100) NOT NULL,
  apps JSON NOT NULL,
  updated_by VARCHAR(255),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_rank_perms_tenant_rank (tenant_id, `rank`)
);

CREATE TABLE IF NOT EXISTS shore_role_defs (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  role VARCHAR(150) NOT NULL,
  description VARCHAR(500),
  is_custom BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_shore_role_defs_tenant_role (tenant_id, role)
);

CREATE TABLE IF NOT EXISTS shore_role_permissions (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  role VARCHAR(150) NOT NULL,
  actions JSON NOT NULL,
  updated_by VARCHAR(255),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_shore_role_perms_tenant_role (tenant_id, role)
);

CREATE TABLE IF NOT EXISTS sms_document_versions (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  document_id VARCHAR(36) NOT NULL,
  revision INT NOT NULL,
  version_label VARCHAR(50) NOT NULL,
  content LONGTEXT,
  content_kind VARCHAR(20) DEFAULT 'rich_text',
  uploaded_by VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES sms_documents(id) ON DELETE CASCADE,
  INDEX idx_doc_versions (tenant_id, document_id, revision)
);

CREATE TABLE IF NOT EXISTS vessel_sync_outbox (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  vessel_id VARCHAR(36) NOT NULL,
  module_key VARCHAR(100) NOT NULL,
  operation VARCHAR(20) NOT NULL DEFAULT 'upsert',
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  payload JSON NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  priority INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TIMESTAMP NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (vessel_id) REFERENCES vessels(id) ON DELETE CASCADE,
  INDEX idx_outbox_tenant_vessel (tenant_id, vessel_id, status, priority),
  INDEX idx_outbox_module (tenant_id, module_key, status),
  INDEX idx_outbox_status (status, created_at)
);

CREATE TABLE IF NOT EXISTS vessel_sync_state (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  vessel_id VARCHAR(36) NOT NULL UNIQUE,
  connection_mode VARCHAR(50) NOT NULL DEFAULT 'VESSEL_SERVER_LAN',
  server_reachable BOOLEAN NOT NULL DEFAULT FALSE,
  last_heartbeat_at TIMESTAMP NULL,
  last_sync_at TIMESTAMP NULL,
  last_sync_method VARCHAR(20) NULL,
  pending_outbox_count INT NOT NULL DEFAULT 0,
  failed_outbox_count INT NOT NULL DEFAULT 0,
  active_module_keys JSON NOT NULL,
  total_payloads_synced BIGINT NOT NULL DEFAULT 0,
  total_bytes_synced BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (vessel_id) REFERENCES vessels(id) ON DELETE CASCADE,
  INDEX idx_sync_state_tenant (tenant_id, vessel_id)
);

CREATE TABLE IF NOT EXISTS session_tokens (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL,
  device_info VARCHAR(500),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_tokens_user (user_id),
  INDEX idx_session_tokens_token (token)
);

CREATE TABLE IF NOT EXISTS module_definitions (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NULL,
  module_key VARCHAR(100) NOT NULL,
  label VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(100) DEFAULT 'FileText',
  category VARCHAR(100) DEFAULT 'operations',
  sort_order INT NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_by_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_module_defs_tenant (tenant_id)
);

CREATE TABLE IF NOT EXISTS app_users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS maintenance_banner (
  id VARCHAR(36) PRIMARY KEY,
  message TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  published_by VARCHAR(255),
  published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- NULL = platform-wide notice, otherwise scoped to a single tenant's users only
  tenant_id VARCHAR(36) NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_banner_tenant_active (tenant_id, is_active)
);

CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(36) PRIMARY KEY,
  -- Short sequential number for display purposes only (e.g. INV-1007) — id
  -- above (the UUID) remains the real primary key used everywhere else
  invoice_no INT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
  tenant_id VARCHAR(36) NOT NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  period VARCHAR(100) NOT NULL,
  issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_date TIMESTAMP NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  line_items JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_invoices_tenant (tenant_id),
  INDEX idx_invoices_issued (issued_at)
);

CREATE TABLE IF NOT EXISTS backup_snapshots (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  taken_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  size_gb DECIMAL(10,2) NOT NULL DEFAULT 0,
  type VARCHAR(20) NOT NULL DEFAULT 'manual',
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  expiry TIMESTAMP NOT NULL,
  reason VARCHAR(500),
  created_by VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_backups_tenant (tenant_id),
  INDEX idx_backups_taken (taken_at)
);

-- Super-Admin "internal team" roster — distinct from tenant_users and from
-- the single-row super_admins login table. Roster only: inviting a staff
-- member here does not currently create a real login account for them.
CREATE TABLE IF NOT EXISTS platform_staff (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  role VARCHAR(50) NOT NULL DEFAULT 'Global Support Staff',
  status VARCHAR(20) NOT NULL DEFAULT 'invited',
  mfa BOOLEAN NOT NULL DEFAULT FALSE,
  last_active TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_platform_staff_email (email)
);

-- tenant_id uses ON DELETE SET NULL (not CASCADE, unlike every other table
-- here) — an error log referencing a since-deleted tenant should persist as
-- a platform-wide record, not vanish with the tenant.
CREATE TABLE IF NOT EXISTS error_logs (
  id VARCHAR(36) PRIMARY KEY,
  ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  level VARCHAR(20) NOT NULL DEFAULT 'error',
  source VARCHAR(100) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  tenant_id VARCHAR(36) NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
  INDEX idx_error_logs_ts (ts),
  INDEX idx_error_logs_tenant (tenant_id)
);

-- Master SMS Template engine — a platform-wide, tenant-less document tree
-- used for the Super-Admin "push template to fleet" feature. Deliberately
-- separate from sms_documents (each tenant's real, live SMS document tree
-- with its own approval workflow) and never merged with it.
CREATE TABLE IF NOT EXISTS master_sms_documents (
  id VARCHAR(36) PRIMARY KEY,
  parent_id VARCHAR(36) NULL,
  tree_kind VARCHAR(50) NOT NULL,
  label VARCHAR(500) NOT NULL,
  node_kind VARCHAR(20) NOT NULL,
  content_kind VARCHAR(20) NULL,
  content LONGTEXT,
  version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES master_sms_documents(id) ON DELETE CASCADE,
  INDEX idx_master_sms_tree (tree_kind),
  INDEX idx_master_sms_parent (parent_id)
);

CREATE TABLE IF NOT EXISTS master_sms_pushes (
  id VARCHAR(36) PRIMARY KEY,
  version VARCHAR(20) NOT NULL,
  pushed_by VARCHAR(255),
  pushed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  target_tenant_ids JSON NOT NULL
);

-- Per-tenant point-in-time SMS-tree snapshot powering the Super-Admin
-- rollback feature. Stored as a JSON blob of the whole document tree
-- rather than normalized rows: a snapshot is immutable and never queried
-- node-by-node.
CREATE TABLE IF NOT EXISTS sms_snapshots (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  label VARCHAR(255) NOT NULL,
  taken_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tree_data JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_sms_snapshots_tenant (tenant_id)
);

-- ════════════════════════════════════════════════════════════════════
-- Reality-audit fixes — real backing state for controls that previously
-- only existed in the browser (workspace freeze/guardrails, MFA, backup
-- restore, tier config, sync collision detection, galley headcount, real
-- platform-staff credentials, billing reminders). ADD COLUMN statements
-- below are not re-runnable cleanly (MySQL has no "ADD COLUMN IF NOT
-- EXISTS"), but server/index.js already runs every schema statement in a
-- try/catch-and-continue loop, so a duplicate-column error on the 2nd+ boot
-- is expected and harmless — matches the existing convention in this file.
-- ════════════════════════════════════════════════════════════════════

-- Per-tenant workspace governance, settable by a Super Admin and enforced
-- for real in server/routes/smsDocuments.js and server/routes/files.js
-- (a frozen workspace rejects writes with 423 Locked — guardrails reject
-- uploads/nesting that exceed the configured limits).
ALTER TABLE tenants ADD COLUMN workspace_frozen BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN max_subfolder_depth INT NOT NULL DEFAULT 4;
ALTER TABLE tenants ADD COLUMN max_upload_size_mb INT NOT NULL DEFAULT 50;
-- NULL = auto-backup disabled for this tenant. Consumed by the internal
-- job in server/routes/internalJobs.js (POST /api/internal/backups/auto-run),
-- triggered on the same Cloud Scheduler pattern as storage refresh.
ALTER TABLE tenants ADD COLUMN auto_backup_interval_hours INT NULL;
ALTER TABLE tenants ADD COLUMN last_auto_backup_at TIMESTAMP NULL;

-- Real TOTP (RFC 6238) MFA enrollment per crew/shore user — see
-- server/routes/mfa.js. mfa_secret is only set once verified — a login for
-- a tenant with mfa_enforced=TRUE and mfa_enabled=FALSE here is issued a
-- setup-only token instead of a full session token.
ALTER TABLE tenant_users ADD COLUMN mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenant_users ADD COLUMN mfa_secret VARCHAR(64) NULL;
ALTER TABLE tenant_users ADD COLUMN mfa_backup_codes JSON NULL;

-- Gives platform_staff roster entries a real login credential (previously
-- roster-only, see the table's own comment above) so "Reset password" can
-- actually rotate a credential instead of being a no-op.
ALTER TABLE platform_staff ADD COLUMN password_hash VARCHAR(255) NULL;
ALTER TABLE platform_staff ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Live crew headcount, maintained for real by server/routes/assignments.js
-- on every sign-on/sign-off. Drives galley_provisioning_plans below.
ALTER TABLE vessels ADD COLUMN headcount INT NOT NULL DEFAULT 0;

-- Captures the real before/after state of a mutation so the Security view's
-- "Field-Level Audit Delta" reads actual changed values instead of a
-- pattern-matched guess. Populated by call sites that have a meaningful
-- before/after (tenant edits, plan changes, guardrails, MFA, feature
-- flags, user status) — NULL on domains with no natural before/after
-- (e.g. a create or a login event).
ALTER TABLE audit_logs ADD COLUMN before_data JSON NULL;
ALTER TABLE audit_logs ADD COLUMN after_data JSON NULL;

-- A real point-in-time logical snapshot of a tenant's own operational
-- tables (never platform infrastructure — see the scope directive in
-- src/types.ts), captured on backup creation. POST /:id/restore now
-- actually replaces the tenant's current rows with this snapshot inside
-- a transaction, instead of being a no-op that only re-fetches the row.
ALTER TABLE backup_snapshots ADD COLUMN snapshot_data JSON NULL;

-- Editable SaaS tier pricing/limits — backs the Billing "Tier Constructor"
-- Save action for real (previously a client-only reducer with no
-- persistence). Seeded with the same defaults as src/constants.ts.
CREATE TABLE IF NOT EXISTS saas_tier_configs (
  name VARCHAR(50) PRIMARY KEY,
  monthly DECIMAL(10,2) NOT NULL DEFAULT 0,
  annual DECIMAL(10,2) NOT NULL DEFAULT 0,
  vessels INT NOT NULL DEFAULT 0,
  storage_gb INT NOT NULL DEFAULT 0,
  seats INT NOT NULL DEFAULT 0,
  updated_by VARCHAR(255),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT IGNORE INTO saas_tier_configs (name, monthly, annual, vessels, storage_gb, seats) VALUES
  ('Standard', 1200, 13200, 5, 50, 25),
  ('Professional', 4200, 46200, 20, 250, 100),
  ('Enterprise', 14500, 159500, 80, 1000, 500),
  ('Custom', 0, 0, 0, 0, 0);

-- A real detected write conflict on the vessel sync outbox: two pending
-- entries for the same entity from the same vessel that haven't synced
-- yet. Populated by server/routes/vesselSync.js's POST /outbox, replacing
-- the hardcoded "dedup events" list on the Monitoring view.
CREATE TABLE IF NOT EXISTS sync_collision_events (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  vessel_id VARCHAR(36) NOT NULL,
  module_key VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  prior_outbox_id VARCHAR(36) NOT NULL,
  new_outbox_id VARCHAR(36) NOT NULL,
  resolution VARCHAR(30) NOT NULL DEFAULT 'latest_wins',
  detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (vessel_id) REFERENCES vessels(id) ON DELETE CASCADE,
  INDEX idx_collision_tenant (tenant_id, detected_at)
);

-- Real per-vessel daily galley/victualling provisioning, recomputed by
-- server/routes/assignments.js whenever headcount changes (real-per-person
-- ration formula, see GALLEY_RATION_KG_PER_HEAD in that file).
CREATE TABLE IF NOT EXISTS galley_provisioning_plans (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  vessel_id VARCHAR(36) NOT NULL,
  plan_date DATE NOT NULL,
  headcount INT NOT NULL DEFAULT 0,
  breakfast_kg DECIMAL(8,2) NOT NULL DEFAULT 0,
  lunch_kg DECIMAL(8,2) NOT NULL DEFAULT 0,
  dinner_kg DECIMAL(8,2) NOT NULL DEFAULT 0,
  snack_kg DECIMAL(8,2) NOT NULL DEFAULT 0,
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (vessel_id) REFERENCES vessels(id) ON DELETE CASCADE,
  UNIQUE KEY uq_galley_plan_vessel_date (vessel_id, plan_date)
);

-- A real, auditable record that a billing reminder was sent for a tenant.
-- No outbound email service exists in this deployment, so this is honest
-- about what actually happened (a reminder was logged/sent by staff) rather
-- than fabricating a delivery pipeline — see BillingView.tsx.
CREATE TABLE IF NOT EXISTS billing_reminders (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  sent_by VARCHAR(255),
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note VARCHAR(500),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_billing_reminders_tenant (tenant_id, sent_at)
);
