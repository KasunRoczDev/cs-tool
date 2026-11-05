'use client';
import { useEffect, useState } from 'react';
import FeedbackState from '@/components/ui/FeedbackState';
import FormField from '@/components/ui/FormField';
import { api } from '@/lib/api';

export default function MonthlyBillingModal({ productId, month, onClose, onSaved }) {
  const [form, setForm] = useState(null); // { product, month, services }
  const [entries, setEntries] = useState({}); // service_id -> { amount, notes }
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true); setErr(''); setForm(null);
    api.monthlyBillingForm(productId, month).then((f) => {
      if (!active) return;
      setForm(f);
      const initial = {};
      for (const s of f.services) {
        initial[s.service_id] = {
          amount: s.existing_record ? String(s.existing_record.amount) : '',
          notes: s.existing_record?.notes || '',
        };
      }
      setEntries(initial);
    }).catch((e) => { if (active) setErr(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
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
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="monthly-billing-title" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '90vh', overflow: 'auto' }}>
        <form onSubmit={save}>
          <h3 id="monthly-billing-title">{form ? `${form.product.name} — ${form.month.slice(0, 7)}` : 'Monthly billing entry'}</h3>
          {loading && <FeedbackState kind="loading" compact title="Loading services…" />}
          {err && <FeedbackState kind="error" compact title={form ? 'Unable to save billing entries' : 'Unable to load services'} description={err} action={!form ? <button type="button" onClick={() => { setErr(''); setLoading(true); api.monthlyBillingForm(productId, month).then((f) => { setForm(f); const initial = {}; for (const s of f.services) initial[s.service_id] = { amount: s.existing_record ? String(s.existing_record.amount) : '', notes: s.existing_record?.notes || '' }; setEntries(initial); }).catch((e) => setErr(e.message)).finally(() => setLoading(false)); }}>Retry</button> : undefined} />}
          {!form ? (
            !loading && !err && <FeedbackState kind="empty" title="No billing form available" />
          ) : form.services.length === 0 ? (
            <FeedbackState kind="empty" title="No services due this month" description="There are no active services due for billing in this period." />
          ) : (
            <div className="ui-data-table ui-data-table--scroll" role="region" aria-label="Monthly billing service entries" tabIndex={0} style={{ maxWidth: '100%', minWidth: 0 }}>
            <table className="grid">
              <thead><tr><th>Service</th><th>Type</th><th>Amount</th><th>Notes</th></tr></thead>
              <tbody>
                {form.services.map((s) => (
                  <tr key={s.service_id}>
                    <td>{s.name}</td>
                    <td>{s.service_type}</td>
                    <td>
                      <FormField label={`Amount for ${s.name}`}><input type="number" step="0.01" min="0" style={{ width: 100 }}
                        value={entries[s.service_id]?.amount ?? ''}
                        onChange={(e) => setEntry(s.service_id, 'amount', e.target.value)} /></FormField>
                    </td>
                    <td>
                      <FormField label={`Notes for ${s.name}`}><input value={entries[s.service_id]?.notes ?? ''}
                        onChange={(e) => setEntry(s.service_id, 'notes', e.target.value)} /></FormField>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
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
