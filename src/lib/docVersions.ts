import type { SmsDocRow } from './supabase';
import { apiGetDocVersions, apiCreateDocVersion, apiRestoreDocVersion, type DocVersionRow } from './api';

export type { DocVersionRow };

// Snapshots a document's CURRENT (pre-overwrite) state into a real
// sms_document_versions row. Call this before applying new content — see
// server/routes/smsDocuments.js POST /:tenantId/:docId/versions, which
// reads the document's live row itself rather than trusting the caller's
// copy of it (so `doc` here only needs to identify which document).
export async function saveDocumentVersion(
  tenantId: string,
  doc: SmsDocRow,
  uploadedBy: string
): Promise<DocVersionRow | null> {
  try {
    return await apiCreateDocVersion(tenantId, doc.id, uploadedBy);
  } catch (err) {
    console.error('[saveDocumentVersion] API error:', err);
    return null;
  }
}

export async function fetchDocumentVersions(
  tenantId: string,
  documentId: string
): Promise<DocVersionRow[]> {
  try {
    return await apiGetDocVersions(tenantId, documentId);
  } catch (err) {
    console.error('[fetchDocumentVersions] API error:', err);
    return [];
  }
}

export async function restoreDocumentVersion(
  tenantId: string,
  documentId: string,
  revision: number
): Promise<{ content: string | null; version_label: string } | null> {
  try {
    return await apiRestoreDocVersion(tenantId, documentId, revision);
  } catch (err) {
    console.error('[restoreDocumentVersion] API error:', err);
    return null;
  }
}
