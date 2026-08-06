# Self-Hosted Backend Setup Guide — Cloud Run or Any Postgres

This guide explains how to take the database schema and run it on your own infrastructure so you fully own and control the data.

---

## What You're Getting

The file `docs/STANDALONE-SCHEMA.sql` contains the complete database schema — all 20 tables, all security policies, all helper functions, all indexes — consolidated from the 22 Supabase migrations into one runnable SQL file.

It works on **any PostgreSQL 14+ instance**: Google Cloud Run (with Cloud SQL), AWS RDS, Azure Database, a Docker container, or a VM.

---

## Architecture Overview

```
Your React app (browser)
        |
        v
  Your API backend (Cloud Run)
        |  (verifies JWT, sets session vars)
        v
  Your Postgres database (Cloud SQL)
        (tables + RLS policies from STANDALONE-SCHEMA.sql)
```

The key difference from Supabase: **your Cloud Run service sits between the browser and the database.** In Supabase, the browser talked to Postgres directly (via Supabase's auto-generated API). On your own infrastructure, your Cloud Run service is the API layer.

---

## Step 1: Provision a Postgres Database

### Option A — Google Cloud SQL (recommended for Cloud Run)

1. Go to Google Cloud Console → **SQL** → **Create Instance** → **PostgreSQL**
2. Choose PostgreSQL 14 or 15
3. Set an instance ID, root password, and region
4. Create a database called `maritime_sms`
5. Create a user called `app_user` with a strong password
6. Note the connection name: `your-project:your-region:your-instance`

### Option B — Docker (for local development)

```bash
docker run --name maritime-db \
  -e POSTGRES_DB=maritime_sms \
  -e POSTGRES_USER=app_user \
  -e POSTGRES_PASSWORD=yourpassword \
  -p 5432:5432 \
  -d postgres:15
```

---

## Step 2: Run the Schema

Connect to your database and run the entire `STANDALONE-SCHEMA.sql` file.

### With Cloud SQL:

```bash
# From your terminal with gcloud authed
psql "host=YOUR_CLOUD_SQL_HOST sslmode=require dbname=maritime_sms user=app_user" \
  -f docs/STANDALONE-SCHEMA.sql
```

### With Docker:

```bash
docker exec -i maritime-db psql -U app_user -d maritime_sms < docs/STANDALONE-SCHEMA.sql
```

### With any Postgres:

```bash
psql "postgresql://app_user:yourpassword@your-host:5432/maritime_sms" \
  -f docs/STANDALONE-SCHEMA.sql
```

This creates all 20 tables, enables RLS on every table, creates all security policies, helper functions, indexes, and seed data.

---

## Step 3: The Auth Layer — How It Works

Supabase provides `auth.users` (a managed user table) and `auth.uid()` (returns the current user from a JWT). The standalone schema replaces these:

### What the schema creates:

- **`auth.users`** — a simple users table with `id`, `email`, `encrypted_password`. You can extend this with more columns (name, phone, MFA secret, etc.) for your business.
- **`auth.uid()`** — a function that reads the user ID from a Postgres session variable called `request.jwt.claim.sub`.

### How your Cloud Run backend uses it:

On every incoming request, your backend:

1. Verifies the JWT token sent by the browser
2. Extracts the user's UUID from the JWT
3. Opens a database connection
4. Runs: `SET LOCAL request.jwt.claim.sub = '<user-uuid>';`
5. Then runs whatever query the app needs

After that `SET LOCAL`, all the RLS policies and helper functions (`is_super_admin()`, `auth_tenant_id()`, etc.) work exactly as they did on Supabase — they read `auth.uid()` which reads that session variable.

### If you use a different auth provider (Auth0, Firebase, Keycloak):

Replace the `auth.uid()` function body with whatever reads the user ID from your session. For example, if your middleware sets a different GUC:

```sql
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$;
```

---

## Step 4: Build Your API Backend (Cloud Run)

Your Cloud Run service is a thin API layer. Here's a minimal Node.js/Express example:

```javascript
const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: 5432,
  database: 'maritime_sms',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: true,
});

const app = express();
app.use(express.json());

// Auth middleware — verifies JWT and sets DB session variable
async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.sub;

    // Set the session variable so auth.uid() works in RLS policies
    const client = await pool.connect();
    await client.query(`SET LOCAL request.jwt.claim.sub = $1`, [req.userId]);
    req.db = client;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Example: GET /api/vessels
app.get('/api/vessels', authMiddleware, async (req, res) => {
  try {
    const result = await req.db.query('SELECT * FROM vessels');
    res.json(result.rows);
  } finally {
    req.db.release();
  }
});

// Example: POST /api/audit-logs
app.post('/api/audit-logs', authMiddleware, async (req, res) => {
  try {
    const { category, action, target } = req.body;
    const result = await req.db.query(
      `INSERT INTO audit_logs (actor_email, category, action, target)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.userEmail, category, action, target]
    );
    res.json(result.rows[0]);
  } finally {
    req.db.release();
  }
});

