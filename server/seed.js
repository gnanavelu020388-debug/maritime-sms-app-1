import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pool from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEMO_PASSWORD_HASH = bcrypt.hashSync('demo', 10);
const ADMIN_PASSWORD_HASH = bcrypt.hashSync('admin123', 10);

const TENANTS = [
  { id: 'tnt-pacific-horizon', company: 'Pacific Horizon Shipping', contact_email: 'it.director@pacifichorizon.com', plan: 'Enterprise', status: 'active', vessels_max: 12, seats_max: 120, storage_gb_max: 500, monthly_revenue: 18500, region: 'APAC', mfa_enforced: true, modules: ['sms_documentation','rest_hours','haccp_galley','certification_manager','electronic_logbooks','satellite_sync'], sms_version: '3.2.1', contract_expires: '2027-03-15 00:00:00' },
  { id: 'tnt-atlantic-liquid', company: 'Atlantic Liquid Bulk', contact_email: 'fleet.ops@atlanticliquidbulk.com', plan: 'Enterprise', status: 'active', vessels_max: 8, seats_max: 80, storage_gb_max: 300, monthly_revenue: 14200, region: 'EMEA', mfa_enforced: true, modules: ['sms_documentation','rest_hours','haccp_galley','certification_manager','satellite_sync'], sms_version: '3.2.1', contract_expires: '2026-11-20 00:00:00' },
  { id: 'tnt-nordic-reef', company: 'Nordic Reef Services', contact_email: 'operations@nordicreef.no', plan: 'Professional', status: 'active', vessels_max: 5, seats_max: 40, storage_gb_max: 100, monthly_revenue: 6800, region: 'Nordic', mfa_enforced: false, modules: ['sms_documentation','rest_hours','certification_manager'], sms_version: '3.1.9', contract_expires: '2026-09-10 00:00:00' },
  { id: 'tnt-crescent-maritime', company: 'Crescent Maritime', contact_email: 'admin@crescentmaritime.ae', plan: 'Standard', status: 'active', vessels_max: 4, seats_max: 25, storage_gb_max: 50, monthly_revenue: 3200, region: 'MEA', mfa_enforced: false, modules: ['sms_documentation'], sms_version: '3.0.5', contract_expires: '2026-08-30 00:00:00' },
];

