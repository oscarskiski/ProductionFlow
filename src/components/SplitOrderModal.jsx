import { useMemo, useState } from 'react'
import { Split, Plus, Trash2, X } from 'lucide-react'
import { isoWeekDayToDate } from '../lib/scheduling'

// Split a big order into batches. Custom qty + manual start date per batch —
// the quantities must add up to the order's total before you can confirm.

function dstr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function todayStr() { return dstr(new Date()) }
function orderProdDateStr(order) {
  if (order.prod_week == null || order.prod_day == null) return null
  return dstr(isoWeekDayToDate(new Date().getFullYear(), order.prod_week, order.prod_day))
}
// "Wk30 Wed" label for a picked date.
const DOW = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
function slotLabel(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  const dow = d.getDay() === 0 ? 7 : d.getDay()
  // isoWeek inline (avoid import churn)
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const wd = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - wd)
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const wk = Math.ceil((((t - ys) / 86400000) + 1) / 7)
  return `Wk${wk} ${DOW[dow]}`
}

export default function SplitOrderModal({ order, saving, error, onClose, onConfirm }) {
  const total = order.qty || 0
  const initDate = useMemo(() => orderProdDateStr(order) || todayStr(), [order])
  const [batches, setBatches] = useState(() => {
    const half = Math.floor(total / 2)
    return [
      { qty: half, startDate: initDate },
      { qty: total - half, startDate: initDate },
    ]
  })

  const assigned = batches.reduce((s, b) => s + (Number(b.qty) || 0), 0)
  const remaining = total - assigned
  const validQty = assigned === total && batches.every((b) => Number(b.qty) > 0)
  const validDates = batches.every((b) => !!b.startDate)
  const canConfirm = validQty && validDates && batches.length >= 2 && !saving

  const update = (i, field, val) => {
    setBatches((prev) => prev.map((b, idx) => (idx === i ? { ...b, [field]: val } : b)))
  }
  const addBatch = () => {
    const last = batches[batches.length - 1]
    setBatches((prev) => [...prev, { qty: Math.max(0, remaining), startDate: last?.startDate || initDate }])
  }
  const removeBatch = (i) => {
    if (batches.length <= 2) return
    setBatches((prev) => prev.filter((_, idx) => idx !== i))
  }
  // Drop the leftover onto the last batch so it balances in one click.
  const balanceLast = () => {
    setBatches((prev) => {
      const others = prev.slice(0, -1).reduce((s, b) => s + (Number(b.qty) || 0), 0)
      const last = { ...prev[prev.length - 1], qty: Math.max(0, total - others) }
      return [...prev.slice(0, -1), last]
    })
  }

  return (
    <>
      <style>{styles}</style>
      <div className="sp-back" onClick={saving ? undefined : onClose}>
        <div className="sp-modal" onClick={(e) => e.stopPropagation()}>
          <div className="sp-head">
            <div className="sp-ic"><Split size={20} strokeWidth={2} /></div>
            <div className="sp-head-body">
              <div className="sp-title">Split into batches</div>
              <div className="sp-sub">O{order.ord_nr || order.kwitasie_nr || '—'} · {order.product_name || order.product_code} · {total} units</div>
            </div>
            <button className="sp-x" onClick={onClose} disabled={saving} aria-label="Close"><X size={18} /></button>
          </div>

          <div className="sp-rows">
            <div className="sp-rowhead">
              <span>Batch</span><span>Quantity</span><span>Starts on</span><span />
            </div>
            {batches.map((b, i) => (
              <div className="sp-row" key={i}>
                <span className="sp-badge">{i + 1}</span>
                <input
                  type="number"
                  min="1"
                  className="sp-qty"
                  value={b.qty}
                  onChange={(e) => update(i, 'qty', e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                />
                <div className="sp-datewrap">
                  <input
                    type="date"
                    className="sp-date"
                    value={b.startDate}
                    onChange={(e) => update(i, 'startDate', e.target.value)}
                  />
                  <span className="sp-slot">{slotLabel(b.startDate)}</span>
                </div>
                <button
                  className="sp-del"
                  onClick={() => removeBatch(i)}
                  disabled={batches.length <= 2 || saving}
                  aria-label={`Remove batch ${i + 1}`}
                ><Trash2 size={15} /></button>
              </div>
            ))}
          </div>

          <div className="sp-tools">
            <button className="sp-add" onClick={addBatch} disabled={saving}><Plus size={14} strokeWidth={2.4} /> Add batch</button>
            {remaining !== 0 && (
              <button className="sp-balance" onClick={balanceLast} disabled={saving}>Put {remaining > 0 ? remaining : `+${-remaining}`} on last batch</button>
            )}
          </div>

          <div className={`sp-total ${assigned === total ? 'ok' : 'bad'}`}>
            <span>Assigned</span>
            <b>{assigned} / {total}</b>
            <span className="sp-rem">{remaining === 0 ? 'balanced' : remaining > 0 ? `${remaining} left to assign` : `${-remaining} over`}</span>
          </div>

          {error && <div className="sp-err">{error}</div>}

          <div className="sp-actions">
            <button className="sp-btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="sp-btn primary" onClick={() => onConfirm(batches)} disabled={!canConfirm}>
              {saving ? 'Splitting…' : `Split into ${batches.length} batches`}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

const styles = `
.sp-back { position: fixed; inset: 0; z-index: 4200; background: rgba(20,22,28,0.5); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 20px; animation: sp-fade 150ms ease; }
@keyframes sp-fade { from { opacity: 0; } to { opacity: 1; } }
.sp-modal { width: 100%; max-width: 560px; max-height: 88vh; overflow-y: auto; background: var(--surface, #fff); border: 1px solid var(--hairline-2, rgba(26,29,36,0.12)); border-radius: 18px; box-shadow: 0 24px 60px rgba(0,0,0,0.28); animation: sp-pop 200ms cubic-bezier(0.32,0.72,0,1); }
@keyframes sp-pop { from { transform: translateY(14px) scale(0.98); opacity: 0; } to { transform: none; opacity: 1; } }
.sp-head { display: flex; gap: 12px; align-items: center; padding: 18px 20px; border-bottom: 1px solid var(--hairline, rgba(26,29,36,0.08)); }
.sp-ic { width: 40px; height: 40px; border-radius: 11px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--amber-soft, rgba(232,154,60,0.14)); color: var(--amber, #e89a3c); }
.sp-head-body { flex: 1; min-width: 0; }
.sp-title { font-size: 17px; font-weight: 700; color: var(--ink, #1a1d24); letter-spacing: -0.02em; }
.sp-sub { font-size: 12px; color: var(--ink-2, #4a4e5a); margin-top: 2px; }
.sp-x { appearance: none; border: 0; background: transparent; color: var(--ink-3, #8a8e99); cursor: pointer; padding: 4px; border-radius: 8px; }
.sp-x:hover { background: var(--surface-2, #fbf9f5); color: var(--ink, #1a1d24); }

.sp-rows { padding: 12px 20px 4px; }
.sp-rowhead, .sp-row { display: grid; grid-template-columns: 40px 1fr 1.4fr 36px; gap: 10px; align-items: center; }
.sp-rowhead { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3, #8a8e99); padding: 0 0 6px; }
.sp-row { padding: 6px 0; }
.sp-badge { width: 26px; height: 26px; border-radius: 8px; background: var(--navy, #1f2a44); color: #fff; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.sp-qty, .sp-date { width: 100%; font: inherit; font-size: 14px; padding: 8px 10px; border: 1px solid var(--hairline-2, rgba(26,29,36,0.12)); border-radius: 9px; background: var(--surface-2, #fbf9f5); color: var(--ink, #1a1d24); }
.sp-qty { font-variant-numeric: tabular-nums; font-weight: 600; }
.sp-qty:focus, .sp-date:focus { outline: 0; border-color: var(--navy, #1f2a44); background: var(--surface, #fff); }
.sp-datewrap { display: flex; flex-direction: column; gap: 2px; }
.sp-slot { font-size: 10.5px; color: var(--ink-3, #8a8e99); font-weight: 600; padding-left: 2px; }
.sp-del { appearance: none; border: 0; background: transparent; color: var(--ink-3, #8a8e99); cursor: pointer; padding: 6px; border-radius: 8px; display: inline-flex; }
.sp-del:hover:not(:disabled) { background: var(--red-soft, rgba(210,83,58,0.10)); color: var(--red, #d2533a); }
.sp-del:disabled { opacity: 0.3; cursor: not-allowed; }

.sp-tools { display: flex; gap: 8px; align-items: center; padding: 6px 20px 0; flex-wrap: wrap; }
.sp-add, .sp-balance { appearance: none; border: 1px dashed var(--hairline-2, rgba(26,29,36,0.18)); background: transparent; color: var(--navy, #1f2a44); font: inherit; font-size: 12.5px; font-weight: 600; padding: 7px 12px; border-radius: 9px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
.sp-add:hover, .sp-balance:hover { background: var(--surface-2, #fbf9f5); }
.sp-balance { border-style: solid; }

.sp-total { display: flex; align-items: center; gap: 10px; margin: 14px 20px 0; padding: 10px 14px; border-radius: 10px; background: var(--surface-2, #fbf9f5); border: 1px solid var(--hairline, rgba(26,29,36,0.08)); font-size: 13px; }
.sp-total span { color: var(--ink-2, #4a4e5a); }
.sp-total b { font-size: 15px; font-variant-numeric: tabular-nums; color: var(--ink, #1a1d24); }
.sp-total .sp-rem { margin-left: auto; font-weight: 600; }
.sp-total.ok .sp-rem { color: var(--green, #4caf6a); }
.sp-total.bad .sp-rem { color: var(--red, #d2533a); }
.sp-total.bad b { color: var(--red, #d2533a); }

.sp-err { margin: 12px 20px 0; padding: 10px 12px; border-radius: 9px; background: var(--red-soft, rgba(210,83,58,0.10)); color: var(--red, #d2533a); font-size: 12.5px; }

.sp-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 20px 18px; }
.sp-btn { appearance: none; border: 1px solid transparent; font: inherit; font-size: 13px; font-weight: 600; padding: 9px 18px; border-radius: 10px; cursor: pointer; }
.sp-btn.ghost { background: transparent; border-color: var(--hairline-2, rgba(26,29,36,0.12)); color: var(--ink-2, #4a4e5a); }
.sp-btn.ghost:hover:not(:disabled) { background: var(--surface-2, #fbf9f5); }
.sp-btn.primary { background: var(--navy, #1f2a44); color: #fff; }
.sp-btn.primary:hover:not(:disabled) { filter: brightness(1.08); }
.sp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
`
