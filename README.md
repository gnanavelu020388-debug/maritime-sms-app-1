# SMS

## Deployment and CI/CD

This repository includes a GitHub Actions workflow at `.github/workflows/gcp-cloud-run.yml` that:

- runs `npm ci`, `npm run lint`, `npm run typecheck`, and `npm run build`
- deploys to Google Cloud Run from the `main` branch
- uses the Dockerfile in the repository for production builds

### Required GitHub secrets

- `GCP_PROJECT_ID`
- `GCP_SA_KEY` (service account JSON key)
- `GCP_REGION`
- `CLOUD_RUN_SERVICE` (existing Cloud Run service name)
- `JWT_SECRET`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `GCS_BUCKET_NAME`
- `CLOUD_SQL_CONNECTION_NAME` (optional, use if your service connects to Cloud SQL via Unix socket)

You can configure secrets on GitHub under `Settings > Secrets and variables > Actions`.

To deploy the latest changes, merge or push to `main`. The workflow will build the app and update the existing Cloud Run service automatically.

## Alternative: Cloud Build deploy without GitHub Actions

The repository also includes `cloudbuild.yaml` so you can use Google Cloud Build instead of GitHub Actions.

1. In GCP Console, go to **Cloud Build > Triggers**.
2. Create a trigger for your repository and branch `main`.
3. Use the existing `cloudbuild.yaml` in the repo.
4. Set substitutions:
   - `_CLOUD_RUN_SERVICE` = your existing Cloud Run service name
   - `_CLOUD_RUN_REGION` = your Cloud Run region
5. In Cloud Run, ensure the service has the correct environment variables configured, or update them manually after deployment.

This makes commits to `main` trigger a build and deploy directly from GCP.

### Notes

- Use `.env.example` to keep local environment variables consistent.
- Update `server/db.js` or `.env.example` only if your database connection details change.

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-mmd3tyjh)