const VESSELS = [
  { id: 'vsl-blue-horizon', tenant_id: 'tnt-pacific-horizon', name: 'MV Blue Horizon', imo_number: '9456782', call_sign: 'V7BHZ', flag_state: 'Liberia', port_of_registry: 'Monrovia', gross_tonnage: 42850, kw_power: 9360, vessel_type: 'Bulk Carrier', class_society: 'DNV', sms_active_version: '3.2.1', last_sync_at: '2026-07-20 14:30:00' },
  { id: 'vsl-northern-star', tenant_id: 'tnt-pacific-horizon', name: 'MV Northern Star', imo_number: '9512347', call_sign: '3FNS2', flag_state: 'Marshall Islands', port_of_registry: 'Majuro', gross_tonnage: 51320, kw_power: 11200, vessel_type: 'Container Ship', class_society: "Lloyd's Register", sms_active_version: '3.2.0', last_sync_at: '2026-07-18 09:15:00' },
  { id: 'vsl-ocean-pioneer', tenant_id: 'tnt-pacific-horizon', name: 'MV Ocean Pioneer', imo_number: '9387651', call_sign: 'A8OPN', flag_state: 'Singapore', port_of_registry: 'Singapore', gross_tonnage: 28940, kw_power: 7200, vessel_type: 'Chemical Tanker', class_society: 'ABS', sms_active_version: '3.1.9', last_sync_at: '2026-07-15 18:00:00' },
  { id: 'vsl-pacific-pearl', tenant_id: 'tnt-pacific-horizon', name: 'MV Pacific Pearl', imo_number: '9678412', call_sign: 'D4PPL', flag_state: 'Panama', port_of_registry: 'Panama City', gross_tonnage: 35670, kw_power: 8400, vessel_type: 'Product Tanker', class_society: 'BV', sms_active_version: '3.2.1', last_sync_at: '2026-07-21 11:45:00' },
  { id: 'vsl-one-reputation', tenant_id: 'tnt-pacific-horizon', name: 'MV ONE REPUTATION', imo_number: '9781234', call_sign: '9ORP1', flag_state: 'Singapore', port_of_registry: 'Singapore', gross_tonnage: 50890, kw_power: 10650, vessel_type: 'Container Ship', class_society: 'DNV', sms_active_version: '3.2.1', last_sync_at: '2026-07-22 08:30:00' },
  { id: 'vsl-atlas-pride', tenant_id: 'tnt-atlantic-liquid', name: 'MV Atlas Pride', imo_number: '9412388', call_sign: 'V5ATP', flag_state: 'Malta', port_of_registry: 'Valletta', gross_tonnage: 73200, kw_power: 15800, vessel_type: 'VLCC Tanker', class_society: 'DNV', sms_active_version: '3.2.1', last_sync_at: '2026-07-21 08:00:00' },
  { id: 'vsl-stella-voyager', tenant_id: 'tnt-atlantic-liquid', name: 'MV Stella Voyager', imo_number: '9234567', call_sign: '9HSVY', flag_state: 'Greece', port_of_registry: 'Piraeus', gross_tonnage: 61800, kw_power: 13200, vessel_type: 'Suezmax Tanker', class_society: 'ABS', sms_active_version: '3.2.1', last_sync_at: '2026-07-19 16:30:00' },
  { id: 'vsl-crest-breeze', tenant_id: 'tnt-atlantic-liquid', name: 'MV Crest Breeze', imo_number: '9345678', call_sign: 'C6CRB', flag_state: 'Cyprus', port_of_registry: 'Limassol', gross_tonnage: 47500, kw_power: 10400, vessel_type: 'Aframax Tanker', class_society: 'LR', sms_active_version: '3.2.0', last_sync_at: '2026-07-17 10:00:00' },
  { id: 'vsl-nordic-breeze', tenant_id: 'tnt-nordic-reef', name: 'MV Nordic Breeze', imo_number: '9123456', call_sign: 'NWNBZ', flag_state: 'Norway', port_of_registry: 'Bergen', gross_tonnage: 18500, kw_power: 4800, vessel_type: 'Reefer Vessel', class_society: 'DNV', sms_active_version: '3.1.9', last_sync_at: '2026-07-16 12:00:00' },
  { id: 'vsl-polar-explorer', tenant_id: 'tnt-nordic-reef', name: 'MV Polar Explorer', imo_number: '9234588', call_sign: 'P8PEX', flag_state: 'Norway', port_of_registry: 'Tromsø', gross_tonnage: 22300, kw_power: 5600, vessel_type: 'Reefer Vessel', class_society: 'DNV', sms_active_version: '3.1.9', last_sync_at: '2026-07-14 09:00:00' },
  { id: 'vsl-crescent-trader', tenant_id: 'tnt-crescent-maritime', name: 'MV Crescent Trader', imo_number: '9567890', call_sign: 'A8CRT', flag_state: 'UAE', port_of_registry: 'Dubai', gross_tonnage: 32100, kw_power: 7800, vessel_type: 'General Cargo', class_society: 'BV', sms_active_version: '3.0.5', last_sync_at: '2026-07-10 06:00:00' },
  { id: 'vsl-gulf-pioneer', tenant_id: 'tnt-crescent-maritime', name: 'MV Gulf Pioneer', imo_number: '9678901', call_sign: 'G4GPL', flag_state: 'Bahamas', port_of_registry: 'Nassau', gross_tonnage: 25600, kw_power: 6200, vessel_type: 'Container Feeder', class_society: 'ABS', sms_active_version: '3.0.5', last_sync_at: '2026-07-08 14:00:00' },
];

