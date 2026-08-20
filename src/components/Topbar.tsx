import { useState, useRef, useEffect, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Menu, Search, Bell, HelpCircle, ChevronRight, Printer, X,
  AlertTriangle, ShieldAlert, RefreshCw, Clock, CheckCircle2, BookOpen,
  Server, Lock, Building2, RotateCcw, ExternalLink, CircleDot, Building, UserCircle,
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { SECTIONS } from '../constants';
import { useStore } from '../store';
import { relativeTime } from '../constants';
import type { SectionId, Tenant, InternalUser } from '../types';

// Read/dismissed alert state is persisted to localStorage (same pattern as
// the theme preference in store.tsx) so "mark all as read" / "clear all"
// survive a page refresh instead of resetting on every remount.
function loadIdSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function saveIdSet(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // ignore (e.g. storage disabled/full)
  }
}

function pruneIdSet(ids: Set<string>, liveIds: Set<string>): Set<string> {
  const pruned = [...ids].filter((id) => liveIds.has(id));
  return pruned.length === ids.size ? ids : new Set(pruned);
}

export function Topbar({
  active,
  onMenu,
  onNavigate,
}: {
  active: SectionId;
  onMenu: () => void;
  onNavigate: (id: SectionId) => void;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const allAlerts = useAlerts();
  const [readIds, setReadIds] = useState<Set<string>>(() => loadIdSet('mpc-alerts-read'));
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => loadIdSet('mpc-alerts-dismissed'));
  const alerts = useMemo(() => allAlerts.filter((a) => !dismissedIds.has(a.id)), [allAlerts, dismissedIds]);
  const hasUnreadAlerts = alerts.some((a) => !readIds.has(a.id));

  useEffect(() => { saveIdSet('mpc-alerts-read', readIds); }, [readIds]);
  useEffect(() => { saveIdSet('mpc-alerts-dismissed', dismissedIds); }, [dismissedIds]);

  // Prune ids for alerts that no longer exist (source record aged out of
  // the last-500 window, etc.) so these two sets — and localStorage —
  // don't grow forever. Skipped while allAlerts is still empty: audit/
  // errorLogs/tenants hydrate asynchronously from the backend, so on
  // mount allAlerts is briefly [] before the real data arrives — pruning
  // against that would wipe out everything just loaded from localStorage.
  useEffect(() => {
    if (allAlerts.length === 0) return;
    const liveIds = new Set(allAlerts.map((a) => a.id));
    setReadIds((prev) => pruneIdSet(prev, liveIds));
    setDismissedIds((prev) => pruneIdSet(prev, liveIds));
  }, [allAlerts]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
      // Help drawer is intentionally excluded here: it's portaled to
      // document.body (see HelpDrawer), so its DOM node never lives inside
      // helpRef and this check would treat every click inside the drawer
      // as "outside", closing it before its own onClick handlers (SOP
      // toggles, quick-reference links) ever fire. Its own backdrop click
      // handler covers outside-click-to-close instead.
    }
    if (notifOpen || searchOpen) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [notifOpen, searchOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setNotifOpen(false); setHelpOpen(false); setSearchOpen(false); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const section = SECTIONS.find((s) => s.id === active);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-200/70 bg-white/80 px-4 backdrop-blur-md dark:border-ink-800 dark:bg-ink-900/80 sm:px-6">
      <button onClick={onMenu} className="btn-ghost rounded-lg p-2 lg:hidden print:hidden">
        <Menu className="h-5 w-5" />
      </button>

      <div className="hidden items-center gap-2 text-xs text-ink-400 sm:flex">
        <span>Console</span>
        <ChevronRight className="h-3 w-3" />
        <span className="font-medium text-ink-700 dark:text-ink-200">{section?.label}</span>
      </div>

      <div className="ml-auto flex items-center gap-2 print:hidden">
        <div className="relative hidden md:block" ref={searchRef}>
          <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} onNavigate={onNavigate} />
        </div>

        {/* Print button */}
        <button
          onClick={() => window.print()}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-600 transition-colors hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700"
          title="Print this page"
          aria-label="Print"
        >
          <Printer className="h-4 w-4" />
        </button>

        {/* Notifications popover */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen((o) => !o)}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-600 transition-colors hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700"
            title="System alerts"
            aria-label="Notifications"
            aria-expanded={notifOpen}
          >
            <Bell className="h-4 w-4" />
            {hasUnreadAlerts && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger-500 ring-2 ring-white dark:ring-ink-800" />}
          </button>
          {notifOpen && (
            <NotificationsPopover
              alerts={alerts}
              readIds={readIds}
              onMarkRead={(id) => setReadIds((prev) => new Set([...prev, id]))}
              onMarkAllRead={() => setReadIds(new Set(alerts.map((a) => a.id)))}
              onDismiss={(id) => setDismissedIds((prev) => new Set([...prev, id]))}
              onClearAll={() => setDismissedIds((prev) => new Set([...prev, ...alerts.map((a) => a.id)]))}
              onClose={() => setNotifOpen(false)}
            />
          )}
        </div>

        {/* Help drawer trigger */}
        <div className="relative z-50" ref={helpRef}>
          <button
            onClick={() => setHelpOpen((o) => !o)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-600 transition-colors hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700"
            title="Admin guidance & SOPs"
            aria-label="Help"
            aria-expanded={helpOpen}
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          <HelpDrawer
            open={helpOpen}
            onClose={() => setHelpOpen(false)}
            onNavigate={(id) => { onNavigate(id); setHelpOpen(false); }}
          />
        </div>

        <ThemeToggle />
      </div>
    </header>
  );
}

type NotifTone = 'danger' | 'warning' | 'info';

interface AlertItem {
  id: string;
  tone: NotifTone;
  icon: ReactNode;
  title: string;
  detail: string;
  source: string;
  ts: string;
}

function useAlerts(): AlertItem[] {
  const { audit, errorLogs, tenants } = useStore();

  return useMemo(() => [
    // Sync errors from error logs
    ...errorLogs
      .filter((e) => e.level === 'critical' || e.level === 'error')
      .slice(0, 4)
      .map((e) => ({
        id: `err-${e.id}`,
        tone: (e.level === 'critical' ? 'danger' : 'warning') as NotifTone,
        icon: <RefreshCw className="h-4 w-4" />,
        title: `Sync error: ${e.source}`,
        detail: e.message,
        source: e.tenantId ?? 'platform',
        ts: e.ts,
      })),
    // Impersonation events from audit log
    ...audit
      .filter((a) => a.impersonation)
      .slice(0, 3)
      .map((a) => ({
        id: `imp-${a.id}`,
        tone: 'danger' as NotifTone,
        icon: <ShieldAlert className="h-4 w-4" />,
        title: `Impersonation: ${a.action}`,
        detail: `Actor ${a.actor} → ${a.target}`,
        source: a.companyId ?? 'platform',
        ts: a.ts,
      })),
    // Subscription renewal warnings (contracts expiring within 60 days)
    ...tenants
      .filter((t) => {
        const days = Math.ceil((new Date(t.contractExpires).getTime() - Date.now()) / 86400000);
        return days >= 0 && days <= 60 && t.status !== 'archived';
      })
      .slice(0, 4)
      .map((t) => ({
        id: `ren-${t.id}`,
        tone: 'warning' as NotifTone,
        icon: <Clock className="h-4 w-4" />,
        title: `Renewal warning: ${t.company}`,
        detail: `Contract expires ${relativeTime(t.contractExpires)}`,
        source: t.id,
        ts: t.contractExpires,
      })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, 10), [audit, errorLogs, tenants]);
}

function NotificationsPopover({
  alerts,
  readIds,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClearAll,
  onClose,
}: {
  alerts: AlertItem[];
  readIds: Set<string>;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const unread = alerts.filter((a) => !readIds.has(a.id));

  const toneStyles: Record<NotifTone, string> = {
    danger: 'text-danger-600 bg-danger-50 dark:text-danger-400 dark:bg-danger-900/30',
    warning: 'text-warning-600 bg-warning-50 dark:text-warning-400 dark:bg-warning-900/30',
    info: 'text-primary-600 bg-primary-50 dark:text-primary-400 dark:bg-primary-900/30',
  };

  return (
    <>
      {/* No fixed full-viewport backdrop here: the header's backdrop-blur
          makes it the containing block for `position: fixed` descendants,
          which would confine such a backdrop to the header's own box
          instead of the viewport. Outside clicks are already handled by
          the mousedown listener in Topbar via notifRef. */}
      <div className="absolute right-0 top-12 z-40 w-80 max-w-[calc(100vw-2rem)] origin-top-right animate-fade-in rounded-xl border border-ink-200 bg-white shadow-elev-3 dark:border-ink-700 dark:bg-ink-900 sm:w-96">
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-800">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-ink-500" />
            <h3 className="text-sm font-bold text-ink-900 dark:text-white">System Alerts</h3>
            {unread.length > 0 && <span className="badge bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300">{unread.length} new</span>}
          </div>
          <button onClick={onClose} className="btn-ghost rounded-md p-1 text-ink-400 hover:text-ink-700 dark:hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {alerts.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 className="h-8 w-8 text-success-500" />
              <p className="text-sm font-medium text-ink-600 dark:text-ink-300">All clear — no active alerts</p>
            </div>
          )}
          {alerts.map((a) => {
            const isRead = readIds.has(a.id);
            return (
              <div
                key={a.id}
                className={`flex items-start gap-3 border-b border-ink-50 px-4 py-3 transition-colors last:border-0 dark:border-ink-800/50 ${isRead ? 'opacity-60' : 'bg-ink-50/40 dark:bg-ink-800/20'}`}
              >
                <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneStyles[a.tone]}`}>
                  {a.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-ink-800 dark:text-ink-100">{a.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-ink-500 dark:text-ink-400">{a.detail}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-400">
                    <CircleDot className="h-2.5 w-2.5" />
                    {a.source} · {relativeTime(a.ts)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button
                    onClick={() => onDismiss(a.id)}
                    className="rounded-md p-0.5 text-ink-300 transition-colors hover:bg-ink-100 hover:text-ink-600 dark:text-ink-500 dark:hover:bg-ink-800 dark:hover:text-ink-200"
                    aria-label="Clear this alert"
                    title="Clear"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  {!isRead && (
                    <button
                      onClick={() => onMarkRead(a.id)}
                      className="text-[10px] font-semibold text-primary-600 hover:underline dark:text-primary-400"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {alerts.length > 0 && (
          <div className="flex items-center gap-2 border-t border-ink-100 px-4 py-2.5 dark:border-ink-800">
            {unread.length > 0 && (
              <button onClick={onMarkAllRead} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/20">
                <CheckCircle2 className="h-3.5 w-3.5" /> Mark all as read
              </button>
            )}
            <button onClick={onClearAll} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800">
              <X className="h-3.5 w-3.5" /> Clear all
            </button>
          </div>
        )}
      </div>
    </>
  );
}

const SOP_SECTIONS = [
  {
    id: 'multi-tenant',
    icon: <Building2 className="h-5 w-5" />,
    title: 'Multi-Tenant Rules',
    summary: 'Tenant isolation, data segregation, and RBAC enforcement',
    steps: [
      'Every tenant is isolated by tenant_id — RLS policies enforce that users only access rows where auth.uid() matches their tenant claim.',
      'Super Admins can impersonate tenant sessions via the Impersonation control. All impersonation actions are recorded in the immutable audit ledger with actor, target, and timestamp.',
      'When provisioning a new tenant, use the Provisioning module — it generates the tenant record, assigns the plan tier, and bootstraps the initial admin user in one transaction.',
      'Archiving a tenant soft-disables access but preserves data. Hard deletion requires the 4-step Critical Action Wizard with explicit confirmation phrase.',
      'Internal roles (Platform Auditor, Global Support Staff) are scoped via the capability matrix — they see only the console sections their role permits.',
    ],
  },
  {
    id: 'backup-restore',
    icon: <Server className="h-5 w-5" />,
    title: 'Backup Restoration',
    summary: 'Isolated snapshot restore and tenant data recovery',
    steps: [
      'Snapshots are captured per-tenant on a configurable schedule (default: 24h). Each snapshot includes full database state, SMS templates, and document trees.',
      'To restore, navigate to Backups → locate the snapshot → click the restore icon. This opens an isolated-restore confirmation modal.',
      'Restoration is non-destructive: it writes to a staging schema first, allowing verification before promotion to production.',
      'For emergency full-platform restore, contact the on-call SRE — this bypasses the self-service flow and requires Super-Admin + SRE dual authorization.',
      'Expired snapshots are auto-purged after their retention window. Manually deleting a snapshot requires the Critical Action Wizard.',
    ],
  },
  {
    id: 'lockdown',
    icon: <Lock className="h-5 w-5" />,
    title: 'Emergency Lockdown',
    summary: 'Incident response: revoke sessions and freeze tenant access',
    steps: [
      'Navigate to User & Role Configuration → Quick Account Actions → Emergency Account Lockdown to suspend a company outright.',
      'Session Revocation: instantly invalidates all active JWT sessions for a specific tenant or the entire platform. Users are force-logged-out on next API call.',
      'Tenant Freeze: blocks SMS document edits for a tenant while preserving read access for forensic analysis. Toggle via Workspace Freeze under SMS Documentation → Governance & Override Controls (select the tenant in Inspector Mode first).',
      'Maintenance Banner: broadcast a platform-wide notice via the Maintenance Banner control. This appears at the top of every tenant vessel and company portal.',
      'Post-incident: lift the lockdown by reversing each control in reverse order (banner → freeze → sessions). Document the incident in the audit ledger with severity: critical.',
    ],
  },
];

function HelpDrawer({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (id: SectionId) => void }) {
  const [openSop, setOpenSop] = useState<string | null>(SOP_SECTIONS[0].id);

  // Stays mounted for the duration of the exit transition after `open`
  // flips to false, so the drawer can slide/fade out instead of vanishing
  // instantly.
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // A single rAF isn't reliably enough for the browser to paint the
      // "closed" (translate-x-full/opacity-0) state before we flip to
      // "open" — the two can land in the same paint and the transition
      // has no starting point to animate from. Two nested rAFs guarantee
      // at least one full paint happens in between.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true));
      });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    setVisible(false);
    const t = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(t);
  }, [open]);

  if (!mounted) return null;

  // Portaled to document.body: the header this trigger lives in uses
  // backdrop-blur, which makes it the containing block for `position:
  // fixed` descendants. Left un-portaled, `inset-0` / `h-full` below would
  // resolve against the 64px header box instead of the viewport, collapsing
  // the drawer into a sliver instead of a full-screen slide-out panel.
  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-[220ms] ease-out print:hidden ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-elev-4 transition-transform duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] dark:bg-ink-900 print:hidden ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4 dark:border-ink-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-ink-900 dark:text-white">Admin Guidance</h2>
              <p className="text-xs text-ink-500 dark:text-ink-400">Quick SOPs & operational procedures</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost rounded-lg p-2 text-ink-400 hover:text-ink-700 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Drawer body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-3">
            {SOP_SECTIONS.map((sop) => {
              const isOpen = openSop === sop.id;
              return (
                <div key={sop.id} className="overflow-hidden rounded-xl border border-ink-200 dark:border-ink-800">
                  <button
                    onClick={() => setOpenSop(isOpen ? null : sop.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-50 dark:hover:bg-ink-800/50"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                      {sop.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{sop.title}</p>
                      <p className="truncate text-xs text-ink-500 dark:text-ink-400">{sop.summary}</p>
                    </div>
                    <ChevronRight className={`h-4 w-4 shrink-0 text-ink-400 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="border-t border-ink-100 bg-ink-50/50 px-4 py-3 dark:border-ink-800 dark:bg-ink-800/20">
                      <ol className="space-y-2.5">
                        {sop.steps.map((step, i) => (
                          <li key={i} className="flex items-start gap-2.5">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[10px] font-bold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                              {i + 1}
                            </span>
                            <span className="text-xs leading-relaxed text-ink-600 dark:text-ink-300">{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Quick links */}
          <div className="mt-5 rounded-xl border border-ink-200 bg-ink-50/60 p-4 dark:border-ink-800 dark:bg-ink-800/30">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-400">Quick Reference</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Critical Action Wizard', hint: '4-step safeguard for destructive ops', icon: <ShieldAlert className="h-3.5 w-3.5" />, section: 'tenants' as SectionId },
                { label: 'Isolated Snapshot Restore', hint: 'Non-destructive per-tenant recovery', icon: <RotateCcw className="h-3.5 w-3.5" />, section: 'backups' as SectionId },
                { label: 'Satellite Sync Queue', hint: 'Monitor vessel data sync status', icon: <RefreshCw className="h-3.5 w-3.5" />, section: 'monitoring' as SectionId },
              ].map((link) => (
                <button
                  key={link.label}
                  onClick={() => onNavigate(link.section)}
                  className="flex flex-col items-start gap-1.5 rounded-lg border border-transparent bg-white p-2.5 text-left transition-colors hover:border-primary-200 hover:bg-primary-50/50 dark:bg-ink-900 dark:hover:border-primary-800 dark:hover:bg-primary-900/20"
                >
                  <div className="flex w-full items-center justify-between gap-1.5">
                    <span className="text-primary-500">{link.icon}</span>
                    <ExternalLink className="h-3 w-3 text-ink-300" />
                  </div>
                  <span className="text-xs font-semibold leading-tight text-ink-700 dark:text-ink-200">{link.label}</span>
                  <span className="text-[11px] leading-snug text-ink-400">{link.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Emergency contact */}
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-danger-200 bg-danger-50/40 p-4 dark:border-danger-900/50 dark:bg-danger-900/10">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-600 dark:text-danger-400" />
            <div>
              <p className="text-xs font-bold text-danger-700 dark:text-danger-300">Emergency Response</p>
              <p className="mt-0.5 text-xs text-ink-600 dark:text-ink-400">
                For critical incidents requiring immediate platform intervention, use Emergency Account Lockdown under User &amp; Role Configuration, or escalate to on-call SRE.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

interface SearchResult {
  id: string;
  icon: ReactNode;
  title: string;
  detail: string;
  section: SectionId;
}

function GlobalSearch({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (id: SectionId) => void;
}) {
  const { tenants, internalUsers } = useStore();
  const [query, setQuery] = useState('');

  const results: SearchResult[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const tenantResults: SearchResult[] = (tenants as Tenant[])
      .filter((t) =>
        t.company.toLowerCase().includes(q) ||
        t.contactEmail.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        (t.tenantNo !== undefined && `t-${t.tenantNo}`.includes(q)))
      .slice(0, 5)
      .map((t) => ({
        id: `tenant-${t.id}`,
        icon: <Building className="h-4 w-4" />,
        title: t.company,
        detail: `Tenant · ${t.plan} · ${t.contactEmail}`,
        section: 'tenants' as SectionId,
      }));

    const userResults: SearchResult[] = (internalUsers as InternalUser[])
      .filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .slice(0, 5)
      .map((u) => ({
        id: `user-${u.id}`,
        icon: <UserCircle className="h-4 w-4" />,
        title: u.name,
        detail: `${u.role} · ${u.email}`,
        section: 'users' as SectionId,
      }));

    return [...tenantResults, ...userResults].slice(0, 8);
  }, [query, tenants, internalUsers]);

  const select = (r: SearchResult) => {
    onNavigate(r.section);
    setQuery('');
    onOpenChange(false);
  };

  return (
    <>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); onOpenChange(true); }}
        onFocus={() => onOpenChange(true)}
        placeholder="Search tenants, admins…"
        className="input w-64 pl-9"
      />

      {open && query.trim() !== '' && (
        <div className="absolute right-0 top-11 z-40 w-80 origin-top-right animate-fade-in overflow-hidden rounded-xl border border-ink-200 bg-white shadow-elev-3 dark:border-ink-700 dark:bg-ink-900">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-ink-400">No matches for "{query}"</p>
          ) : (
            <div className="max-h-80 overflow-y-auto py-1">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => select(r)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ink-50 dark:hover:bg-ink-800/50"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                    {r.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-ink-800 dark:text-ink-100">{r.title}</p>
                    <p className="truncate text-xs text-ink-500 dark:text-ink-400">{r.detail}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