app.listen(8080, () => console.log('API running on port 8080'));
```

### Deploy to Cloud Run:

```bash
gcloud run deploy maritime-api \
  --source . \
  --region us-central1 \
  --set-env-vars DB_HOST=YOUR_CLOUD_SQL_HOST \
  --set-env-vars DB_USER=app_user \
  --set-env-vars DB_PASSWORD=yourpassword \
  --set-env-vars JWT_SECRET=your-jwt-secret
```

---

## Step 5: Update Your Frontend

In your React app, replace the Supabase client with calls to your Cloud Run API. For example, change:

```typescript
// OLD — talking to Supabase directly
const { data } = await supabase.from('vessels').select('*');
```

To:

```typescript
// NEW — talking to your own API
const res = await fetch('https://maritime-api-xxxx.run.app/api/vessels', {
  headers: { Authorization: `Bearer ${jwtToken}` },
});
const data = await res.json();
```

You don't need to change every call at once. You can migrate endpoint by endpoint.

---

## The 20 Tables at a Glance

| # | Table | Purpose |
|---|-------|---------|
| 1 | `super_admins` | Platform-level staff (you) |
| 2 | `tenants` | Shipping company accounts |
| 3 | `tenant_users` | People within each company |
| 4 | `vessels` | Ship profiles |
| 5 | `crew_assignments` | Who is signed onto which vessel |
| 6 | `sms_documents` | Safety management document tree |
| 7 | `audit_logs` | Immutable security audit trail |
| 8 | `sms_delta_packages` | Satellite sync patches |
| 9 | `sms_profiles` | Fleet-wide SMS templates |
| 10 | `sms_profile_vessels` | Vessel-to-profile assignments |
| 11 | `tenant_feature_flags` | Per-tenant module on/off |
| 12 | `tenant_sync_config` | Sync frequency settings |
| 13 | `sms_document_versions` | Document revision history |
| 14 | `vessel_sync_outbox` | Bottom-up sync queue |
| 15 | `vessel_sync_state` | Per-vessel connectivity status |
| 16 | `module_definitions` | Platform-wide module display names |
| 17 | `user_session_tokens` | Single login enforcement |
| 18 | `tenant_security_settings` | Inactivity timeout config |
| 19 | `rank_permissions` | What each rank can do in each app |
| 20 | `tenant_rank_definitions` | Custom rank labels per company |

---

## How to Customize for Your Business

### Add a new column to an existing table

```sql
ALTER TABLE vessels ADD COLUMN beam numeric;
```

### Add a completely new table

```sql
CREATE TABLE maintenance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vessel_id uuid NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  component text NOT NULL,
  description text,
  logged_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE maintenance_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select_own_maintenance" ON maintenance_logs
  FOR SELECT TO authenticated
  USING (tenant_id = auth_tenant_id());
```

### Change a security rule

Edit the RLS policy. For example, to let DPAs also create vessels (not just company admins):

```sql
DROP POLICY "vessels_tenant_company_admin_write" ON vessels;
CREATE POLICY "vessels_tenant_write" ON vessels
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
```

### Rename a module in the UI

```sql
UPDATE module_definitions SET display_name = 'Certs' WHERE feature_key = 'certification_manager';
```

---

## Security Checklist for Self-Hosting

- [ ] Database only accepts connections from your Cloud Run service (use private IP or Cloud SQL connector)
- [ ] Never expose the database port to the public internet
- [ ] JWT secret is stored in Google Secret Manager, not in code
- [ ] Database password is stored in Secret Manager
- [ ] Every request to your API verifies the JWT before touching the database
- [ ] RLS stays enabled on every table — do not disable it
- [ ] Run `SET LOCAL request.jwt.claim.sub` on every connection before queries
- [ ] Use connection pooling (PgBouncer or Cloud SQL connector) for production
- [ ] Take automated daily backups (Cloud SQL does this automatically)
- [ ] Enable SSL on all database connections