function mkUser(id, tenantId, name, email, rank, role, nationality, status = 'active', empId = null, seamanBook = null, fleetScope = 'global', assignedVesselIds = [], assignedFleetProfileIds = []) {
  return { id, tenant_id: tenantId, name, email, rank, role, nationality, status, employee_id: empId, seaman_book_number: seamanBook, fleet_scope: fleetScope, assigned_vessel_ids: assignedVesselIds, assigned_fleet_profile_ids: assignedFleetProfileIds };
}

const USERS = [
  mkUser('ph-dpa', 'tnt-pacific-horizon', 'Sarah Chen', 'dpa@pacifichorizon.co', 'DPA', 'dpa', 'Singaporean'),
  mkUser('ph-ca', 'tnt-pacific-horizon', 'Admiral Pierce', 'company.admin@pacifichorizon.co', 'Company Admin', 'company_admin', 'Singaporean', 'active', 'PHS-0000'),
  mkUser('ph-fm', 'tnt-pacific-horizon', 'Thomas Eriksson', 'fleet.manager@pacifichorizon.co', 'Fleet Manager', 'dpa', 'Swedish', 'active', 'PHS-0002'),
  mkUser('ph-master', 'tnt-pacific-horizon', 'James Whitfield', 'master@pacifichorizon.co', 'Master', 'vessel', 'British', 'active', 'PHS-0042', 'SB-99182'),
  mkUser('ph-chief-eng', 'tnt-pacific-horizon', 'Raj Kapoor', 'chief.eng@pacifichorizon.co', 'Chief Engineer', 'vessel', 'Indian', 'active', 'PHS-0058', 'SB-44721'),
  mkUser('ph-chief-mate', 'tnt-pacific-horizon', 'Maria Santos', 'chief.mate@pacifichorizon.co', 'Chief Mate', 'vessel', 'Filipino', 'active', 'PHS-0071', 'SB-77530'),
  mkUser('ph-2nd-eng', 'tnt-pacific-horizon', 'Ivan Petrov', '2nd.eng@pacifichorizon.co', 'Second Engineer', 'vessel', 'Ukrainian', 'active', 'PHS-0089', 'SB-66214'),
  mkUser('ph-bosun', 'tnt-pacific-horizon', 'Ahmed Hassan', 'bosun@pacifichorizon.co', 'Bosun', 'vessel', 'Egyptian', 'active', 'PHS-0102', 'SB-55890'),
  mkUser('ph-ab', 'tnt-pacific-horizon', 'Carlos Mendez', 'ab.seaman@pacifichorizon.co', 'AB', 'vessel', 'Mexican', 'active', 'PHS-0118', 'SB-33421'),
  mkUser('ph-oiler', 'tnt-pacific-horizon', 'Lutfi Wijaya', 'oiler@pacifichorizon.co', 'Oiler', 'vessel', 'Indonesian', 'invited', 'PHS-0125', 'SB-22187'),
  mkUser('ph-cook', 'tnt-pacific-horizon', 'Grace Okoro', 'cook@pacifichorizon.co', 'Cook', 'vessel', 'Nigerian', 'active', 'PHS-0131', 'SB-11203'),
  mkUser('ph-ts', 'tnt-pacific-horizon', 'Daniel Wexford', 'tech.super@pacifichorizon.co', 'Technical Superintendent', 'dpa', 'British', 'active', 'PHS-0003', null, 'specific', ['vsl-blue-horizon']),
  mkUser('al-dpa', 'tnt-atlantic-liquid', 'Margaret Foster', 'dpa@atlanticliquidbulk.com', 'DPA', 'dpa', 'British'),
  mkUser('al-ca', 'tnt-atlantic-liquid', 'Victoria Hale', 'company.admin@atlanticliquidbulk.com', 'Company Admin', 'company_admin', 'British', 'active', 'ALB-0000'),
  mkUser('al-fm', 'tnt-atlantic-liquid', 'Henrik Larsen', 'fleet.manager@atlanticliquidbulk.com', 'Fleet Manager', 'dpa', 'Danish', 'active', 'ALB-0002'),
  mkUser('al-master', 'tnt-atlantic-liquid', 'Pierre Dubois', 'master@atlanticliquidbulk.com', 'Master', 'vessel', 'French', 'active', 'ALB-0101', 'SB-88451'),
  mkUser('al-chief-eng', 'tnt-atlantic-liquid', 'Sven Olsen', 'chief.eng@atlanticliquidbulk.com', 'Chief Engineer', 'vessel', 'Norwegian', 'active', 'ALB-0115', 'SB-77320'),
  mkUser('al-chief-mate', 'tnt-atlantic-liquid', 'Dimitri Volkov', 'chief.mate@atlanticliquidbulk.com', 'Chief Mate', 'vessel', 'Russian', 'active', 'ALB-0128', 'SB-66195'),
  mkUser('al-bosun', 'tnt-atlantic-liquid', 'Kwame Asante', 'bosun@atlanticliquidbulk.com', 'Bosun', 'vessel', 'Ghanaian', 'active', 'ALB-0142', 'SB-55870'),
  mkUser('nr-dpa', 'tnt-nordic-reef', 'Erik Johansson', 'dpa@nordicreef.no', 'DPA', 'dpa', 'Swedish'),
  mkUser('nr-ca', 'tnt-nordic-reef', 'Magnus Sorensen', 'company.admin@nordicreef.no', 'Company Admin', 'company_admin', 'Norwegian', 'active', 'NRS-0000'),
  mkUser('nr-fm', 'tnt-nordic-reef', 'Ingrid Berg', 'fleet.manager@nordicreef.no', 'Fleet Manager', 'dpa', 'Norwegian', 'active', 'NRS-0002'),
  mkUser('nr-master', 'tnt-nordic-reef', 'Lars Anderson', 'master@nordicreef.no', 'Master', 'vessel', 'Norwegian', 'active', 'NRS-0051', 'SB-33456'),
  mkUser('nr-chief-eng', 'tnt-nordic-reef', 'Olaf Petersen', 'chief.eng@nordicreef.no', 'Chief Engineer', 'vessel', 'Danish', 'active', 'NRS-0063', 'SB-22890'),
  mkUser('nr-chief-mate', 'tnt-nordic-reef', 'Anna Lindqvist', 'chief.mate@nordicreef.no', 'Chief Mate', 'vessel', 'Finnish', 'active', 'NRS-0075', 'SB-11765'),
  mkUser('cm-dpa', 'tnt-crescent-maritime', 'Rashid Al-Maktoum', 'dpa@crescentmaritime.ae', 'DPA', 'dpa', 'Emirati'),
  mkUser('cm-ca', 'tnt-crescent-maritime', 'Fatima Al-Mansouri', 'company.admin@crescentmaritime.ae', 'Company Admin', 'company_admin', 'Emirati', 'active', 'CMT-0000'),
  mkUser('cm-fm', 'tnt-crescent-maritime', 'Yusuf Al-Rashid', 'fleet.manager@crescentmaritime.ae', 'Fleet Manager', 'dpa', 'Emirati', 'active', 'CMT-0002'),
  mkUser('cm-master', 'tnt-crescent-maritime', 'Ali Hassan', 'master@crescentmaritime.ae', 'Master', 'vessel', 'Pakistani', 'active', 'CMT-0031', 'SB-99120'),
  mkUser('cm-chief-eng', 'tnt-crescent-maritime', 'Vikram Singh', 'chief.eng@crescentmaritime.ae', 'Chief Engineer', 'vessel', 'Indian', 'active', 'CMT-0045', 'SB-88210'),
  mkUser('cm-chief-mate', 'tnt-crescent-maritime', 'Hassan Bilal', 'chief.mate@crescentmaritime.ae', 'Chief Mate', 'vessel', 'Lebanese', 'active', 'CMT-0058', 'SB-77150'),
];

