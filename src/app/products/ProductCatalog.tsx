'use client';

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';

interface Product {
  id: string;
  name: string;
  code: string | null;
  status: string;
  brand_id: string | null;
  brand_name: string | null;
  division_id: string | null;
}

interface Brand {
  id: string;
  name: string;
}

interface Division {
  id: string;
  name: string;
  status: string;
  products: Product[];
}

export default function ProductCatalog({ divisions: initialDivisions, brands: initialBrands, canManageBrand }: { divisions: Division[]; brands: Brand[]; canManageBrand: boolean }) {
  const [divisions, setDivisions] = useState(initialDivisions);
  const [brands, setBrands] = useState(initialBrands);
  const [divisionId, setDivisionId] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showBrandForm, setShowBrandForm] = useState(false);
  const [productName, setProductName] = useState('');
  const [productCode, setProductCode] = useState('');
  const [productBrandId, setProductBrandId] = useState('');
  const [productDivisionId, setProductDivisionId] = useState('');
  const [brandName, setBrandName] = useState('');
  const [brandCode, setBrandCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  const handleCreateProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: productName,
          code: productCode || undefined,
          brand_id: productBrandId || undefined,
          division_id: productDivisionId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFormError(data.error || 'Unable to add product');
        return;
      }

      const selectedBrand = brands.find((brand) => brand.id === data.brand_id);
      setDivisions((current) => current.map((division) => division.id === data.division_id
        ? {
          ...division,
          products: [...division.products, {
            id: data.id,
            name: data.name,
            code: data.code,
            status: 'ACTIVE',
            brand_id: data.brand_id,
            brand_name: selectedBrand?.name ?? null,
            division_id: data.division_id,
          }].sort((left, right) => left.name.localeCompare(right.name)),
        }
        : division));
      setNotice(`Product "${data.name}" added.`);
      setShowProductForm(false);
      setProductName('');
      setProductCode('');
      setProductBrandId('');
      setProductDivisionId('');
    } catch {
      setFormError('Unable to add product. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateBrand = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const response = await fetch('/api/brands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: brandName, code: brandCode || undefined }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFormError(data.error || 'Unable to add brand');
        return;
      }

      setBrands((current) => [...current, { id: data.id, name: data.name }].sort((left, right) => left.name.localeCompare(right.name)));
      setProductBrandId(data.id);
      setNotice(`Brand "${data.name}" added. Select a product name and division to add it to the catalog.`);
      setShowBrandForm(false);
      setShowProductForm(true);
      setBrandName('');
      setBrandCode('');
    } catch {
      setFormError('Unable to add brand. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page-frame operational-page">
      <div className="mx-auto max-w-7xl">
        <div className="page-header">
          <div>
            <p className="eyebrow">Master data</p>
            <h1>Products</h1>
            <p className="page-subtitle">Browse master medicine items through their division hierarchy.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="surface catalog-count">
              <p className="text-xs uppercase text-slate-400">Visible products</p>
              <p className="mt-1 text-2xl font-bold">{visibleProductCount} <span className="text-sm font-normal text-slate-500">/ {totalProductCount}</span></p>
            </div>
            {canManageBrand && <button type="button" className="import-action-button" onClick={() => { setFormError(null); setShowBrandForm(true); }}>Add Brand</button>}
            <button type="button" className="primary-action" onClick={() => { setFormError(null); setShowProductForm(true); }}>Add Product</button>
          </div>
        </div>

        {notice && <div className="import-message success-state mb-5" role="status">{notice}</div>}

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
                      <span><span className="block font-medium text-slate-100">{product.name}</span><span className="mt-1 block text-xs text-slate-500">{product.brand_name ? `Brand: ${product.brand_name}` : 'Master Medicine Item'}</span></span>
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
                <div className="flex justify-between gap-4 border-b border-slate-800 pb-3"><dt className="text-slate-400">Brand</dt><dd className="text-right text-slate-100">{selectedProduct.brand_name ?? 'Not assigned'}</dd></div>
                <div className="flex justify-between gap-4 border-b border-slate-800 pb-3"><dt className="text-slate-400">Product Variant</dt><dd className="text-right text-slate-100">Not applicable</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-400">Status</dt><dd className="text-right text-slate-100">{selectedProduct.status}</dd></div>
              </dl>
            </section>
          </div>
        )}

        {(showProductForm || showBrandForm) && (
          <div className="ui-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) { setShowProductForm(false); setShowBrandForm(false); } }}>
            <section className="ui-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-form-title">
              <div className="ui-modal-header">
                <div>
                  <p className="eyebrow">Master data</p>
                  <h2 id="catalog-form-title">{showBrandForm ? 'Add Brand' : 'Add Product'}</h2>
                </div>
                <button type="button" className="ui-modal-close" aria-label="Close dialog" onClick={() => { setShowProductForm(false); setShowBrandForm(false); }} disabled={submitting}>×</button>
              </div>
              {showBrandForm ? (
                <form onSubmit={handleCreateBrand}>
                  <div className="ui-modal-body">
                    {formError && <p className="import-message error-state" role="alert">{formError}</p>}
                    <label>Brand name<input autoFocus required value={brandName} onChange={(event) => setBrandName(event.target.value)} /></label>
                    <label>Brand code (optional)<input value={brandCode} onChange={(event) => setBrandCode(event.target.value)} /></label>
                  </div>
                  <div className="ui-modal-footer">
                    <button type="button" className="import-action-button" onClick={() => setShowBrandForm(false)} disabled={submitting}>Cancel</button>
                    <button type="submit" className="primary-action" disabled={submitting}>{submitting ? 'Adding...' : 'Add Brand'}</button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleCreateProduct}>
                  <div className="ui-modal-body">
                    {formError && <p className="import-message error-state" role="alert">{formError}</p>}
                    <label>Product name<input autoFocus required value={productName} onChange={(event) => setProductName(event.target.value)} /></label>
                    <label>Product code (optional)<input value={productCode} onChange={(event) => setProductCode(event.target.value)} /></label>
                    <label>Brand
                      <select value={productBrandId} onChange={(event) => setProductBrandId(event.target.value)}>
                        <option value="">No brand</option>
                        {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                      </select>
                    </label>
                    {canManageBrand && <button type="button" className="import-action-button justify-self-start" onClick={() => { setFormError(null); setShowProductForm(false); setShowBrandForm(true); }}>Add a brand</button>}
                    <label>Division (required)
                      <select required value={productDivisionId} onChange={(event) => setProductDivisionId(event.target.value)}>
                        <option value="">Select a division</option>
                        {divisions.filter((division) => division.status === 'ACTIVE').map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="ui-modal-footer">
                    <button type="button" className="import-action-button" onClick={() => setShowProductForm(false)} disabled={submitting}>Cancel</button>
                    <button type="submit" className="primary-action" disabled={submitting || !productDivisionId}>{submitting ? 'Adding...' : 'Add Product'}</button>
                  </div>
                </form>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}