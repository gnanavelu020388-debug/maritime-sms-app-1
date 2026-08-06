import type { SmsDocRow } from './supabase';

export interface DocVersionRow {
  id: string;
  tenant_id: string;
  document_id: string;
  revision: number;
  version_label: string;
  content: string | null;
  content_kind: string;
  uploaded_by: string | null;
  created_at: string;
}

export async function saveDocumentVersion(
  _tenantId: string,
  doc: SmsDocRow,
  uploadedBy: string
): Promise<DocVersionRow | null> {
  return {
    id: `local-v-${Date.now()}`,
    tenant_id: _tenantId,
    document_id: doc.id,
    revision: parseInt(doc.version.replace(/^v/, '').split('.')[1] ?? '1', 10),
    version_label: doc.version,
    content: doc.content,
    content_kind: doc.content_kind ?? 'rich_text',
    uploaded_by: uploadedBy,
    created_at: new Date().toISOString(),
  };
}

export async function fetchDocumentVersions(
  _tenantId: string,
  _documentId: string
): Promise<DocVersionRow[]> {
  return [];
}

export async function restoreDocumentVersion(
  _tenantId: string,
  _documentId: string,
  _revision: number
): Promise<{ content: string | null; version_label: string } | null> {
  return null;
}
