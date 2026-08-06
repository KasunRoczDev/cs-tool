'use client';
import { useState } from 'react';

export default function ServerAppConfigCard({ title, config, onSave, onUnlink }) {
  const [edits, setEdits] = useState({
    nginx_config: config.nginx_config || '',
    php_fpm_config: config.php_fpm_config || '',
    php_ini_config: config.php_ini_config || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setErr('');
    setSaving(true);
    try { await onSave(edits); } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <b>{title}</b>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save config'}</button>
          <button style={{ background: '#f87171' }} onClick={onUnlink}>Unlink</button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      <label style={{ display: 'block', marginTop: 8 }}>Nginx config
        <textarea rows={4} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
          value={edits.nginx_config} onChange={(e) => setEdits({ ...edits, nginx_config: e.target.value })} />
      </label>
      <label style={{ display: 'block', marginTop: 8 }}>PHP-FPM config
        <textarea rows={4} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
          value={edits.php_fpm_config} onChange={(e) => setEdits({ ...edits, php_fpm_config: e.target.value })} />
      </label>
      <label style={{ display: 'block', marginTop: 8 }}>php.ini
        <textarea rows={4} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
          value={edits.php_ini_config} onChange={(e) => setEdits({ ...edits, php_ini_config: e.target.value })} />
      </label>
    </div>
  );
}
