'use client';

import { useState } from 'react';

type TrendPoint = { month: string; salesValue: number; salesQty: number };

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' });

function formatMonth(month: string): string {
  return monthFormatter.format(new Date(`${month}-01T00:00:00`));
}

function formatAxisValue(value: number, unit: 'value' | 'quantity'): string {
  if (unit === 'quantity') return quantity.format(value);
  if (value >= 1000000) return `₹${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(0)}k`;
  return `₹${Math.round(value)}`;
}

export default function ComboTrendChart({ data }: { data: TrendPoint[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (data.length === 0) return <div className="empty-state">No approved sales in the selected period.</div>;

  const width = 820;
  const height = 280;
  const plot = { left: 112, right: 112, top: 24, bottom: 48 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const maxValue = Math.max(...data.map((item) => item.salesValue), 1);
  const maxQuantity = Math.max(...data.map((item) => item.salesQty), 1);
  const xFor = (index: number) => {
    if (data.length === 1) return plot.left + plotWidth / 2;
    if (data.length === 2) return plot.left + (index === 0 ? plotWidth * 0.25 : plotWidth * 0.75);
    return plot.left + (index / (data.length - 1)) * plotWidth;
  };
  const valueY = (value: number) => plot.top + plotHeight - (value / maxValue) * plotHeight;
  const quantityY = (value: number) => plot.top + plotHeight - (value / maxQuantity) * plotHeight;
  const points = data.map((item, index) => ({ ...item, x: xFor(index), valueY: valueY(item.salesValue), quantityY: quantityY(item.salesQty) }));
  const quantityLine = points.map((point) => `${point.x},${point.quantityY}`).join(' ');
  const ticks = [0, 0.5, 1];
  const activePoint = activeIndex === null ? null : points[activeIndex];

  return <div className="combo-chart" aria-label="Sales value and sales quantity trend">
    <div className="combo-chart-toolbar" aria-label="Chart legend">
      <span className="chart-legend-item"><i className="chart-legend-bar" aria-hidden="true" />Sales Value (₹)</span>
      <span className="chart-legend-item"><i className="chart-legend-line" aria-hidden="true" />Sales Quantity (Units)</span>
    </div>
    <div className="combo-chart-plot">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="combo-chart-title combo-chart-description" preserveAspectRatio="none">
        <title id="combo-chart-title">Sales value and quantity over time</title>
        <desc id="combo-chart-description">Vertical bars show sales value in Indian rupees. The line shows sales quantity in units using an independent right axis.</desc>
        {ticks.map((tick) => {
          const y = plot.top + plotHeight - tick * plotHeight;
          return <g key={tick}>
            <line className="combo-gridline" x1={plot.left} y1={y} x2={width - plot.right} y2={y} />
            <text className="combo-axis-label combo-axis-label-left" x={plot.left - 10} y={y + 4}>{formatAxisValue(tick * maxValue, 'value')}</text>
            <text className="combo-axis-label combo-axis-label-right" x={width - plot.right + 10} y={y + 4}>{formatAxisValue(tick * maxQuantity, 'quantity')}</text>
          </g>;
        })}
        <text className="combo-axis-title combo-axis-title-left" x="30" y={plot.top + plotHeight / 2} transform={`rotate(-90 30 ${plot.top + plotHeight / 2})`}>Sales Value (₹)</text>
        <text className="combo-axis-title combo-axis-title-right" x={width - 30} y={plot.top + plotHeight / 2} transform={`rotate(90 ${width - 30} ${plot.top + plotHeight / 2})`}>Sales Quantity (Units)</text>
        {points.map((point, index) => <rect key={`bar-${point.month}`} className={`combo-bar${activeIndex === index ? ' is-active' : ''}`} x={point.x - Math.max(10, Math.min(24, plotWidth / data.length / 2))} y={point.valueY} width={Math.max(20, Math.min(48, plotWidth / data.length / 1.8))} height={plot.top + plotHeight - point.valueY} rx="2" tabIndex={0} role="button" aria-label={`${formatMonth(point.month)}: ${money.format(point.salesValue)}, ${quantity.format(point.salesQty)} units`} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(null)} onBlur={() => setActiveIndex(null)} />)}
        <polyline className="combo-quantity-line" points={quantityLine} />
        {points.map((point, index) => <circle key={`point-${point.month}`} className={`combo-quantity-point${activeIndex === index ? ' is-active' : ''}`} cx={point.x} cy={point.quantityY} r="4" aria-hidden="true" />)}
        <line className="combo-axis-line" x1={plot.left} y1={plot.top + plotHeight} x2={width - plot.right} y2={plot.top + plotHeight} />
        {points.map((point) => <text key={`label-${point.month}`} className="combo-x-label" x={point.x} y={height - 18}>{formatMonth(point.month)}</text>)}
      </svg>
      {activePoint && <div className="combo-tooltip" style={{ left: `${Math.max(14, Math.min(86, (activePoint.x / width) * 100))}%` }} role="status"><strong>{formatMonth(activePoint.month)}</strong><span><i className="tooltip-swatch tooltip-swatch-bar" aria-hidden="true" />Sales Value <b>{money.format(activePoint.salesValue)}</b></span><span><i className="tooltip-swatch tooltip-swatch-line" aria-hidden="true" />Sales Quantity <b>{quantity.format(activePoint.salesQty)} units</b></span></div>}
    </div>
    <div className="sr-only"><table><caption>Sales value and quantity by period</caption><thead><tr><th>Period</th><th>Sales Value</th><th>Sales Quantity</th></tr></thead><tbody>{data.map((item) => <tr key={item.month}><td>{formatMonth(item.month)}</td><td>{money.format(item.salesValue)}</td><td>{quantity.format(item.salesQty)} units</td></tr>)}</tbody></table></div>
  </div>;
}
