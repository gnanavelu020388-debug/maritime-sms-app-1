import crypto from 'crypto';

// Minimal RFC 6238 (TOTP) / RFC 4226 (HOTP) implementation using only
// Node's built-in crypto — no external otplib-style dependency needed.
// SHA1, 6 digits, 30s step: the parameters every authenticator app
// (Google Authenticator, Authy, 1Password, etc.) assumes by default.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TIME_STEP_SECONDS = 30;
const DIGITS = 6;

export function generateBase32Secret(byteLength = 20) {
  const bytes = crypto.randomBytes(byteLength);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let secret = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    secret += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return secret;
}

function base32Decode(base32) {
  const clean = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of clean) {
    const val = BASE32_ALPHABET.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secretBuffer, counter) {
  const counterBuf = Buffer.alloc(8);
  // Buffer.writeBigUInt64BE requires a BigInt counter.
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

export function generateTotp(base32Secret, forTimeMs = Date.now()) {
  const counter = Math.floor(forTimeMs / 1000 / TIME_STEP_SECONDS);
  return hotp(base32Decode(base32Secret), counter);
}

/** Accepts the current 30s window plus one step of clock drift either way. */
export function verifyTotp(base32Secret, token, forTimeMs = Date.now(), window = 1) {
  if (typeof token !== 'string' || !/^\d{6}$/.test(token)) return false;
  const secretBuffer = base32Decode(base32Secret);
  const counter = Math.floor(forTimeMs / 1000 / TIME_STEP_SECONDS);
  const tokenBuf = Buffer.from(token);
  for (let drift = -window; drift <= window; drift++) {
    const candidate = Buffer.from(hotp(secretBuffer, counter + drift));
    if (candidate.length === tokenBuf.length && crypto.timingSafeEqual(candidate, tokenBuf)) return true;
  }
  return false;
}

export function buildOtpauthUrl(email, secret, issuer = 'Maritime Platform') {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(TIME_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Human-typeable one-time recovery codes, e.g. "A1B2C-3D4E5". */
export function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}
