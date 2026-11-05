'use client';
import { useEffect, useState } from 'react';
import FormField from '@/components/ui/FormField';
import FeedbackState from '@/components/ui/FeedbackState';
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
  const [productsError, setProductsError] = useState('');
  const [productsLoading, setProductsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.products().then(setProducts).catch((e) => setProductsError(e.message || 'Unable to load projects')).finally(() => setProductsLoading(false));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      const r = await api.registerServer({ name, hostname, product_id: productId || undefined });
      // Environment lives in tags.env — set it right after creation if chosen.
      if (env) {
        try { await api.updateServer(r.id, { tags: { env } }); } catch {}
      }
      setResult(r);
    } catch (e) {
      setErr(e.message || 'Unable to register server');
    } finally { setSaving(false); }
  };

  const copyKey = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.api_key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="register-server-title" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '90vh', overflow: 'auto' }}>
        {!result ? (
          <form onSubmit={submit}>
            <h3 id="register-server-title">Register server</h3>
            <FormField label="Name" required><input value={name} onChange={(e) => setName(e.target.value)} required /></FormField>
            <FormField label="Hostname"><input value={hostname} onChange={(e) => setHostname(e.target.value)} /></FormField>
            <FormField label="Project">
              <select value={productId} onChange={(e) => setProductId(e.target.value)} disabled={productsLoading || !!productsError}>
                <option value="">— unassigned —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
            {productsLoading && <FeedbackState kind="loading" compact title="Loading projects…" />}
            {productsError && <FeedbackState kind="error" compact title="Projects unavailable" description={productsError} />}
            <FormField label="Environment">
              <select value={env} onChange={(e) => setEnv(e.target.value)}>
                <option value="">— none —</option>
                {ENV_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </FormField>
            {err && <FeedbackState kind="error" compact title="Unable to register server" description={err} />}
            <div className="modal-actions">
              <button type="button" onClick={onClose}>Cancel</button>
              <button type="submit" disabled={saving || productsLoading}>{saving ? 'Creating…' : 'Create server'}</button>
            </div>
          </form>
        ) : (
          <div>
            <h3 id="register-server-title">Server created</h3>
            <p>Copy this API key now — it is shown only once. Put it in the agent config.</p>
            <pre className="apikey">{result.api_key}</pre>
            <button type="button" className="btn-secondary" onClick={copyKey}>
              {copied ? 'Copied!' : 'Copy API key'}
            </button>
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
