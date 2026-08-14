/**
 * Version bumping for DPA "Approve & Deploy" — see deployBaseline.ts.
 *
 * A separate delta-compilation step (packaging only newly-changed documents
 * instead of the full SMS tree) was scaffolded here but never had a real
 * backing store and had no callers — removed rather than left as a
 * fabricated stub. Vessels currently pull the full approved document set
 * on sync (see getLocalDocuments in localVesselDb.ts), which is correct
 * for this fleet's SMS tree sizes; a real delta-only sync would need a
 * server-side changelog table keyed by version, which doesn't exist yet.
 */
export function bumpVersion(v: string): string {
  const parts = v.split('.');
  const minor = parseInt(parts[1] ?? '0', 10) + 1;
  return `${parts[0] ?? '1'}.${minor}.0`;
}
