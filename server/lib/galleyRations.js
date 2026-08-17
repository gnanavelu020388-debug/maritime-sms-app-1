import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';

// Real per-person provisioning estimates (kg of food per head), based on
// typical maritime catering planning figures. Not a fabricated "+1
// headcount" narrative — these numbers actually drive galley_provisioning_plans.
export const GALLEY_RATION_KG_PER_HEAD = {
  breakfast: 0.4,
  lunch: 0.65,
  dinner: 0.65,
  snack: 0.15,
};

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/** Recomputes and upserts today's provisioning plan for a vessel from its current headcount. Called after every real headcount change (sign-on/sign-off). */
export async function recomputeGalleyPlan(tenantId, vesselId) {
  const [[vessel]] = await pool.query('SELECT id FROM vessels WHERE id = ? AND tenant_id = ?', [vesselId, tenantId]);
  if (!vessel) return null;
  // Count active crew directly rather than trust vessels.headcount: that
  // column is only ever mutated by adjustHeadcount() on sign-on/sign-off,
  // so any crew_assignments row inserted another way (seed data, a direct
  // DB fix, a restored backup) leaves it permanently out of sync with the
  // real onboard headcount.
  const [[{ headcount }]] = await pool.query(
    'SELECT COUNT(*) AS headcount FROM crew_assignments WHERE vessel_id = ? AND tenant_id = ? AND signed_off_at IS NULL',
    [vesselId, tenantId],
  );
  const plan = {
    breakfast_kg: +(headcount * GALLEY_RATION_KG_PER_HEAD.breakfast).toFixed(2),
    lunch_kg: +(headcount * GALLEY_RATION_KG_PER_HEAD.lunch).toFixed(2),
    dinner_kg: +(headcount * GALLEY_RATION_KG_PER_HEAD.dinner).toFixed(2),
    snack_kg: +(headcount * GALLEY_RATION_KG_PER_HEAD.snack).toFixed(2),
  };
  const date = todayUtc();
  await pool.query(
    `INSERT INTO galley_provisioning_plans (id, tenant_id, vessel_id, plan_date, headcount, breakfast_kg, lunch_kg, dinner_kg, snack_kg)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE headcount = VALUES(headcount), breakfast_kg = VALUES(breakfast_kg), lunch_kg = VALUES(lunch_kg), dinner_kg = VALUES(dinner_kg), snack_kg = VALUES(snack_kg)`,
    [uuidv4(), tenantId, vesselId, date, headcount, plan.breakfast_kg, plan.lunch_kg, plan.dinner_kg, plan.snack_kg],
  );
  return { headcount, planDate: date, ...plan };
}

/** Adjusts a vessel's real headcount by +1/-1 (never below 0) and recomputes its provisioning plan. Returns the new headcount + plan. */
export async function adjustHeadcount(tenantId, vesselId, delta) {
  await pool.query(
    'UPDATE vessels SET headcount = GREATEST(0, headcount + ?) WHERE id = ? AND tenant_id = ?',
    [delta, vesselId, tenantId],
  );
  return recomputeGalleyPlan(tenantId, vesselId);
}
