'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { startAuthentication } from '@simplewebauthn/browser';
import { api, setToken, setRole } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  // step: 'password' | 'setup' (first-time enrollment) | 'verify' (enrolled)
  const [step, setStep] = useState('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  const finish = ({ access_token, user }) => {
    setToken(access_token);
    setRole(user?.role);
    router.push('/');
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res = await api.login(email, password);
      setMfaToken(res.mfa_token);
      if (res.mfa_setup_required) {
        setQr(res.qr);
        setSecret(res.secret);
        setStep('setup');
      } else if (res.mfa_required) {
        setStep('verify');
      } else {
        // Either MFA isn't enabled yet, or this browser is a trusted device.
        finish(res);
      }
    } catch {
      setErr('Invalid credentials');
    } finally {
      setBusy(false);
    }
  };

  const signInWithPasskey = async () => {
    if (!email.trim()) {
      setErr('Enter your email first, then choose a passkey');
      return;
    }
    setErr('');
    setPasskeyBusy(true);
    try {
      const { options, auth_token } = await api.passkeyLoginOptions(email);
      const credential = await startAuthentication(options);
      const res = await api.passkeyLoginVerify(auth_token, credential);
      finish(res);
    } catch (ex) {
      // NotAllowedError covers both "user cancelled" and "no matching passkey on
      // this device" — browsers deliberately don't distinguish the two (so a
      // failed attempt can't be used to probe whether an account has passkeys).
      // Guide toward the fallback + setup instead of a raw browser error string.
      setErr(
        ex?.name === 'NotAllowedError'
          ? "No passkey found for this account on this device. Sign in with your password below, then add a passkey from your Profile for faster sign-in next time."
          : ex?.message || 'Passkey sign-in failed. Try your password instead.',
      );
    } finally {
      setPasskeyBusy(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res =
        step === 'setup'
          ? await api.mfaEnroll(mfaToken, code, trustDevice)
          : await api.mfaVerify(mfaToken, code, trustDevice);
      finish(res);
    } catch (ex) {
      setErr(ex?.message || 'Invalid authentication code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      {step === 'password' && (
        <form className="login-card" onSubmit={submitPassword} autoComplete="off">
          <h1>🛡️ Monitoring Platform</h1>
          <label>Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="username"
              autoFocus
              required
            />
          </label>
          <label>Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {err && <div className="error">{err}</div>}
          <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button
            type="button"
            onClick={signInWithPasskey}
            disabled={passkeyBusy}
            style={{ marginTop: 8, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)' }}
          >
            {passkeyBusy ? 'Waiting for passkey…' : 'Sign in with a passkey'}
          </button>
        </form>
      )}

      {step === 'setup' && (
        <form className="login-card" onSubmit={submitCode} autoComplete="off">
          <h1>Set up two-factor auth</h1>
          <p>Scan this QR code with Google Authenticator, Authy, or any TOTP app, then enter the 6-digit code to finish.</p>
          {qr && <img src={qr} alt="TOTP QR code" style={{ width: 180, height: 180, alignSelf: 'center' }} />}
          {secret && (
            <p style={{ fontSize: 12, wordBreak: 'break-all' }}>
              Can&apos;t scan? Enter this key manually: <code>{secret}</code>
            </p>
          )}
          <label>Authentication code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              required
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
            Trust this device for 7 days — don&apos;t ask for a code again here
          </label>
          {err && <div className="error">{err}</div>}
          <button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify & continue'}</button>
        </form>
      )}

      {step === 'verify' && (
        <form className="login-card" onSubmit={submitCode} autoComplete="off">
          <h1>Two-factor authentication</h1>
          <p>Enter the 6-digit code from your authenticator app.</p>
          <label>Authentication code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              required
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
            Trust this device for 7 days — don&apos;t ask for a code again here
          </label>
          {err && <div className="error">{err}</div>}
          <button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
        </form>
      )}
    </div>
  );
}
