'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

export default function RegisterServer({ onClose }) {
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const r = await api.registerServer({ name, hostname });
      setResult(r);
    } catch {
      setErr('Failed to register (need admin/operator role)');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {!result ? (
          <form onSubmit={submit}>
            <h3>Register server</h3>
            <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label>Hostname<input value={hostname} onChange={(e) => setHostname(e.target.value)} /></label>
            {err && <div className="error">{err}</div>}
            <div className="modal-actions">
              <button type="button" onClick={onClose}>Cancel</button>
              <button type="submit">Create</button>
            </div>
          </form>
        ) : (
          <div>
            <h3>Server created ✅</h3>
            <p>Copy this API key now — it is shown only once. Put it in the agent config.</p>
            <pre className="apikey">{result.api_key}</pre>
            <p className="hint">Set <code>api_key</code> in <code>/etc/monitor-agent/agent.yaml</code></p>
            <div className="modal-actions">
              <button onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