const ASSIGNMENTS = [
  { id: 'ph-a1', vessel_id: 'vsl-blue-horizon', tenant_id: 'tnt-pacific-horizon', user_id: 'ph-master', rank: 'Master', signed_on_at: '2026-06-01 00:00:00' },
  { id: 'ph-a2', vessel_id: 'vsl-blue-horizon', tenant_id: 'tnt-pacific-horizon', user_id: 'ph-chief-eng', rank: 'Chief Engineer', signed_on_at: '2026-06-01 00:00:00' },
  { id: 'ph-a3', vessel_id: 'vsl-blue-horizon', tenant_id: 'tnt-pacific-horizon', user_id: 'ph-chief-mate', rank: 'Chief Mate', signed_on_at: '2026-06-01 00:00:00' },
  { id: 'ph-a4', vessel_id: 'vsl-blue-horizon', tenant_id: 'tnt-pacific-horizon', user_id: 'ph-bosun', rank: 'Bosun', signed_on_at: '2026-06-15 00:00:00' },
  { id: 'ph-a5', vessel_id: 'vsl-blue-horizon', tenant_id: 'tnt-pacific-horizon', user_id: 'ph-cook', rank: 'Cook', signed_on_at: '2026-06-10 00:00:00' },
  { id: 'ph-a6', vessel_id: 'vsl-northern-star', tenant_id: 'tnt-pacific-horizon', user_id: 'ph-2nd-eng', rank: 'Second Engineer', signed_on_at: '2026-05-20 00:00:00' },
  { id: 'ph-a7', vessel_id: 'vsl-northern-star', tenant_id: 'tnt-pacific-horizon', user_id: 'ph-ab', rank: 'AB', signed_on_at: '2026-05-20 00:00:00' },
  { id: 'al-a1', vessel_id: 'vsl-atlas-pride', tenant_id: 'tnt-atlantic-liquid', user_id: 'al-master', rank: 'Master', signed_on_at: '2026-06-10 00:00:00' },
  { id: 'al-a2', vessel_id: 'vsl-atlas-pride', tenant_id: 'tnt-atlantic-liquid', user_id: 'al-chief-eng', rank: 'Chief Engineer', signed_on_at: '2026-06-10 00:00:00' },
  { id: 'al-a3', vessel_id: 'vsl-stella-voyager', tenant_id: 'tnt-atlantic-liquid', user_id: 'al-chief-mate', rank: 'Chief Mate', signed_on_at: '2026-06-05 00:00:00' },
  { id: 'al-a4', vessel_id: 'vsl-crest-breeze', tenant_id: 'tnt-atlantic-liquid', user_id: 'al-bosun', rank: 'Bosun', signed_on_at: '2026-06-12 00:00:00' },
  { id: 'nr-a1', vessel_id: 'vsl-nordic-breeze', tenant_id: 'tnt-nordic-reef', user_id: 'nr-master', rank: 'Master', signed_on_at: '2026-06-15 00:00:00' },
  { id: 'nr-a2', vessel_id: 'vsl-nordic-breeze', tenant_id: 'tnt-nordic-reef', user_id: 'nr-chief-eng', rank: 'Chief Engineer', signed_on_at: '2026-06-15 00:00:00' },
  { id: 'nr-a3', vessel_id: 'vsl-polar-explorer', tenant_id: 'tnt-nordic-reef', user_id: 'nr-chief-mate', rank: 'Chief Mate', signed_on_at: '2026-06-08 00:00:00' },
  { id: 'cm-a1', vessel_id: 'vsl-crescent-trader', tenant_id: 'tnt-crescent-maritime', user_id: 'cm-master', rank: 'Master', signed_on_at: '2026-07-01 00:00:00' },
  { id: 'cm-a2', vessel_id: 'vsl-crescent-trader', tenant_id: 'tnt-crescent-maritime', user_id: 'cm-chief-eng', rank: 'Chief Engineer', signed_on_at: '2026-07-01 00:00:00' },
  { id: 'cm-a3', vessel_id: 'vsl-gulf-pioneer', tenant_id: 'tnt-crescent-maritime', user_id: 'cm-chief-mate', rank: 'Chief Mate', signed_on_at: '2026-07-05 00:00:00' },
];

