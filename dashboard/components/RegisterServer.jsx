'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const ENV_OPTIONS = ['live', 'staging', 'dev', 'test'];

export default function RegisterServer({ onClose, defaultProductId = '' }) {
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [productId, setProductId] = useState(defaultProductId);
  const [env, setEnv] = useState('');
  const [products, setProducts] = useState([]);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.products().then(setProducts).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const r = await api.registerServer({ name, hostname, product_id: productId || undefined });
      // Environment lives in tags.env — set it right after creation if chosen.
      if (env) {
        try { await api.updateServer(r.id, { tags: { env } }); } catch {}
      }
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
            <label>Product
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">— unassigned —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>Environment
              <select value={env} onChange={(e) => setEnv(e.target.value)}>
                <option value="">— none —</option>
                {ENV_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
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
