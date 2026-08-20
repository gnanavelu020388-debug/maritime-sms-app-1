import { useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, Loader2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../lib/auth';
import * as api from '../lib/api';

// Mandatory gate shown after login when the account's password was set by an
// admin (tenant_users.must_change_password) rather than chosen by the user.
// Intentionally has no close/dismiss affordance besides signing out.
export function ChangePasswordModal() {
  const { signOut, clearMustChangePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await api.apiChangePassword(password);
      clearMustChangePassword();
    } catch (err) {
      setError((err as Error).message || 'Failed to update password.');
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex min-h-screen w-screen items-center justify-center bg-ink-950/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-6 shadow-elev-4 dark:border-ink-800 dark:bg-ink-900">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-ink-900 dark:text-white">Set a new password</h2>
            <p className="text-sm text-ink-500 dark:text-ink-400">Your password was set by an administrator. Choose your own before continuing.</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">New Password</label>
            <div className="relative">
              <input
                className="input pr-10"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                autoFocus
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="label">Confirm Password</label>
            <div className="relative">
              <input
                className="input pr-10"
                type={showConfirm ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirm((visible) => !visible)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
                title={showConfirm ? 'Hide password' : 'Show password'}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {error && (
            <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/20 dark:text-danger-400">
              {error}
            </div>
          )}
          <div className="flex items-center justify-between pt-1">
            <button type="button" onClick={signOut} className="btn-secondary">
              Sign Out
            </button>
            <button type="submit" disabled={busy} className="btn-primary flex items-center gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Set Password
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
