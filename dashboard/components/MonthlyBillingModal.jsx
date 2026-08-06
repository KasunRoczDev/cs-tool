'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function MonthlyBillingModal({ productId, month, onClose, onSaved }) {
  const [form, setForm] = useState(null); // { product, month, services }
  const [entries, setEntries] = useState({}); // service_id -> { amount, notes }
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.monthlyBillingForm(productId, month).then((f) => {
      setForm(f);
      const initial = {};
      for (const s of f.services) {
        initial[s.service_id] = {
          amount: s.existing_record ? String(s.existing_record.amount) : '',
          notes: s.existing_record?.notes || '',
        };
      }
      setEntries(initial);
    }).catch((e) => setErr(e.message));
  }, [productId, month]);

  const setEntry = (serviceId, field, value) =>
    setEntries((e) => ({ ...e, [serviceId]: { ...e[serviceId], [field]: value } }));

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    setSaving(true);
    const body = {
      product_id: productId,
      month,
      entries: Object.entries(entries)
        .filter(([, v]) => v.amount !== '')
        .map(([service_id, v]) => ({ service_id, amount: Number(v.amount), notes: v.notes || undefined })),
    };
    try {
      await api.bulkBillingRecords(body);
      onSaved();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <form onSubmit={save}>
          <h3>{form ? `${form.product.name} — ${form.month.slice(0, 7)}` : 'Loading…'}</h3>
          {err && <div className="error">{err}</div>}
          {!form ? (
            <p>Loading services…</p>
          ) : form.services.length === 0 ? (
            <p>No active services due for billing this month.</p>
          ) : (
            <table className="grid">
              <thead><tr><th>Service</th><th>Type</th><th>Amount</th><th>Notes</th></tr></thead>
              <tbody>
                {form.services.map((s) => (
                  <tr key={s.service_id}>
                    <td>{s.name}</td>
                    <td>{s.service_type}</td>
                    <td>
                      <input type="number" step="0.01" min="0" style={{ width: 100 }}
                        value={entries[s.service_id]?.amount ?? ''}
                        onChange={(e) => setEntry(s.service_id, 'amount', e.target.value)} />
                    </td>
                    <td>
                      <input value={entries[s.service_id]?.notes ?? ''}
                        onChange={(e) => setEntry(s.service_id, 'notes', e.target.value)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={!form || saving || form.services.length === 0}>
              {saving ? 'Saving…' : 'Save all'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
