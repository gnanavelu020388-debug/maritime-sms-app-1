import { useState, useEffect, useCallback } from 'react';
import { Megaphone, X, Info, AlertTriangle, AlertOctagon } from 'lucide-react';
import { useStore } from '../store';
import * as api from '../lib/api';
import type { MaintenanceBanner as BannerData } from '../types';
import { Modal } from './Modal';
import { Badge } from './Badge';

const ICONS = { info: Info, warning: AlertTriangle, critical: AlertOctagon };
const TONES = {
  info: 'bg-primary-600 text-white',
  warning: 'bg-warning-500 text-white',
  critical: 'bg-danger-600 text-white',
};
const SEVERITY_LABEL = { info: 'Info', warning: 'Warning', critical: 'Critical' };
const SEVERITY_TONE = { info: 'info', warning: 'warning', critical: 'danger' } as const;

const POLL_INTERVAL_MS = 30_000;

interface BannerRow {
  id: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  published_by: string | null;
  published_at: string;
  tenant_id: string | null;
  tenant_company?: string | null;
}

/** Raw DB row (snake_case) → the shape components render. */
export function mapBannerRow(row: BannerRow): BannerData {
  return {
    id: row.id,
    message: row.message,
    severity: row.severity,
    publishedAt: row.published_at,
    publishedBy: row.published_by ?? 'Platform',
    tenantId: row.tenant_id,
    tenantCompany: row.tenant_company ?? null,
  };
}

function scopeLabel(banner: BannerData): string {
  if (!banner.tenantId) return 'PLATFORM NOTICE';
  return banner.tenantCompany ? `${banner.tenantCompany.toUpperCase()} NOTICE` : 'COMPANY NOTICE';
}

/**
 * MaintenanceBanner — scrolling marquee notice, platform-wide or scoped to
 * a single tenant's users.
 *
 * Renders at the top of every workspace (Super Admin, Company Admin, Vessel
 * Portal). Hovering pauses the scroll; clicking opens a modal with the full
 * untruncated notice; the fixed X button dismisses for the session.
 *
 * Polls the backend (GET /banner) every 30s — the backend resolves scoping
 * from the caller's own JWT, so each viewer only ever gets their own
 * tenant's banner (or the platform-wide one), never another tenant's.
 */
export function MaintenanceBanner() {
  const { maintenance, dispatch } = useStore();
  const [locallyDismissed, setLocallyDismissed] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const row = await api.apiGetBanner<BannerRow>();
        if (cancelled) return;
        dispatch({ type: 'MAINTENANCE_REMOTE', banner: row ? mapBannerRow(row) : null });
      } catch {
        // transient network error — keep showing the last known banner
      }
    };
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [dispatch]);

  // Reset dismiss when a different banner arrives
  useEffect(() => {
    if (maintenance) setLocallyDismissed(false);
  }, [maintenance?.id]);

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setLocallyDismissed(true);
  }, []);

  if (!maintenance || locallyDismissed) return null;

  const Icon = ICONS[maintenance.severity];
  const scrollText = `${scopeLabel(maintenance)} — ${maintenance.message}`;
  const displayText = `${scrollText}     •     ${scrollText}     •     `;

  return (
    <>
      <div
        className={`relative z-40 flex items-center gap-2 py-2 text-sm font-medium shadow-elev-1 cursor-pointer select-none ${TONES[maintenance.severity]} animate-slide-down`}
        onClick={() => setShowModal(true)}
        role="alert"
      >
        {/* Fixed left icon */}
        <div className="flex shrink-0 items-center gap-1.5 pl-3">
          <Icon className="h-4 w-4" />
          <Megaphone className="h-4 w-4 opacity-70" />
        </div>

        {/* Marquee scroll area */}
        <div className="marquee-container relative flex-1 overflow-hidden">
          <div className="marquee-track">
            <span>{displayText}</span>
            <span aria-hidden="true">{displayText}</span>
          </div>
          {/* Fade edges */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-black/20 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-black/20 to-transparent" />
        </div>

        {/* Fixed dismiss button */}
        <button
          onClick={handleDismiss}
          className="mr-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/20 transition-colors hover:bg-white/40"
          aria-label="Dismiss banner"
          title="Dismiss for this session"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Click-to-expand modal */}
      <Modal scrollable
        open={showModal}
        onClose={() => setShowModal(false)}
        title={maintenance.tenantId ? 'Company Notice' : 'Platform Notice'}
        subtitle="Full maintenance announcement"
        icon={<Megaphone className="h-5 w-5" />}
        size="md"
        footer={
          <button onClick={() => setShowModal(false)} className="btn-primary">
            Close
          </button>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge tone={SEVERITY_TONE[maintenance.severity]} dot>
              {SEVERITY_LABEL[maintenance.severity]}
            </Badge>
            <span className="text-xs text-ink-500 dark:text-ink-400">
              {new Date(maintenance.publishedAt).toLocaleString('en-GB', { hour12: false })}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-ink-800 dark:text-ink-100">
            {maintenance.message}
          </p>
          <p className="text-xs text-ink-400">
            Published by {maintenance.publishedBy}
            {maintenance.tenantId && maintenance.tenantCompany ? ` · scoped to ${maintenance.tenantCompany}` : ''}
          </p>
        </div>
      </Modal>
    </>
  );
}

