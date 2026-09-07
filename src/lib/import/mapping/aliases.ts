import type { CanonicalField } from './types';
import { normalizeHeader } from './normalize-header';

export const canonicalFieldAliases: Record<CanonicalField, string[]> = {
  source_item_name: [
    'Brand',
    'Brand Name',
    'Item',
    'Item Name',
    'Product',
    'Product Name',
    'Product Na',
    'Particular',
    'Particulars',
    'Product/Brand',
    'Brand/Item',
  ],
  reported_purchase_qty: [
    'Purchase Qty',
    'Purch Qty',
    'Purchase Quantity',
    'Purch Quantity',
    'P Qty',
    'Purchase QTY',
  ],
  reported_purchase_value: [
    'Purchase Value',
    'Purch Value',
    'Purchase Val',
    'P Value',
    'P Val',
    'Purchase Amount',
  ],
  reported_sales_qty: [
    'Sales Qty',
    'Sale Qty',
    'Sales Quantity',
    'Sale Quantity',
    'S Qty',
  ],
  reported_sales_value: [
    'Sales Value',
    'Sale Value',
    'Sales Val',
    'S Value',
    'S Val',
    'Sales Amount',
  ],
  reported_sales_return_qty: [
    'Sales Return Qty',
    'Sales Return Quantity',
    'Sale Return Qty',
    'S Return Qty',
    'Sales Ret Qty',
  ],
  reported_sales_return_value: [
    'Sales Return Value',
    'Sales Return Val',
    'Sale Return Value',
    'S Return Value',
  ],
  reported_purchase_return_qty: [
    'Purchase Return Qty',
    'Purchase Return Quantity',
    'Purch Return Qty',
    'P Return Qty',
  ],
  reported_purchase_return_value: [
    'Purchase Return Value',
    'Purchase Return Val',
    'Purch Return Value',
    'P Return Value',
  ],
  reported_closing_stock_qty: [
    'C Stk',
    'CStk',
    'ClStk',
    'CIStk',
    'Closing Qty',
    'Closing Stock Qty',
    'Closing Stock Quantity',
    'Closing Quantity',
    'Closing Stock',
  ],
  reported_closing_stock_value: [
    'C Val',
    'CVal',
    'ClVal',
    'CIVal',
    'Closing Value',
    'Closing Stock Value',
    'Closing Stock Val',
  ],
  quantity_unit: [
    'Unit',
    'Qty Unit',
    'Quantity Unit',
    'UOM',
    'UOM/Unit',
  ],
};

export const canonicalFieldLabels: Record<CanonicalField, string> = {
  source_item_name: 'Source Item Name',
  reported_purchase_qty: 'Reported Purchase Qty',
  reported_purchase_value: 'Reported Purchase Value',
  reported_sales_qty: 'Reported Sales Qty',
  reported_sales_value: 'Reported Sales Value',
  reported_sales_return_qty: 'Reported Sales Return Qty',
  reported_sales_return_value: 'Reported Sales Return Value',
  reported_purchase_return_qty: 'Reported Purchase Return Qty',
  reported_purchase_return_value: 'Reported Purchase Return Value',
  reported_closing_stock_qty: 'Reported Closing Stock Qty',
  reported_closing_stock_value: 'Reported Closing Stock Value',
  quantity_unit: 'Quantity Unit',
};

export const canonicalFields = Object.keys(canonicalFieldAliases) as CanonicalField[];

export const aliasToFieldMap: Record<string, CanonicalField> = Object.entries(canonicalFieldAliases).reduce(
  (acc, [field, aliases]) => {
    aliases.forEach((alias) => {
      const key = normalizeHeader(alias);
      acc[key] = field as CanonicalField;
    });
    return acc;
  },
  {} as Record<string, CanonicalField>
);
