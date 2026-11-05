'use client';
import PageHeader from '@/components/PageHeader';
import FormField from '@/components/ui/FormField';
import FeedbackState from '@/components/ui/FeedbackState';
import FilterBar from '@/components/ui/FilterBar';
import { useEffect, useState } from 'react';
import { getPageContext } from '@/lib/navigation';
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
  const [productsError, setProductsError] = useState('');
  const [productsLoading, setProductsLoading] = useState(true);

  useEffect(() => {
    api.products().then(setProducts).catch((e) => setProductsError(e.message || 'Unable to load projects')).finally(() => setProductsLoading(false));
  }, []);

  const load = () => {
    if (!productId) { setErr('Select an Enterprise Project first'); return; }
    setErr('');
    setOpen(true);
  };

  return (
    <div>
      <PageHeader {...getPageContext('/billing/monthly-entry')} />
      {productsLoading && <FeedbackState kind="loading" compact title="Loading projects…" />}
      {productsError && <FeedbackState kind="error" description={productsError} action={<button onClick={() => { setProductsLoading(true); setProductsError(''); api.products().then(setProducts).catch((e) => setProductsError(e.message || 'Unable to load projects')).finally(() => setProductsLoading(false)); }}>Retry</button>} />}
      {err && <FeedbackState kind="error" compact title="Select a project" description={err} />}

      <FilterBar label="Billing entry period">
        <FormField label="Enterprise project"><select value={productId} onChange={(e) => setProductId(e.target.value)} disabled={productsLoading || !!productsError}>
          <option value="">— select Enterprise Project —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></FormField>
        <FormField label="Billing month"><input type="month" value={month.slice(0, 7)}
          onChange={(e) => setMonth(`${e.target.value}-01`)} /></FormField>
        <button onClick={load} disabled={productsLoading || !!productsError}>{open ? 'Services loaded' : 'Load services'}</button>
      </FilterBar>

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
