import { useState } from 'react';
import { UploadCloud, RefreshCw, CheckCircle2, X, AlertTriangle } from 'lucide-react';
import { useNetwork } from '../lib/networkContext';

export function ReconnectionBanner() {
  const { mode, online, pendingActions, flushQueue, setMode } = useNetwork();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ synced: number; failed: number } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Show when cloud is reachable but we're in offline mode, or when
  // we just switched to online and have pending actions to flush.
  const showSyncPrompt = online && mode === 'offline' && pendingActions > 0 && !dismissed && !result;
  const showSyncComplete = result !== null && !dismissed;

  if (!showSyncPrompt && !showSyncComplete) return null;

  async function handleSync() {
    setSyncing(true);
    setMode('online');
    // Small delay to let the API base switch
    await new Promise((r) => setTimeout(r, 200));
    const res = await flushQueue();
    setResult(res);
    setSyncing(false);
  }

  if (showSyncComplete && result) {
    const allSynced = result.failed === 0;
    return (
      <div className="flex items-center gap-3 border-b px-4 py-2.5 text-sm ${
        allSynced
          ? 'border-success-200 bg-success-50 dark:border-success-800/60 dark:bg-success-900/20'
          : 'border-warning-200 bg-warning-50 dark:border-warning-800/60 dark:bg-warning-900/20'
      }">
        {allSynced ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success-600 dark:text-success-400" />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning-600 dark:text-warning-400" />
        )}
        <span className={allSynced ? 'text-success-700 dark:text-success-300' : 'text-warning-700 dark:text-warning-300'}>
          {allSynced
            ? `${result.synced} action${result.synced !== 1 ? 's' : ''} synced to Cloud Run successfully.`
            : `${result.synced} synced, ${result.failed} failed. Failed actions remain queued for retry.`}
        </span>
        <button
          onClick={() => { setResult(null); setDismissed(true); }}
          className="ml-auto rounded p-1 text-ink-400 hover:text-ink-600 dark:hover:text-ink-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 border-b border-warning-200 bg-warning-50 px-4 py-2.5 text-sm dark:border-warning-800/60 dark:bg-warning-900/20">
      <UploadCloud className="h-4 w-4 shrink-0 text-warning-600 dark:text-warning-400" />
      <span className="text-warning-700 dark:text-warning-300">
        Cloud Run is reachable again. {pendingActions} offline action{pendingActions !== 1 ? 's' : ''} ready to sync.
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
        >
          {syncing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <UploadCloud className="h-3 w-3" />}
          {syncing ? 'Syncing…' : 'Sync Now'}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="rounded p-1 text-ink-400 hover:text-ink-600 dark:hover:text-ink-200"
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
