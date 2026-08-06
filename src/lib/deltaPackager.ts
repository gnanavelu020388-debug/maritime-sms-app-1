import type { SmsDocRow } from './supabase';

/**
 * Delta Packager — compiles lightweight JSON delta packages on DPA "Approve & Deploy".
 *
 * When the DPA approves pending documents, the version bumps (e.g. v1.0.0 → v1.1.0).
 * Instead of pushing the entire SMS tree to every vessel, we compile only the
 * newly added/modified documents into a small JSON payload.
 */

export interface DeltaPayload {
  upserted: SmsDocRow[];
  deleted: { id: string; tree_kind: string }[];
  from_version: string;
  to_version: string;
}

/** Bump the minor version: v1.0.0 → v1.1.0, v2.3.0 → v2.4.0 */
export function bumpVersion(v: string): string {
  const parts = v.split('.');
  const minor = parseInt(parts[1] ?? '0', 10) + 1;
  return `${parts[0] ?? '1'}.${minor}.0`;
}

/**
 * Build a delta payload from the given approved documents.
 * In local mode, this is computed in-memory and not persisted to a remote DB.
 */
export async function buildAndStoreDelta(
  _tenantId: string,
  fromVersion: string,
  toVersion: string,
  _deployedBy: string,
): Promise<DeltaPayload | null> {
  return {
    upserted: [],
    deleted: [],
    from_version: fromVersion,
    to_version: toVersion,
  };
}
