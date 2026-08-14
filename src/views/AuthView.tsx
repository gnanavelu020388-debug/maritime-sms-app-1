import { useState } from "react";
import { Anchor, Shield, Building2, Loader2, Eye, EyeOff, KeyRound, Copy, Check } from "lucide-react";
import { useAuth } from "../lib/auth";
import { StandaloneBanner } from "../components/MaintenanceBanner";
import { NetworkStatusBadge } from "../components/NetworkStatusBadge";

type LoginStep =
  | { kind: "credentials" }
  | { kind: "mfa_verify"; mfaToken: string }
  | { kind: "mfa_setup_qr"; mfaToken: string; secret: string; otpauthUrl: string }
  | { kind: "mfa_setup_codes"; backupCodes: string[] };

export function AuthView() {
  const { signIn, signUp, completeMfaLogin, mfaSetupInit, mfaSetupVerify, finalizeMfaSetup, error: authError } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [asSuperAdmin, setAsSuperAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<LoginStep>({ kind: "credentials" });
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const displayError = error ?? authError;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    if (mode === "login") {
      const result = await signIn(email, password);
      if (result.mfaRequired && result.mfaToken) {
        setStep({ kind: "mfa_verify", mfaToken: result.mfaToken });
      } else if (result.mfaSetupRequired && result.mfaToken) {
        const mfaToken = result.mfaToken;
        const init = await mfaSetupInit(mfaToken);
        if (init.error || !init.secret || !init.otpauthUrl) {
          setError(init.error || "Could not start MFA setup.");
        } else {
          setStep({ kind: "mfa_setup_qr", mfaToken, secret: init.secret, otpauthUrl: init.otpauthUrl });
        }
      } else if (result.error) {
        setError(result.error);
      }
    } else {
      const { error } = await signUp(
        email,
        password,
        name || email.split("@")[0],
        asSuperAdmin,
      );
      if (error) setError(error);
      else setError("Account created. You can now sign in.");
    }
    setBusy(false);
  };

  const submitMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step.kind !== "mfa_verify") return;
    setError(null);
    setBusy(true);
    const result = await completeMfaLogin(
      step.mfaToken,
      useBackupCode ? { backupCode: code } : { code },
    );
    if (result.error) setError(result.error);
    setBusy(false);
  };

  const submitMfaSetupVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step.kind !== "mfa_setup_qr") return;
    setError(null);
    setBusy(true);
    const result = await mfaSetupVerify(step.mfaToken, code);
    if (result.error) {
      setError(result.error);
    } else if (result.backupCodes) {
      setStep({ kind: "mfa_setup_codes", backupCodes: result.backupCodes });
    }
    setBusy(false);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access denied — user can still select the text manually
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-ink-50 via-primary-50/30 to-ink-100 dark:from-ink-950 dark:via-ink-900 dark:to-ink-950">
      <StandaloneBanner />
      <div className="absolute right-4 top-4 z-10">
        <NetworkStatusBadge />
      </div>
      <div className="flex min-h-[calc(100vh-40px)] items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 text-white shadow-lg">
              <Anchor className="h-7 w-7" />
            </div>
            <h1 className="text-2xl font-bold text-ink-900 dark:text-white">
              Maritime Platform Console
            </h1>
            <p className="text-sm text-ink-500 dark:text-ink-400">
              Multi-tenant safety management & compliance
            </p>
          </div>

          <div className="rounded-2xl border border-ink-200/70 bg-white p-6 shadow-xl dark:border-ink-800 dark:bg-ink-900">
            {step.kind === "credentials" && (
              <>
                <div className="mb-5 flex gap-1 rounded-lg bg-ink-100 p-1 dark:bg-ink-800">
                  <button
                    onClick={() => {
                      setMode("login");
                      setError(null);
                    }}
                    className={`flex-1 rounded-md py-2 text-sm font-semibold transition ${mode === "login" ? "bg-white text-ink-900 shadow dark:bg-ink-700 dark:text-white" : "text-ink-500"}`}
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => {
                      setMode("signup");
                      setError(null);
                    }}
                    className={`flex-1 rounded-md py-2 text-sm font-semibold transition ${mode === "signup" ? "bg-white text-ink-900 shadow dark:bg-ink-700 dark:text-white" : "text-ink-500"}`}
                  >
                    Create Account
                  </button>
                </div>

                <form onSubmit={submit} className="space-y-4">
                  {mode === "signup" && (
                    <div>
                      <label className="label">Full Name</label>
                      <input
                        className="input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="John Mariner"
                        required
                      />
                    </div>
                  )}
                  <div>
                    <label className="label">Email</label>
                    <input
                      className="input"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      required
                    />
                  </div>
                  <div>
                    <label className="label">Password</label>

                    <div className="relative">
                      <input
                        className="input pr-10"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        minLength={4}
                        required
                      />

                      <button
                        type="button"
                        onClick={() => setShowPassword((visible) => !visible)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        title={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  {mode === "signup" && (
                    <label className="flex items-center gap-2 rounded-lg border border-ink-200/70 p-3 dark:border-ink-800">
                      <input
                        type="checkbox"
                        checked={asSuperAdmin}
                        onChange={(e) => setAsSuperAdmin(e.target.checked)}
                        className="h-4 w-4 rounded border-ink-300 text-primary-600"
                      />
                      <span className="flex items-center gap-1.5 text-sm text-ink-700 dark:text-ink-300">
                        <Shield className="h-4 w-4 text-primary-500" />
                        Register as Super Admin (first-run bootstrap)
                      </span>
                    </label>
                  )}
                  {displayError && (
                    <div
                      className={`rounded-lg p-3 text-sm ${displayError.includes("created") ? "bg-success-50 text-success-700 dark:bg-success-900/20 dark:text-success-400" : "bg-danger-50 text-danger-700 dark:bg-danger-900/20 dark:text-danger-400"}`}
                    >
                      {displayError}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={busy}
                    className="btn-primary w-full flex justify-center items-center gap-2 px-3 py-2 rounded-lg"
                  >
                    {busy ? (
                      <Loader2 className="h-6 w-4 animate-spin" strokeWidth={3} />
                    ) : mode === "login" ? (
                      <>
                        <Shield className="h-4 w-4" /> Sign In
                      </>
                    ) : (
                      <>
                        <Building2 className="h-4 w-4" /> Create Account
                      </>
                    )}
                  </button>
                </form>

                <p className="mt-4 text-center text-xs text-ink-400">
                  {mode === "login"
                    ? "Access is role-based. Super Admins, Company Admins, DPAs and Vessel Crew each get a dedicated workspace."
                    : "First account can register as Super Admin. Company Admins must be provisioned by a Super Admin."}
                </p>
              </>
            )}

            {step.kind === "mfa_verify" && (
              <form onSubmit={submitMfaVerify} className="space-y-4">
                <div className="flex flex-col items-center gap-2 text-center">
                  <KeyRound className="h-8 w-8 text-primary-500" />
                  <h2 className="text-lg font-semibold text-ink-900 dark:text-white">Two-factor verification</h2>
                  <p className="text-sm text-ink-500 dark:text-ink-400">
                    {useBackupCode
                      ? "Enter one of your saved backup codes."
                      : "Enter the 6-digit code from your authenticator app."}
                  </p>
                </div>
                <input
                  className="input text-center text-lg tracking-[0.3em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={useBackupCode ? "XXXXX-XXXXX" : "123456"}
                  autoFocus
                  required
                />
                {displayError && (
                  <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/20 dark:text-danger-400">
                    {displayError}
                  </div>
                )}
                <button type="submit" disabled={busy} className="btn-primary w-full flex justify-center items-center gap-2 px-3 py-2 rounded-lg">
                  {busy ? <Loader2 className="h-5 w-4 animate-spin" strokeWidth={3} /> : "Verify & Sign In"}
                </button>
                <button
                  type="button"
                  onClick={() => { setUseBackupCode((v) => !v); setCode(""); setError(null); }}
                  className="w-full text-center text-xs text-ink-500 hover:text-ink-700 dark:hover:text-ink-300"
                >
                  {useBackupCode ? "Use authenticator code instead" : "I don't have my authenticator — use a backup code"}
                </button>
                <button
                  type="button"
                  onClick={() => { setStep({ kind: "credentials" }); setCode(""); setError(null); }}
                  className="w-full text-center text-xs text-ink-400 hover:text-ink-600 dark:hover:text-ink-300"
                >
                  Back to sign in
                </button>
              </form>
            )}

            {step.kind === "mfa_setup_qr" && (
              <form onSubmit={submitMfaSetupVerify} className="space-y-4">
                <div className="flex flex-col items-center gap-2 text-center">
                  <Shield className="h-8 w-8 text-primary-500" />
                  <h2 className="text-lg font-semibold text-ink-900 dark:text-white">Set up two-factor authentication</h2>
                  <p className="text-sm text-ink-500 dark:text-ink-400">
                    Your organization requires MFA. Add this account to an authenticator app (Google Authenticator, Authy, 1Password), then enter the 6-digit code it shows.
                  </p>
                </div>
                <div className="rounded-lg border border-ink-200/70 bg-ink-50 p-3 text-center dark:border-ink-800 dark:bg-ink-800/50">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-400">Manual entry key</p>
                  <div className="flex items-center justify-center gap-1.5">
                    <p className="break-all font-mono text-sm text-ink-800 dark:text-ink-200">{step.secret}</p>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(step.secret)}
                      className="shrink-0 rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-700 dark:hover:text-ink-200"
                      aria-label="Copy manual entry key"
                      title="Copy manual entry key"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-success-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <input
                  className="input text-center text-lg tracking-[0.3em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  autoFocus
                  required
                />
                {displayError && (
                  <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/20 dark:text-danger-400">
                    {displayError}
                  </div>
                )}
                <button type="submit" disabled={busy} className="btn-primary w-full flex justify-center items-center gap-2 px-3 py-2 rounded-lg">
                  {busy ? <Loader2 className="h-5 w-4 animate-spin" strokeWidth={3} /> : "Confirm & Enable MFA"}
                </button>
              </form>
            )}

            {step.kind === "mfa_setup_codes" && (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-2 text-center">
                  <Shield className="h-8 w-8 text-success-500" />
                  <h2 className="text-lg font-semibold text-ink-900 dark:text-white">Save your backup codes</h2>
                  <p className="text-sm text-ink-500 dark:text-ink-400">
                    Each code can be used once if you lose access to your authenticator app. Store them somewhere safe — they won't be shown again.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-ink-200/70 bg-ink-50 p-3 font-mono text-sm dark:border-ink-800 dark:bg-ink-800/50">
                  {step.backupCodes.map((c) => (
                    <div key={c} className="text-ink-800 dark:text-ink-200">{c}</div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(step.backupCodes.join("\n"))}
                  className="btn-secondary w-full flex justify-center items-center gap-2 px-3 py-2 rounded-lg"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy codes"}
                </button>
                <button
                  type="button"
                  onClick={() => { void finalizeMfaSetup(); }}
                  className="btn-primary w-full flex justify-center items-center gap-2 px-3 py-2 rounded-lg"
                >
                  I've saved these — Continue
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
