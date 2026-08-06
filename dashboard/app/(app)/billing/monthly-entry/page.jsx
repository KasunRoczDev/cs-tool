'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import MonthlyBillingModal from '@/components/MonthlyBillingModal';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function MonthlyEntryPage() {
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { api.products().then(setProducts).catch(() => {}); }, []);

  const load = () => {
    if (!productId) { setErr('Select an Enterprise Project first'); return; }
    setErr('');
    setOpen(true);
  };

  return (
    <div>
      <div className="page-head"><h2>📅 Monthly Billing Entry</h2></div>
      {err && <div className="error">{err}</div>}

      <div className="inline-form">
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">— select Enterprise Project —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="month" value={month.slice(0, 7)}
          onChange={(e) => setMonth(`${e.target.value}-01`)} />
        <button onClick={load}>Load services</button>
      </div>

      {open && (
        <MonthlyBillingModal
          productId={productId}
          month={month}
          onClose={() => setOpen(false)}
          onSaved={() => setOpen(false)}
        />
      )}
    </div>
  );
}
