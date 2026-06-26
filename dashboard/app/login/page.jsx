'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

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
        // Shouldn't happen (MFA required for all), but handle gracefully.
        finish(res);
      }
    } catch {
      setErr('Invalid credentials');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res =
        step === 'setup'
          ? await api.mfaEnroll(mfaToken, code)
          : await api.mfaVerify(mfaToken, code);
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
        </form>
      )}

      {step === 'setup' && (
        <form className="login-card" onSubmit={submitCode} autoComplete="off">
          <h1>Set up two-factor auth</h1>
          <p>Scan this QR code with Google Authenticator, Authy, or any TOTP app, then enter the 6-digit code to finish.</p>
          {qr && <img src={qr} alt="TOTP QR code" style={{ width: 180, height: 180, alignSelf: 'center' }} />}
          {secret && (
            <p style={{ fontSize: 12, wordBreak: 'break-all' }}>
              Can’t scan? Enter this key manually: <code>{secret}</code>
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
          {err && <div className="error">{err}</div>}
          <button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
        </form>
      )}
    </div>
  );
}
