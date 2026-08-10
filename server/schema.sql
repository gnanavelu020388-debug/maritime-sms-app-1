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
  storage_gb_max BIGINT NOT NULL DEFAULT 50,
  monthly_revenue DECIMAL(10,2) NOT NULL DEFAULT 0,
  region VARCHAR(50) NOT NULL DEFAULT 'EMEA',
  mfa_enforced BOOLEAN NOT NULL DEFAULT TRUE,
  modules JSON NOT NULL,
  sms_version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  contract_expires TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
