'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { startRegistration } from '@simplewebauthn/browser';
import { Section } from '@/components/SettingsUI';

// ── Security Section (passkeys + trusted devices) ─────────────────────────
function SecuritySection() {
  const [devices, setDevices] = useState([]);
  const [passkeys, setPasskeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ msg: '', ok: true });
  const [addingPasskey, setAddingPasskey] = useState(false);

  const notify = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast({ msg: '', ok: true }), 4000);
  };

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.myTrustedDevices(), api.myPasskeys()])
      .then(([d, p]) => { setDevices(d); setPasskeys(p); })
      .catch((e) => notify(e.message, false))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const revokeDevice = async (id) => {
    try { await api.revokeTrustedDevice(id); notify('Device revoked'); load(); }
    catch (e) { notify(e.message, false); }
  };

  const revokeAll = async () => {
    try { await api.revokeAllTrustedDevices(); notify('All devices revoked'); load(); }
    catch (e) { notify(e.message, false); }
  };

  const addPasskey = async () => {
    setAddingPasskey(true);
    try {
      const { options, reg_token } = await api.passkeyRegisterOptions();
      const credential = await startRegistration(options);
      await api.passkeyRegisterVerify(reg_token, credential);
      notify('Passkey added');
      load();
    } catch (e) {
      notify(e.message || 'Could not add passkey', false);
    } finally {
      setAddingPasskey(false);
    }
  };

  const removePasskey = async (id) => {
    try { await api.deletePasskey(id); notify('Passkey removed'); load(); }
    catch (e) { notify(e.message, false); }
  };

  if (loading) {
    return (
      <Section title="Security" description="Passkeys and trusted devices for your account.">
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
      </Section>
    );
  }

  const rowStyle = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
  };
  const smallBtn = {
    padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--panel-2)', cursor: 'pointer', fontSize: 12, color: 'var(--fg, var(--text))',
  };

  return (
    <Section title="Security" description="Passkeys and trusted devices for your account.">
      {toast.msg && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 6, fontSize: 13,
          background: toast.ok ? '#d1fae522' : '#fee2e222',
          border: `1px solid ${toast.ok ? '#34d399' : '#f87171'}`,
          color: toast.ok ? '#065f46' : '#991b1b',
        }}>{toast.msg}</div>
      )}

      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Passkeys</div>
          <button className="btn-primary" onClick={addPasskey} disabled={addingPasskey}>
            {addingPasskey ? 'Waiting for device…' : 'Add a passkey'}
          </button>
        </div>
        {passkeys.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No passkeys registered yet.</div>}
        {passkeys.map((p) => (
          <div key={p.id} style={rowStyle}>
            <div>
              <div>{p.label || 'Passkey'}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                Added {new Date(p.created_at).toLocaleDateString()}
                {p.last_used_at && ` · last used ${new Date(p.last_used_at).toLocaleDateString()}`}
              </div>
            </div>
            <button onClick={() => removePasskey(p.id)} style={smallBtn}>Remove</button>
          </div>
        ))}
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Trusted devices</div>
          {devices.length > 0 && <button onClick={revokeAll} style={smallBtn}>Revoke all</button>}
        </div>
        {devices.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No trusted devices.</div>}
        {devices.map((d) => (
          <div key={d.id} style={rowStyle}>
            <div>
              <div>
                {d.label || 'Unknown device'}
                {d.is_current && <span style={{ color: 'var(--accent)', fontWeight: 700 }}> · This device</span>}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                Last used {new Date(d.last_used_at).toLocaleDateString()} · trusted until {new Date(d.expires_at).toLocaleDateString()}
              </div>
            </div>
            <button onClick={() => revokeDevice(d.id)} style={smallBtn}>Revoke</button>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function ProfilePage() {
  return (
    <div>
      <div className="page-head">
        <h2>My Profile</h2>
        <span className="muted">Your account&apos;s sign-in security</span>
      </div>

      <SecuritySection />
    </div>
  );
}