/**
 * StandaloneBanner — for routes outside the StoreProvider context (the
 * login/AuthView). Nobody is authenticated yet, so the backend can only
 * ever resolve the platform-wide banner here — tenant-scoped notices
 * require a session.
 */
export function StandaloneBanner() {
  const [banner, setBanner] = useState<BannerData | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const row = await api.apiGetBanner<BannerRow>();
        if (cancelled) return;
        setBanner(row ? mapBannerRow(row) : null);
      } catch {
        // transient network error — keep showing the last known banner
      }
    };
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (banner) setDismissed(false);
  }, [banner?.id]);

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed(true);
  }, []);

  if (!banner || dismissed) return null;

  const Icon = ICONS[banner.severity];
  const scrollText = `${scopeLabel(banner)} — ${banner.message}`;
  const displayText = `${scrollText}     •     ${scrollText}     •     `;

  return (
    <>
      <div
        className={`relative z-40 flex items-center gap-2 py-2 text-sm font-medium shadow-elev-1 cursor-pointer select-none ${TONES[banner.severity]} animate-slide-down`}
        onClick={() => setShowModal(true)}
        role="alert"
      >
        <div className="flex shrink-0 items-center gap-1.5 pl-3">
          <Icon className="h-4 w-4" />
          <Megaphone className="h-4 w-4 opacity-70" />
        </div>
        <div className="marquee-container relative flex-1 overflow-hidden">
          <div className="marquee-track">
            <span>{displayText}</span>
            <span aria-hidden="true">{displayText}</span>
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-black/20 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-black/20 to-transparent" />
        </div>
        <button
          onClick={handleDismiss}
          className="mr-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/20 transition-colors hover:bg-white/40"
          aria-label="Dismiss banner"
          title="Dismiss for this session"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <Modal scrollable
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Platform Notice"
        subtitle="Full maintenance announcement"
        icon={<Megaphone className="h-5 w-5" />}
        size="md"
        footer={
          <button onClick={() => setShowModal(false)} className="btn-primary">
            Close
          </button>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge tone={SEVERITY_TONE[banner.severity]} dot>
              {SEVERITY_LABEL[banner.severity]}
            </Badge>
            <span className="text-xs text-ink-500 dark:text-ink-400">
              {new Date(banner.publishedAt).toLocaleString('en-GB', { hour12: false })}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-ink-800 dark:text-ink-100">
            {banner.message}
          </p>
          <p className="text-xs text-ink-400">
            Published by {banner.publishedBy}
          </p>
        </div>
      </Modal>
    </>
  );
}
