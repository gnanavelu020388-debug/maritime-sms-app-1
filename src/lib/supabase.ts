// Domain type definitions for the maritime platform.
// All data access goes through the Express API backend (Google Cloud Run)
// with data persisted in Google Cloud SQL (MySQL) and files in Google Cloud Storage.

// ---- Auth types (replacing @supabase/supabase-js User & Session) ----

export interface User {
  id: string;
  aud: string;
  role: string;
  email: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  identities: unknown[];
  created_at: string;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: string;
  user: User;
}

// ---- Domain types matching the DB schema ----

export type PlatformRole = 'super_admin' | 'company_admin' | 'dpa' | 'vessel';
export type InternalRole = 'super_admin' | 'platform_auditor' | 'global_support';
export type Rank = string;

export const ALL_RANKS: Rank[] = ['Master', 'Chief Engineer', 'Chief Mate', 'Second Engineer', 'Bosun', 'AB', 'Oiler', 'Cook', 'Crew'];
export const CORE_RANKS: Rank[] = ['Master', 'Chief Engineer', 'Chief Mate', 'Second Engineer', 'Bosun', 'AB', 'Oiler', 'Cook', 'Crew'];
export type ApprovalState = 'draft' | 'pending_dpa' | 'approved' | 'rejected' | 'pending_delete';

export interface TenantRow {
  id: string;
  // Short sequential number for display only — id (UUID) is the real key.
  tenant_no?: number;
  company: string;
  contact_email: string;
  plan: string;
  status: string;
  vessels_max: number;
  seats_max: number;
  storage_gb_max: number;
  monthly_revenue: number;
  mfa_enforced: boolean;
  modules: string[];
  sms_version: string;
  created_at: string;
  contract_expires: string;
  updated_at: string;
  // Summed from sms_documents.file_size_bytes on read — not a stored counter.
  storage_bytes_used?: number;
  storage_status?: 'NORMAL' | 'WARNING' | 'LIMIT_REACHED' | 'OVER_LIMIT';
  storage_remaining_gb?: number;
  storage_percentage?: number;
  workspace_frozen: boolean;
  max_subfolder_depth: number;
  max_upload_size_mb: number;
  auto_backup_interval_hours: number | null;
  last_auto_backup_at: string | null;
}

export interface TenantUserRow {
  id: string;
  tenant_id: string;
  auth_uid: string | null;
  name: string;
  email: string;
  employee_id: string | null;
  passport_number: string | null;
  seaman_book_number: string | null;
  nationality: string | null;
  rank: Rank;
  role: Exclude<PlatformRole, 'super_admin'>;
  status: string;
  must_change_password?: boolean;
  fleet_scope: 'global' | 'specific';
  assigned_vessel_ids: string[];
  assigned_fleet_profile_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface VesselRow {
  id: string;
  tenant_id: string;
  name: string;
  imo_number: string;
  call_sign: string | null;
  flag_state: string | null;
  port_of_registry: string | null;
  gross_tonnage: number | null;
  kw_power: number | null;
  vessel_type: string | null;
  class_society: string | null;
  satellite_provider: string | null;
  sms_active_version: string;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrewAssignmentRow {
  id: string;
  vessel_id: string;
  tenant_id: string;
  user_id: string;
  rank: Rank;
  signed_on_at: string;
  signed_off_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface ActiveAssignment {
  assignment_id: string;
  vessel_id: string;
  vessel_name: string;
  tenant_id: string;
  user_id: string;
  rank: Rank;
  signed_on_at: string;
}

export interface SmsDocRow {
  id: string;
  tenant_id: string;
  parent_id: string | null;
  tree_kind: 'sms' | 'fleet_circulars' | 'flag_state';
  label: string;
  node_kind: 'folder' | 'document';
  content_kind: 'rich_text' | 'pdf' | null;
  content: string | null;
  file_size_bytes: number | null;
  is_regulatory_header: boolean;
  approval_state: ApprovalState;
  version: string;
  sort_order: number;
  profile_id: string | null;
  author_name: string | null;
  author_role: string | null;
  author_origin: string | null;
  rejection_comments: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRow {
  id: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  actor_email: string;
  category: string;
  action: string;
  target: string | null;
  ip_address: string | null;
  location: string | null;
  severity: 'info' | 'warning' | 'critical';
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
}

export interface InvoiceRow {
  id: string;
  invoice_no: number;
  tenant_id: string;
  company?: string; // joined from tenants by the invoices route
  amount: number;
  currency: string;
  period: string;
  issued_at: string;
  due_date: string | null;
  status: string;
  line_items: { description: string; amount: number }[];
  created_at: string;
}

export interface BackupSnapshotRow {
  id: string;
  tenant_id: string;
  company?: string; // joined from tenants by the backups route
  taken_at: string;
  size_gb: number;
  type: string;
  status: string;
  expiry: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PlatformStaffRow {
  id: string;
  name: string;
  email: string;
  role: 'Super-Admin' | 'Platform Auditor' | 'Global Support Staff';
  status: 'active' | 'locked' | 'invited';
  mfa: boolean;
  last_active: string | null;
  created_at: string;
  updated_at: string;
}

export interface ErrorLogRow {
  id: string;
  ts: string;
  level: 'error' | 'warn' | 'critical';
  source: string;
  message: string;
  tenant_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface MasterSmsDocRow {
  id: string;
  parent_id: string | null;
  tree_kind: 'sms' | 'fleet_circulars' | 'flag_state';
  label: string;
  node_kind: 'folder' | 'document';
  content_kind: 'rich_text' | 'pdf' | null;
  content: string | null;
  version: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SmsSnapshotRow {
  id: string;
  tenant_id: string;
  label: string;
  taken_at: string;
  tree_data: unknown;
  created_at: string;
}

export function rankToRole(rank: Rank): Exclude<PlatformRole, 'super_admin'> {
  if (rank === 'DPA') return 'dpa';
  return 'vessel';
}
