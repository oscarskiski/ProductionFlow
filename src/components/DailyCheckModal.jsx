import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ClipboardCheck, ChevronRight, AlertTriangle, Check, ArrowRight,
} from 'lucide-react'
import { useAppData } from '../store/AppDataContext'
import { buildOrderTracking, distributeQtyAcrossRows, setStepQtyDone } from '../lib/tracking'
import { getCurrentUser } from '../lib/auth'
import { isoWeekDayToDate } from '../lib/scheduling'
import { computeSlip, computePace } from '../lib/slip'
import { DebouncedQtyStepper } from './QtyStepper'

// ============================================================
// Daily production check — the forcing half of the midday routine.
//
// At/after 12:00 on a work day, if this device hasn't done today's check yet,
// this modal blocks the app with a list of EVERYTHING due to be in production by
// now that still has unfinished steps. The boss/manager ticks off what's really
// finished on the floor, which keeps the schedule (and the "behind" badges on
// Part Tracking) honest. Only the Boss may skip; everyone else clears it by
// completing the check.
//
// The reminder MESSAGE that prompts this arrives via the normal message pipeline
// (cron → messages row → push/toast, migrations 022 + 026). This component is
// purely the on-open form.
// ============================================================

const LS_KEY = 'tracking:dailyCheckDate'

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function DailyCheckModal() {
  const navigate = useNavigate()
  const {
    enrichedOrders, partsByProduct, stepsByPart, productByCode, machines,
    schedule, holidaySet, applyScheduleRowUpdate,
  } = useAppData()

  const year = useMemo(() => new Date().getFullYear(), [])
  const today = useMemo(() => todayStr(), [])

  const user = getCurrentUser()
  const role = user?.role
  const allowed = role === 'Boss' || role === 'Manager'
  const isBoss = role === 'Boss'

  // Only nag on a real work day, only after noon.
  const isWorkDayToday = useMemo(() => {
    const d = new Date()
    const dow = d.getDay() === 0 ? 7 : d.getDay()
    return dow <= 5 && !(holidaySet && holidaySet.has(today))
  }, [holidaySet, today])
  const pastNoon = useMemo(() => new Date().getHours() >= 12, [])

  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(LS_KEY) === today } catch { return false }
  })
  // Once the modal has legitimately opened, keep it open until the user acts —
  // even after the list empties out — so we can show the "all clear" state
  // instead of yanking it away mid-tick.
  const [active, setActive] = useState(false)
  // Manual open — any screen can fire `window.dispatchEvent(new Event('open-daily-check'))`
  // to pull the check up on demand (e.g. the "Daily check" button on Tracking),
  // bypassing the noon / already-done gates so you don't have to wait for 12:00.
  const [forced, setForced] = useState(false)
  useEffect(() => {
    const h = () => { setForced(true); setDismissed(false) }
    window.addEventListener('open-daily-check', h)
    return () => window.removeEventListener('open-daily-check', h)
  }, [])

  const machineById = useMemo(
    () => new Map((machines || []).map((m) => [m.id, m])),
    [machines],
  )
  const scheduleByOrderStep = useMemo(() => {
    const m = new Map()
    for (const r of schedule || []) {
      if (!r.order_id || !r.machine_step_id) continue
      const k = `${r.order_id}:${r.machine_step_id}`
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
    return m
  }, [schedule])

  // Everything that should be in production by today and still isn't finished.
  const items = useMemo(() => {
    const out = []
    for (const o of enrichedOrders || []) {
      if (o.status === 'completed' || o.ready_for_dispatch_at) continue
      if (o.prod_week == null || o.prod_day == null) continue
      const planned = dateToStr(isoWeekDayToDate(year, o.prod_week, o.prod_day))
      if (planned > today) continue // not due yet — nothing to check
      const product = productByCode.get(o.product_code)
      const parts = product ? (partsByProduct.get(product.id) || []) : []
      const tracking = buildOrderTracking({
        order: o, parts, stepsByPart, scheduleByOrderStep, machineById,
      })
      const leftover = []
      for (const pt of tracking.parts) {
        for (const sv of pt.steps) {
          if (sv.rows.length > 0 && sv.qty_done < sv.qty) leftover.push(sv)
        }
      }
      const productionComplete = tracking.parts.length > 0
        && tracking.parts.every((pt) => pt.total > 0 && pt.lastDone >= pt.total)
      if (productionComplete || leftover.length === 0) continue
      out.push({
        order: o,
        tracking,
        slip: computeSlip(o, holidaySet, year),
        pace: computePace({ order: o, tracking, holidaySet, today, year }),
        planned,
      })
    }
    // Most behind first, then earliest planned day.
    out.sort((a, b) => (b.slip.daysBehind - a.slip.daysBehind) || (a.planned < b.planned ? -1 : 1))
    return out
  }, [enrichedOrders, productByCode, partsByProduct, stepsByPart, scheduleByOrderStep, machineById, holidaySet, year, today])

  const shouldOpen = allowed && isWorkDayToday && pastNoon && !dismissed && items.length > 0
  useEffect(() => { if (shouldOpen) setActive(true) }, [shouldOpen])

  const stamp = () => {
    try { localStorage.setItem(LS_KEY, today) } catch { /* ignore */ }
    setDismissed(true)
    setActive(false)
    setForced(false)
  }

  const onStepperChange = (stepView, qty) => {
    const patches = distributeQtyAcrossRows(stepView.rows, qty)
    for (const p of patches) applyScheduleRowUpdate(p.id, p)
    setStepQtyDone({ rows: stepView.rows, totalQtyDone: qty })
      .then((res) => res.forEach((r) => applyScheduleRowUpdate(r.id, r)))
      .catch(() => { /* optimistic patch already applied; a reload will resync */ })
  }

  if (!forced && (!active || dismissed)) return null

  const totalBehind = items.reduce((s, it) => s + (it.slip.daysBehind > 0 || it.slip.count > 0 ? 1 : 0), 0)
  const allClear = items.length === 0

  return (
    <>
      <style>{styles}</style>
      <div className="dc-overlay" role="dialog" aria-modal="true" aria-label="Daily production check">
        <div className="dc-card">
          <div className="dc-head">
            <div className="dc-ic"><ClipboardCheck size={22} strokeWidth={2} /></div>
            <div className="dc-head-body">
              <div className="dc-title">Midday production check</div>
              <div className="dc-sub">
                {allClear
                  ? 'Everything due is accounted for — nice.'
                  : `Tick off what's finished on the floor. ${items.length} order${items.length === 1 ? '' : 's'} to check${totalBehind > 0 ? ` · ${totalBehind} already behind` : ''}.`}
              </div>
            </div>
          </div>

          {allClear ? (
            <div className="dc-clear">
              <div className="dc-clear-ic"><Check size={34} strokeWidth={2.4} /></div>
              <div className="dc-clear-txt">All caught up for today.</div>
            </div>
          ) : (
            <div className="dc-list">
              {items.map((it) => (
                <CheckRow key={it.order.id} item={it} onStepperChange={onStepperChange} />
              ))}
            </div>
          )}

          <div className="dc-foot">
            <button
              type="button"
              className="dc-link"
              onClick={() => { navigate('/tracking'); stamp() }}
            >
              Open full Tracking <ArrowRight size={13} strokeWidth={2} />
            </button>
            <div className="dc-foot-actions">
              {isBoss && !allClear && (
                <button type="button" className="dc-btn ghost" onClick={stamp}>Skip for today</button>
              )}
              <button type="button" className="dc-btn primary" onClick={stamp}>
                {allClear ? 'Done' : 'Done — schedule updated'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function CheckRow({ item, onStepperChange }) {
  const { order, tracking, slip, planned, pace } = item
  const behind = slip.daysBehind > 0 || slip.count > 0
  const isDone = tracking.doneUnits >= tracking.totalUnits && tracking.totalUnits > 0
  // Collapsed by default — a clean scannable list; expand an order to tick it.
  const [open, setOpen] = useState(false)
  const done = tracking.doneUnits
  const total = tracking.totalUnits
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0

  return (
    <div className={`dc-order ${open ? 'open' : ''}`}>
      <div className="dc-order-head" onClick={() => setOpen((v) => !v)}>
        <div className="dc-ply"><ChevronRight size={15} strokeWidth={2} /></div>
        <div className="dc-order-main">
          <div className="dc-order-top">
            <span className="dc-onum">O{order.ord_nr || order.kwitasie_nr || '—'}</span>
            <span className="dc-oname">{order.product_name}</span>
            {behind && (
              <span className="dc-slip">
                <AlertTriangle size={10} strokeWidth={2.4} />
                {slip.daysBehind > 0
                  ? `${slip.daysBehind} day${slip.daysBehind === 1 ? '' : 's'} behind · pushed ${slip.count}×`
                  : `pushed ${slip.count}× · behind plan`}
              </span>
            )}
          </div>
          <div className="dc-progress">
            <div className="dc-bar">
              <i style={{ width: `${pct}%` }} />
              {pace && pace.started && pace.expectedFrac > 0 && pace.expectedFrac < 1 && (
                <span
                  className="dc-pace-marker"
                  style={{ left: `${pace.expectedFrac * 100}%` }}
                  title={`Should be ~${pace.expectedUnits}/${total} by now to stay on schedule`}
                />
              )}
            </div>
            <span className="dc-ptext">
              {done}/{total} done · planned {planned}
              {pace && pace.started && !isDone && (
                pace.behind > 0
                  ? <span className="dc-pace behind"> · should be {pace.expectedUnits} by now ({pace.behind} short)</span>
                  : <span className="dc-pace ok"> · on pace</span>
              )}
            </span>
          </div>
        </div>
      </div>
      {open && (
        <div className="dc-steps">
          {tracking.parts.map((pt) => (
            <div key={pt.part.id} className="dc-part">
              <div className="dc-part-name">{pt.part.name}{pt.part.is_assembly && <span className="dc-asm">Assembly</span>}</div>
              {pt.steps.map((sv) => {
                const allDone = sv.qty_done >= sv.qty && sv.qty > 0
                const hasRows = sv.rows.length > 0
                return (
                  <div key={sv.step.id} className={`dc-step ${allDone ? 'done' : ''}`}>
                    <span className="dc-seq">{sv.step.sequence}</span>
                    <span className="dc-mach">{sv.assignedMachineName || sv.step.machine_name}</span>
                    {hasRows ? (
                      <DebouncedQtyStepper
                        value={sv.qty_done}
                        max={sv.qty}
                        onChange={(v) => onStepperChange(sv, v)}
                        compact
                        showMax
                      />
                    ) : (
                      <span className="dc-unsched">unsched</span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const styles = `
.dc-overlay {
  position: fixed; inset: 0; z-index: 5000;
  background: rgba(20, 22, 28, 0.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
  animation: dc-fade 160ms ease;
}
@keyframes dc-fade { from { opacity: 0; } to { opacity: 1; } }
.dc-card {
  width: 100%; max-width: 780px; max-height: 90vh; display: flex; flex-direction: column;
  background: var(--surface, #fff); border: 1px solid var(--hairline-2, rgba(26,29,36,0.12));
  border-radius: 20px; box-shadow: 0 24px 60px rgba(0,0,0,0.28); overflow: hidden;
  animation: dc-pop 220ms cubic-bezier(0.32,0.72,0,1);
}
@keyframes dc-pop { from { transform: translateY(16px) scale(0.98); opacity: 0; } to { transform: none; opacity: 1; } }
.dc-head { display: flex; gap: 13px; align-items: center; padding: 18px 20px; border-bottom: 1px solid var(--hairline, rgba(26,29,36,0.08)); }
.dc-ic { width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--navy, #1f2a44); color: #fff; }
.dc-title { font-size: 18px; font-weight: 700; color: var(--ink, #1a1d24); letter-spacing: -0.02em; }
.dc-sub { font-size: 12.5px; color: var(--ink-2, #4a4e5a); margin-top: 2px; }

.dc-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.dc-order { flex-shrink: 0; border: 1px solid var(--hairline, rgba(26,29,36,0.08)); border-radius: 14px; background: var(--surface-2, #fbf9f5); overflow: hidden; }
.dc-order.open { border-color: var(--hairline-2, rgba(26,29,36,0.12)); box-shadow: 0 2px 10px rgba(26,29,36,0.05); }
.dc-order-head { display: grid; grid-template-columns: 22px 1fr; gap: 11px; align-items: start; padding: 16px 18px; cursor: pointer; }
.dc-ply { color: var(--ink-3, #8a8e99); display: flex; margin-top: 2px; transition: transform 160ms ease; }
.dc-order.open .dc-ply { transform: rotate(90deg); }
.dc-order-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; row-gap: 6px; }
.dc-onum { font-size: 12px; font-weight: 700; color: var(--ink-3, #8a8e99); letter-spacing: 0.04em; font-variant-numeric: tabular-nums; }
.dc-oname { font-size: 15.5px; font-weight: 600; color: var(--ink, #1a1d24); letter-spacing: -0.015em; }
.dc-slip { display: inline-flex; align-items: center; gap: 4px; background: var(--red-soft, rgba(210,83,58,0.10)); color: var(--red, #d2533a); font-size: 10.5px; font-weight: 800; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
.dc-progress { display: flex; flex-direction: column; align-items: stretch; gap: 7px; margin-top: 12px; }
.dc-bar { position: relative; width: 100%; height: 8px; border-radius: 999px; background: var(--surface-3, #f1eee7); overflow: hidden; }
.dc-bar i { display: block; height: 100%; border-radius: 999px; background: var(--amber, #e89a3c); }
.dc-pace-marker { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--ink, #1a1d24); opacity: 0.5; border-radius: 1px; transform: translateX(-1px); }
.dc-ptext { font-size: 11.5px; color: var(--ink-3, #8a8e99); font-variant-numeric: tabular-nums; }
.dc-pace { font-weight: 700; }
.dc-pace.behind { color: var(--red, #d2533a); }
.dc-pace.ok { color: var(--green, #4caf6a); }

.dc-steps { padding: 2px 18px 16px 20px; display: flex; flex-direction: column; }
.dc-part { padding: 12px 0 4px; border-top: 1px solid var(--hairline, rgba(26,29,36,0.08)); }
.dc-part:first-child { border-top: 0; padding-top: 4px; }
.dc-part-name { font-size: 12.5px; font-weight: 700; color: var(--ink, #1a1d24); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
.dc-asm { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 6px; border-radius: 999px; background: var(--purple-soft, rgba(139,95,191,0.12)); color: var(--purple, #8b5fbf); }
.dc-step { display: grid; grid-template-columns: 24px 1fr auto; gap: 10px; align-items: center; padding: 8px 0; }
.dc-step + .dc-step { border-top: 1px solid var(--hairline, rgba(26,29,36,0.05)); }
.dc-step.done { opacity: 0.5; }
.dc-seq { width: 22px; height: 22px; border-radius: 6px; background: var(--surface-3, #f1eee7); color: var(--ink-2, #4a4e5a); font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.dc-mach { font-size: 13.5px; color: var(--ink, #1a1d24); font-weight: 500; }
.dc-unsched { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3, #8a8e99); }

.dc-clear { padding: 34px 20px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.dc-clear-ic { width: 60px; height: 60px; border-radius: 50%; background: var(--green-soft, rgba(76,175,106,0.12)); color: var(--green, #4caf6a); display: flex; align-items: center; justify-content: center; }
.dc-clear-txt { font-size: 15px; font-weight: 600; color: var(--ink, #1a1d24); }

.dc-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-top: 1px solid var(--hairline, rgba(26,29,36,0.08)); background: var(--surface-2, #fbf9f5); flex-wrap: wrap; }
.dc-link { appearance: none; border: 0; background: transparent; color: var(--navy, #1f2a44); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; padding: 6px 4px; }
.dc-link:hover { text-decoration: underline; }
.dc-foot-actions { display: flex; gap: 8px; align-items: center; }
.dc-btn { appearance: none; border: 1px solid transparent; font: inherit; font-size: 13px; font-weight: 600; padding: 9px 16px; border-radius: 10px; cursor: pointer; }
.dc-btn.ghost { background: transparent; border-color: var(--hairline-2, rgba(26,29,36,0.12)); color: var(--ink-2, #4a4e5a); }
.dc-btn.ghost:hover { background: var(--surface-3, #f1eee7); }
.dc-btn.primary { background: var(--navy, #1f2a44); color: #fff; }
.dc-btn.primary:hover { filter: brightness(1.08); }

@media (max-width: 560px) {
  .dc-foot { flex-direction: column-reverse; align-items: stretch; }
  .dc-foot-actions { justify-content: stretch; }
  .dc-btn { flex: 1; }
}
`
