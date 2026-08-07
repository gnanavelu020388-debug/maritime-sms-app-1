import { useState, useRef, useEffect } from 'react';
import { Wifi, WifiOff, Cloud, HardDrive, ChevronDown, RefreshCw, CheckCircle2, AlertTriangle, UploadCloud } from 'lucide-react';
import { useNetwork } from '../lib/networkContext';

export function NetworkStatusBadge({ compact = false }: { compact?: boolean }) {
  const { mode, online, checking, lastChecked, pendingActions, toggleMode, checkHealth, setMode, flushQueue } = useNetwork();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const isOnline = mode === 'online';
  const dotColor = isOnline ? (online ? 'bg-success-500' : 'bg-warning-500') : 'bg-warning-500';
  const bgColor = isOnline
    ? 'border-success-200 bg-success-50/80 text-success-700 dark:border-success-800/60 dark:bg-success-900/20 dark:text-success-400'
    : 'border-warning-200 bg-warning-50/80 text-warning-700 dark:border-warning-800/60 dark:bg-warning-900/20 dark:text-warning-400';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:shadow-sm ${bgColor}`}
        title={isOnline ? 'ONLINE — Cloud Run' : 'OFFLINE — Local Docker'}
      >
        {isOnline ? <Cloud className="h-3.5 w-3.5" /> : <HardDrive className="h-3.5 w-3.5" />}
        <span className={`inline-block h-2 w-2 rounded-full ${dotColor} ${checking ? 'animate-pulse' : ''}`} />
        <span>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
        {!compact && pendingActions > 0 && (
          <span className="rounded-full bg-warning-500 px-1.5 text-[10px] font-bold text-white">{pendingActions}</span>
        )}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-72 origin-top-right animate-fade-in rounded-xl border border-ink-200 bg-white shadow-elev-3 dark:border-ink-700 dark:bg-ink-900">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-800">
            <div className="flex items-center gap-2">
              {isOnline ? <Cloud className="h-4 w-4 text-success-500" /> : <HardDrive className="h-4 w-4 text-warning-500" />}
              <span className="text-sm font-bold text-ink-900 dark:text-white">Network Status</span>
            </div>
            <button
              onClick={() => void checkHealth()}
              disabled={checking}
              className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-600 dark:hover:bg-ink-800"
              title="Re-check connectivity"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Status info */}
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-500 dark:text-ink-400">Cloud Reachable</span>
              <span className={`flex items-center gap-1 font-semibold ${online ? 'text-success-600 dark:text-success-400' : 'text-warning-600 dark:text-warning-400'}`}>
                {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {online ? 'Yes' : 'No'}
              </span>
            </div>

            {lastChecked && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-ink-500 dark:text-ink-400">Last Checked</span>
                <span className="font-medium text-ink-600 dark:text-ink-300">
                  {new Date(lastChecked).toLocaleTimeString()}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-500 dark:text-ink-400">Active Endpoint</span>
              <span className="font-medium text-ink-600 dark:text-ink-300">
                {isOnline ? 'Cloud Run' : 'Local Docker'}
              </span>
            </div>

            {pendingActions > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-ink-500 dark:text-ink-400">Pending Sync</span>
                <span className="flex items-center gap-1 font-semibold text-warning-600 dark:text-warning-400">
                  <AlertTriangle className="h-3 w-3" /> {pendingActions} queued
                </span>
              </div>
            )}
          </div>

          {/* Mode toggle */}
          <div className="border-t border-ink-100 px-4 py-3 dark:border-ink-800">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-ink-400">Mode</p>
            <div className="flex gap-1 rounded-lg bg-ink-100 p-1 dark:bg-ink-800">
              <ModeButton
                active={mode === 'online'}
                onClick={() => setMode('online')}
                icon={<Cloud className="h-3.5 w-3.5" />}
                label="Online"
              />
              <ModeButton
                active={mode === 'offline'}
                onClick={() => setMode('offline')}
                icon={<HardDrive className="h-3.5 w-3.5" />}
                label="Offline"
              />
            </div>
          </div>

          {/* Flush queue */}
          {pendingActions > 0 && online && (
            <div className="border-t border-ink-100 px-4 py-3 dark:border-ink-800">
              <button
                onClick={async () => { await flushQueue(); }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary-600 py-2 text-xs font-semibold text-white transition hover:bg-primary-700"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                Sync {pendingActions} action{pendingActions !== 1 ? 's' : ''} to Cloud
              </button>
            </div>
          )}

          {pendingActions === 0 && (
            <div className="border-t border-ink-100 px-4 py-2.5 dark:border-ink-800">
              <div className="flex items-center gap-1.5 text-[10px] text-ink-400">
                <CheckCircle2 className="h-3 w-3 text-success-500" />
                All actions synced
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModeButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition ${
        active
          ? 'bg-white text-ink-900 shadow dark:bg-ink-700 dark:text-white'
          : 'text-ink-500 hover:text-ink-700 dark:hover:text-ink-300'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
