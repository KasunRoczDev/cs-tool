'use client';
import { useState } from 'react';
import { api, getRole } from '@/lib/api';

// Lets an admin/operator re-issue a server's API key when the original was
// lost (e.g. /etc/monitor-agent/agent.yaml got wiped on a reinstall) — the
// original key is only ever shown once and can't otherwise be recovered.
export default function RegenerateKey({ serverId }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!['admin', 'operator'].includes(getRole())) return null;

  const regenerate = async () => {
    setErr('');
    setBusy(true);
    try {
      const r = await api.regenerateServerKey(serverId);
      setResult(r);
    } catch {
      setErr('Failed to regenerate key (need admin/operator role)');
    } finally {
      setBusy(false);
    }
  };

  const copyKey = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.api_key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const close = () => {
    setOpen(false);
    setResult(null);
    setErr('');
  };

  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        Regenerate API key
      </button>
      {open && (
        <div className="modal-backdrop" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {!result ? (
              <div>
                <h3>Regenerate API key?</h3>
                <p>
                  The current key stops working immediately. Set the new key in{' '}
                  <code>/etc/monitor-agent/agent.yaml</code> on this server and restart the
                  agent, or it will stop reporting.
                </p>
                {err && <div className="error">{err}</div>}
                <div className="modal-actions">
                  <button type="button" onClick={close}>Cancel</button>
                  <button type="button" onClick={regenerate} disabled={busy}>
                    {busy ? 'Regenerating…' : 'Regenerate'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <h3>New API key ✅</h3>
                <p>Copy this now — it is shown only once. The old key no longer works.</p>
                <pre className="apikey">{result.api_key}</pre>
                <button type="button" className="btn-secondary" onClick={copyKey}>
                  {copied ? 'Copied!' : 'Copy API key'}
                </button>
                <p className="hint">
                  Set <code>api_key</code> in <code>/etc/monitor-agent/agent.yaml</code>, then{' '}
                  <code>sudo systemctl restart monitor-agent</code>
                </p>
                <div className="modal-actions">
                  <button onClick={close}>Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
