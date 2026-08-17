import { Storage } from '@google-cloud/storage';
import dotenv from 'dotenv';

dotenv.config();

let storageClient = null;

function getStorage() {
  if (storageClient) return storageClient;
  const opts = {};
  if (process.env.GCP_PROJECT_ID) opts.projectId = process.env.GCP_PROJECT_ID;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    opts.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  storageClient = new Storage(opts);
  return storageClient;
}

export function getBucketName() {
  return process.env.GCS_BUCKET_NAME || 'maritime-sms-platform-docs';
}

// Returns the bare `tenants/...` object path (not a `gs://` URI) — every
// other consumer (isGcsPath on the frontend, the signed-url endpoint's
// tenantOwnsPath check, the delete endpoint) works off that bare-path
// convention, so returning anything else here breaks preview/print/delete
// for every file uploaded through this function.
export async function uploadFile(filePath, buffer, contentType = 'application/octet-stream') {
  const storage = getStorage();
  const bucket = storage.bucket(getBucketName());
  const file = bucket.file(filePath);
  await file.save(buffer, { contentType });
  return filePath;
}

// Streams the object directly through our own server instead of handing the
// browser a GCS URL. Unlike getSignedReadUrl, this needs no signing
// capability (no client_email/private key) — it works with plain
// Application Default Credentials, which is what local development has
// (a `gcloud auth application-default login` user account can read objects
// it has IAM access to, it just can't sign a URL on GCS's behalf).
export function getObjectStream(filePath) {
  const storage = getStorage();
  const bucket = storage.bucket(getBucketName());
  return bucket.file(filePath).createReadStream();
}

export async function getSignedReadUrl(filePath, expiresInMinutes = 15) {
  const storage = getStorage();
  const bucket = storage.bucket(getBucketName());
  const file = bucket.file(filePath);
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
  });
  return url;
}

export async function getSignedUploadUrl(filePath, contentType, expiresInMinutes = 15) {
  const storage = getStorage();
  const bucket = storage.bucket(getBucketName());
  const file = bucket.file(filePath);
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
    contentType,
  });
  return url;
}

export async function deleteFile(filePath) {
  const storage = getStorage();
  const bucket = storage.bucket(getBucketName());
  await bucket.file(filePath).delete();
}

// Deletes every object under tenants/{tenantId}/ — used by
// server/resetDemoStorage.js to clean up demo/test objects.
export async function deleteTenantPrefix(tenantId) {
  const storage = getStorage();
  const bucket = storage.bucket(getBucketName());
  await bucket.deleteFiles({ prefix: `tenants/${tenantId}/` });
}

export async function getTenantStorageBytes(tenantId) {
  const storage = getStorage();
  const bucket = storage.bucket(getBucketName());
  const prefix = `tenants/${tenantId}/`;
  let total = 0;
  let query = { prefix, maxResults: 1000 };
  do {
    const [files, nextQuery] = await bucket.getFiles(query);
    for (const file of files) total += Number(file.metadata.size || 0);
    query = nextQuery;
  } while (query);
  return total;
}

// Platform-wide actual usage — deliberately scoped to the `tenants/` prefix
// (the application's storage boundary) so any incidental non-tenant objects
// elsewhere in the bucket are not counted.
export async function getPlatformStorageBytes() {
  const storage = getStorage();
  const bucket = storage.bucket(getBucketName());
  let total = 0;
  let query = { prefix: 'tenants/', maxResults: 1000 };
  do {
    const [files, nextQuery] = await bucket.getFiles(query);
    for (const file of files) total += Number(file.metadata.size || 0);
    query = nextQuery;
  } while (query);
  return total;
}
