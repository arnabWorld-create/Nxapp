'use client';

import { useMemo, useState } from 'react';

interface Product {
  id: string;
  name: string;
  code: string | null;
  status: string;
  brand_id: string | null;
  division_id: string | null;
}

interface Division {
  id: string;
  name: string;
  status: string;
  products: Product[];
}

export default function ProductCatalog({ divisions }: { divisions: Division[] }) {
  const [divisionId, setDivisionId] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const normalizedSearch = search.trim().toLowerCase();

  const filteredDivisions = useMemo(() => divisions
    .filter((division) => divisionId === 'all' || division.id === divisionId)
    .map((division) => ({
      ...division,
      products: normalizedSearch
        ? division.products.filter((product) => product.name.toLowerCase().includes(normalizedSearch))
        : division.products,
    })), [divisionId, divisions, normalizedSearch]);

  const visibleProductCount = filteredDivisions.reduce((total, division) => total + division.products.length, 0);
  const totalProductCount = divisions.reduce((total, division) => total + division.products.length, 0);

  return (
    <main className="page-frame operational-page">
      <div className="mx-auto max-w-7xl">
        <div className="page-header">
          <div>
            <p className="eyebrow">Master data</p>
            <h1>Products</h1>
            <p className="page-subtitle">Browse master medicine items through their division hierarchy.</p>
          </div>
          <div className="surface catalog-count">
            <p className="text-xs uppercase text-slate-400">Visible products</p>
            <p className="mt-1 text-2xl font-bold">{visibleProductCount} <span className="text-sm font-normal text-slate-500">/ {totalProductCount}</span></p>
          </div>
        </div>

        <section className="filter-surface operational-filter" aria-label="Product filters">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-300">
              Search products
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by medicine name" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-500 focus:border-slate-500 focus:outline-none" />
            </label>
            <label className="text-sm text-slate-300">
              Division
              <select value={divisionId} onChange={(event) => setDivisionId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-slate-500 focus:outline-none">
                <option value="all">All Divisions ({divisions.length})</option>
                {divisions.map((division) => <option key={division.id} value={division.id}>{division.name} ({division.products.length})</option>)}
              </select>
            </label>
          </div>
        </section>

        <div className="space-y-6">
          {filteredDivisions.map((division) => (
            <section key={division.id} className="surface product-division" aria-labelledby={`division-${division.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-800/60 px-5 py-4">
                <div>
                  <h2 id={`division-${division.id}`} className="text-xl font-semibold">{division.name}</h2>
                  <p className="mt-1 text-sm text-slate-400">{division.products.length} matching products</p>
                </div>
                <span className="rounded-full border border-emerald-800 bg-emerald-900/20 px-3 py-1 text-xs text-emerald-300">{division.status}</span>
              </div>
              {division.products.length === 0 ? <p className="px-5 py-8 text-center text-slate-500">No products match this filter.</p> : (
                <div className="divide-y divide-slate-800">
                  {division.products.map((product) => (
                    <button key={product.id} type="button" onClick={() => setSelectedProduct(product)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-800/50">
                      <span><span className="block font-medium text-slate-100">{product.name}</span><span className="mt-1 block text-xs text-slate-500">Master Medicine Item</span></span>
                      <span className="text-sm text-slate-400">View details</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>

        {selectedProduct && (
          <div className="ui-modal-backdrop" role="presentation">
            <section className="ui-modal" role="dialog" aria-modal="true" aria-labelledby="product-detail-title">
              <div className="flex items-start justify-between gap-4">
                <div><p className="text-xs uppercase text-slate-400">Master Medicine Item</p><h2 id="product-detail-title" className="mt-2 text-2xl font-semibold">{selectedProduct.name}</h2></div>
                <button type="button" onClick={() => setSelectedProduct(null)} className="text-slate-400 hover:text-slate-100" aria-label="Close product details">Close</button>
              </div>
              <dl className="mt-6 space-y-3 text-sm">
                <div className="flex justify-between gap-4 border-b border-slate-800 pb-3"><dt className="text-slate-400">Division</dt><dd className="text-right text-slate-100">{divisions.find((division) => division.id === selectedProduct.division_id)?.name ?? 'Unassigned'}</dd></div>
                <div className="flex justify-between gap-4 border-b border-slate-800 pb-3"><dt className="text-slate-400">Brand</dt><dd className="text-right text-slate-100">{selectedProduct.brand_id ? 'Assigned' : 'Not applicable'}</dd></div>
                <div className="flex justify-between gap-4 border-b border-slate-800 pb-3"><dt className="text-slate-400">Product Variant</dt><dd className="text-right text-slate-100">Not applicable</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-400">Status</dt><dd className="text-right text-slate-100">{selectedProduct.status}</dd></div>
              </dl>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}