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
- `GCS_RUNTIME_SERVICE_ACCOUNT` (the Cloud Run runtime identity, e.g. `maritime-backend@<project>.iam.gserviceaccount.com` — needs `roles/storage.objectUser` on the bucket, `roles/iam.serviceAccountTokenCreator` on itself for signed URLs, `roles/cloudsql.client`, and `roles/logging.logWriter`)
- `CLOUD_SQL_CONNECTION_NAME` (optional, use if your service connects to Cloud SQL via Unix socket)

You can configure secrets on GitHub under `Settings > Secrets and variables > Actions`.

To deploy the latest changes, merge or push to `main`. The workflow will build the app and update the existing Cloud Run service automatically.

## Alternative: Cloud Build deploy without GitHub Actions

The repository also includes `cloudbuild.yaml` so you can use Google Cloud Build instead of GitHub Actions.

1. In GCP Console, go to **Cloud Build > Triggers**.
2. Create a trigger for your repository and branch `main`.
3. Use the existing `cloudbuild.yaml` in the repo.
5. Set substitutions in the trigger for your service configuration:
   - `_CLOUD_RUN_SERVICE` = your existing Cloud Run service name
   - `_CLOUD_RUN_REGION` = your Cloud Run region
   - `_DB_HOST` = your database host or `/cloudsql/<project>:<region>:<instance>` if using Cloud SQL socket mode
   - `_DB_PORT` = your database port
   - `_DB_USER` = your database username
   - `_DB_PASSWORD` = your database password
   - `_DB_NAME` = your database name
   - `_JWT_SECRET` = your server JWT secret
   - `_GCS_BUCKET_NAME` = your Cloud Storage bucket name
   - `_GCS_RUNTIME_SERVICE_ACCOUNT` = the Cloud Run runtime service account (needs `roles/storage.objectUser` on the bucket, `roles/iam.serviceAccountTokenCreator` on itself, `roles/cloudsql.client`, `roles/logging.logWriter`)
   - `_CLOUD_SQL_CONNECTION_NAME` = optional Cloud SQL instance connection name for Cloud Run socket attachment
6. In Cloud Run, the trigger will deploy the service with the specified env vars automatically.

This makes commits to `main` trigger a build and deploy directly from GCP with the required backend configuration.

### Notes

- Use `.env.example` to keep local environment variables consistent.
- Update `server/db.js` or `.env.example` only if your database connection details change.

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-mmd3tyjh)