async function seed() {
  console.log('[Seed] Starting database seed...');

  // Super admin
  await pool.query('DELETE FROM super_admins WHERE email = ?', ['admin@maritime-platform.io']);
  await pool.query('INSERT INTO super_admins (id, name, email, password_hash) VALUES (?,?,?,?)', [uuidv4(), 'Platform Admin', 'admin@maritime-platform.io', ADMIN_PASSWORD_HASH]);

  // Tenants
  for (const t of TENANTS) {
    await pool.query('DELETE FROM tenants WHERE id = ?', [t.id]);
    await pool.query(
      'INSERT INTO tenants (id, company, contact_email, plan, status, vessels_max, seats_max, storage_gb_max, monthly_revenue, region, mfa_enforced, modules, sms_version, contract_expires) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [t.id, t.company, t.contact_email, t.plan, t.status, t.vessels_max, t.seats_max, t.storage_gb_max, t.monthly_revenue, t.region, t.mfa_enforced, JSON.stringify(t.modules), t.sms_version, t.contract_expires],
    );
  }

  // Vessels
  for (const v of VESSELS) {
    await pool.query('DELETE FROM vessels WHERE id = ?', [v.id]);
    await pool.query(
      'INSERT INTO vessels (id, tenant_id, name, imo_number, call_sign, flag_state, port_of_registry, gross_tonnage, kw_power, vessel_type, class_society, sms_active_version, last_sync_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [v.id, v.tenant_id, v.name, v.imo_number, v.call_sign, v.flag_state, v.port_of_registry, v.gross_tonnage, v.kw_power, v.vessel_type, v.class_society, v.sms_active_version, v.last_sync_at],
    );
  }

  // Users
  for (const u of USERS) {
    await pool.query('DELETE FROM tenant_users WHERE id = ?', [u.id]);
    await pool.query(
      'INSERT INTO tenant_users (id, tenant_id, name, email, password_hash, `rank`, role, nationality, status, employee_id, seaman_book_number, fleet_scope, assigned_vessel_ids, assigned_fleet_profile_ids) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [u.id, u.tenant_id, u.name, u.email, DEMO_PASSWORD_HASH, u.rank, u.role, u.nationality, u.status, u.employee_id, u.seaman_book_number, u.fleet_scope, JSON.stringify(u.assigned_vessel_ids), JSON.stringify(u.assigned_fleet_profile_ids)],
    );
  }

  // Assignments
  for (const a of ASSIGNMENTS) {
    await pool.query('DELETE FROM crew_assignments WHERE id = ?', [a.id]);
    await pool.query(
      'INSERT INTO crew_assignments (id, vessel_id, tenant_id, user_id, `rank`, signed_on_at) VALUES (?,?,?,?,?,?)',
      [a.id, a.vessel_id, a.tenant_id, a.user_id, a.rank, a.signed_on_at],
    );
  }

  // Feature flags — enable sms_documentation for all tenants
  for (const t of TENANTS) {
    await pool.query('DELETE FROM tenant_feature_flags WHERE tenant_id = ? AND feature_key = ?', [t.id, 'sms_documentation']);
    await pool.query('INSERT INTO tenant_feature_flags (id, tenant_id, feature_key, enabled, custom_config) VALUES (?,?,?,TRUE,?)', [uuidv4(), t.id, 'sms_documentation', '{}']);
    for (const mod of t.modules) {
      if (mod === 'sms_documentation') continue;
      await pool.query('DELETE FROM tenant_feature_flags WHERE tenant_id = ? AND feature_key = ?', [t.id, mod]);
      await pool.query('INSERT INTO tenant_feature_flags (id, tenant_id, feature_key, enabled, custom_config) VALUES (?,?,?,TRUE,?)', [uuidv4(), t.id, mod, '{}']);
    }
    // Sync config
    await pool.query('DELETE FROM tenant_sync_config WHERE tenant_id = ?', [t.id]);
    await pool.query('INSERT INTO tenant_sync_config (id, tenant_id, auto_sync_interval_hours, manual_replicate_enabled) VALUES (?,?,6,TRUE)', [uuidv4(), t.id]);
  }

  // SMS Profiles
  for (const t of TENANTS) {
    const pid = uuidv4();
    await pool.query('INSERT INTO sms_profiles (id, tenant_id, name, version, is_default) VALUES (?,?,?,?,TRUE)', [pid, t.id, 'Universal Fleet Baseline', t.sms_version]);
  }

  // Invoices — a few months of billing history per tenant so the
  // Super-Admin Billing view isn't empty on a fresh database.
  const INVOICE_STATUSES = ['paid', 'paid', 'processing', 'overdue'];
  const INVOICE_PERIODS = ['June 2026', 'May 2026', 'April 2026'];
  for (let ti = 0; ti < TENANTS.length; ti++) {
    const t = TENANTS[ti];
    await pool.query('DELETE FROM invoices WHERE tenant_id = ?', [t.id]);
    for (let m = 0; m < 3; m++) {
      const lineItems = JSON.stringify([{ description: 'Monthly platform subscription', amount: t.monthly_revenue }]);
      await pool.query(
        'INSERT INTO invoices (id, tenant_id, amount, currency, period, status, line_items) VALUES (?,?,?,?,?,?,?)',
        [uuidv4(), t.id, t.monthly_revenue, 'USD', INVOICE_PERIODS[m], INVOICE_STATUSES[(ti + m) % INVOICE_STATUSES.length], lineItems],
      );
    }
  }

  // Backup snapshots — a short recent history per tenant.
  for (let ti = 0; ti < TENANTS.length; ti++) {
    const t = TENANTS[ti];
    await pool.query('DELETE FROM backup_snapshots WHERE tenant_id = ?', [t.id]);
    for (let d = 0; d < 3; d++) {
      await pool.query(
        'INSERT INTO backup_snapshots (id, tenant_id, size_gb, type, status, expiry) VALUES (?,?,?,?,?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
        [uuidv4(), t.id, +(t.storage_gb_max * 0.04 + d).toFixed(2), d === 1 ? 'manual' : 'auto', 'completed'],
      );
    }
  }

  // Platform staff roster
  const STAFF = [
    { name: 'Platform Admin', email: 'admin@maritime-platform.io', role: 'Super-Admin', status: 'active', mfa: true },
    { name: 'Morgan Whitfield', email: 'm.whitfield@maritime-platform.io', role: 'Platform Auditor', status: 'active', mfa: true },
    { name: 'Theo Marchetti', email: 't.marchetti@maritime-platform.io', role: 'Global Support Staff', status: 'active', mfa: false },
  ];
  for (const s of STAFF) {
    await pool.query('DELETE FROM platform_staff WHERE email = ?', [s.email]);
    await pool.query(
      'INSERT INTO platform_staff (id, name, email, role, status, mfa) VALUES (?,?,?,?,?,?)',
      [uuidv4(), s.name, s.email, s.role, s.status, s.mfa],
    );
  }

  console.log('[Seed] Done! Demo accounts use password "demo", super admin uses "admin123".');
  await pool.end();
}

seed().catch((err) => { console.error('[Seed] Error:', err); process.exit(1); });
