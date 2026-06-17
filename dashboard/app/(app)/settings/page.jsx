'use client';
import { useEffect, useState } from 'react';
import { api, getRole } from '@/lib/api';
import { useDashboard } from '@/lib/useDashboard';

// ── helpers ───────────────────────────────────────────────────────────────
function Section({ title, description, children }) {
  return (
    <div style={{
      background: 'var(--panel)', border: '1px solid var(--border)',
      borderRadius: 10, marginBottom: 20, overflow: 'hidden',
    }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
        {description && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{description}</div>}
      </div>
      <div style={{ padding: '20px' }}>{children}</div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, alignItems: 'start', marginBottom: 16 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ── Theme Section ─────────────────────────────────────────────────────────
function ThemeSection() {
  const { theme, toggleTheme } = useDashboard();

  const themes = [
    { id: 'dark',  label: 'Dark',  icon: '🌙', desc: 'Dark background, optimised for low-light' },
    { id: 'light', label: 'Light', icon: '☀️', desc: 'Light background, optimised for bright environments' },
  ];

  return (
    <Section title="Appearance" description="Choose how the dashboard looks.">
      <div style={{ display: 'flex', gap: 12 }}>
        {themes.map((t) => {
          const active = theme === t.id;
          return (
            <button key={t.id} onClick={() => { if (!active) toggleTheme(); }}
              style={{
                flex: 1, padding: '16px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                background: active ? 'var(--accent)22' : 'var(--panel-2)',
                border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                color: 'var(--fg, var(--text))', transition: 'all .15s',
              }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{t.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: active ? 'var(--accent)' : 'inherit' }}>{t.label}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{t.desc}</div>
              {active && (
                <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>✓ Active</div>
              )}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// ── SMTP Section ──────────────────────────────────────────────────────────
function SmtpSection() {
  const isAdmin = getRole() === 'admin';

  const EMPTY = {
    smtp_host: '', smtp_port: '587', smtp_secure: 'false',
    smtp_user: '', smtp_pass: '', smtp_from: '',
  };

  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [toast, setToast] = useState({ msg: '', ok: true });
  const [showPass, setShowPass] = useState(false);

  const notify = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast({ msg: '', ok: true }), 4000);
  };

  useEffect(() => {
    api.getSettings().then((s) => {
      setForm({
        smtp_host:   s.smtp_host   ?? '',
        smtp_port:   s.smtp_port   ?? '587',
        smtp_secure: s.smtp_secure ?? 'false',
        smtp_user:   s.smtp_user   ?? '',
        smtp_pass:   s.smtp_pass   ?? '',  // will be '••••••••' if set
        smtp_from:   s.smtp_from   ?? '',
      });
      setTestTo(s.smtp_user ?? '');
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSettings(form);
      notify('SMTP settings saved');
    } catch (e) { notify(e.message, false); }
    setSaving(false);
  };

  const sendTest = async () => {
    if (!testTo.trim()) return notify('Enter a recipient email for the test', false);
    setTesting(true);
    try {
      // Find any channel or create an ad-hoc test by hitting the channel test endpoint.
      // We'll use a direct approach: save settings first, then test via channels.
      // For now, use the first available channel or prompt user to use the Notifications page.
      const channels = await api.notifChannels();
      if (channels.length === 0) {
        notify('Create an email channel on the Notifications page first, then use the Test button there.', false);
        setTesting(false);
        return;
      }
      await api.testChannel(channels[0].id);
      notify(`Test email sent to ${channels[0].config?.to}`);
    } catch (e) { notify(`Test failed: ${e.message}`, false); }
    setTesting(false);
  };

  if (loading) return <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>;

  const configured = !!form.smtp_host;

  return (
    <Section
      title="Email / SMTP"
      description="Configure the outgoing mail server used to deliver alert notifications.">

      {toast.msg && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 6, fontSize: 13,
          background: toast.ok ? '#d1fae522' : '#fee2e222',
          border: `1px solid ${toast.ok ? '#34d399' : '#f87171'}`,
          color: toast.ok ? '#065f46' : '#991b1b',
        }}>{toast.msg}</div>
      )}

      {!isAdmin && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 6, fontSize: 13,
          background: '#fef3c722', border: '1px solid #fbbf24', color: '#92400e',
        }}>
          Only administrators can change SMTP settings. Current values shown read-only.
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <div style={{
          width: 10, height: 10, borderRadius: '50%',
          background: configured ? '#34d399' : '#94a3b8',
        }} />
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          {configured ? `Connected via ${form.smtp_host}:${form.smtp_port}` : 'Not configured — email notifications are disabled'}
        </span>
      </div>

      <Field label="SMTP host" hint="e.g. smtp.gmail.com or smtp.sendgrid.net">
        <input value={form.smtp_host} onChange={(e) => set('smtp_host', e.target.value)}
          placeholder="smtp.example.com" disabled={!isAdmin} style={{ width: '100%' }} />
      </Field>

      <Field label="Port" hint="587 = STARTTLS, 465 = TLS, 25 = plain">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input type="number" value={form.smtp_port} onChange={(e) => set('smtp_port', e.target.value)}
            style={{ width: 100 }} disabled={!isAdmin} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: isAdmin ? 'pointer' : 'default' }}>
            <input type="checkbox" checked={form.smtp_secure === 'true'}
              onChange={(e) => set('smtp_secure', e.target.checked ? 'true' : 'false')}
              disabled={!isAdmin} />
            Use TLS (port 465)
          </label>
        </div>
      </Field>

      <Field label="Username" hint="Usually your email address">
        <input value={form.smtp_user} onChange={(e) => set('smtp_user', e.target.value)}
          placeholder="monitor@example.com" disabled={!isAdmin} style={{ width: '100%' }} />
      </Field>

      <Field label="Password">
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type={showPass ? 'text' : 'password'}
            value={form.smtp_pass}
            onChange={(e) => set('smtp_pass', e.target.value)}
            placeholder={configured ? 'Leave as ••••••••  to keep existing' : 'SMTP password or app password'}
            disabled={!isAdmin}
            style={{ flex: 1 }}
          />
          <button onClick={() => setShowPass((v) => !v)} style={{
            padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--panel-2)', cursor: 'pointer', fontSize: 12, color: 'var(--fg, var(--text))',
          }}>{showPass ? 'Hide' : 'Show'}</button>
        </div>
      </Field>

      <Field label="From address" hint="Shown in the From field of sent emails">
        <input value={form.smtp_from} onChange={(e) => set('smtp_from', e.target.value)}
          placeholder="monitor@example.com" disabled={!isAdmin} style={{ width: '100%' }} />
      </Field>

      {isAdmin && (
        <div style={{ display: 'flex', gap: 10, marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save SMTP settings'}
          </button>
          <button onClick={sendTest} disabled={testing} style={{
            padding: '8px 16px', borderRadius: 7, border: '1px solid var(--border)',
            background: 'var(--panel-2)', cursor: 'pointer', fontSize: 13, color: 'var(--fg, var(--text))',
          }}>
            {testing ? 'Sending…' : 'Send test email'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
            Test uses the first configured email channel
          </span>
        </div>
      )}

      {/* Quick-ref for common providers */}
      <details style={{ marginTop: 20 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--muted)' }}>
          Common provider settings ▸
        </summary>
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          {[
            { name: 'Gmail (App Password)', host: 'smtp.gmail.com', port: '587', note: 'Enable 2FA and create an App Password' },
            { name: 'SendGrid', host: 'smtp.sendgrid.net', port: '587', note: 'Username: apikey  Password: your SendGrid API key' },
            { name: 'Mailgun', host: 'smtp.mailgun.org', port: '587', note: 'Use your Mailgun SMTP credentials' },
            { name: 'AWS SES (us-east-1)', host: 'email-smtp.us-east-1.amazonaws.com', port: '587', note: 'Create SMTP credentials in SES console' },
            { name: 'Office 365', host: 'smtp.office365.com', port: '587', note: 'Use your Microsoft 365 account credentials' },
          ].map((p) => (
            <div key={p.name} style={{
              display: 'grid', gridTemplateColumns: '160px 220px 1fr',
              gap: 10, fontSize: 12, padding: '8px 10px',
              background: 'var(--panel-2)', borderRadius: 6,
            }}>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{p.host}:{p.port}</div>
              <div style={{ color: 'var(--muted)' }}>{p.note}</div>
            </div>
          ))}
        </div>
      </details>
    </Section>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function SettingsPage() {
  return (
    <div>
      <div className="page-head">
        <h2>Settings</h2>
        <span className="muted">Appearance &amp; platform configuration</span>
      </div>

      <ThemeSection />
      <SmtpSection />
    </div>
  );
}
