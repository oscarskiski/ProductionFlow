import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TopbarActions from '../components/TopbarActions'
import { useAppData } from '../store/AppDataContext'
import { buildWoodConveyor } from '../lib/woodDayEngine'
import { shiftForDate, effectiveShiftMinutes, timeToMin } from '../lib/scheduleEngine'
import {
  ChevronLeft, ChevronRight, AlertTriangle, Coffee, Filter, Check,
  Info, Trees, ArrowRight, CornerDownRight, ChevronsDown, ChevronsUp,
} from 'lucide-react'

// Read-only preview of the wood day-conveyor, laid out like the Steel Schedule:
// a Day 0–4 strip, a machine filter, and collapsible machine cards whose rows
// are packed into the real shift (start→end times + break rows). Does NOT touch
// the live schedule.

const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI']

const styles = `
:root {
  --bg: #f4f2ee; --bg-2: #ece8e0;
  --surface: #ffffff; --surface-2: #fbf9f5; --surface-3: #f1eee7;
  --ink: #1a1d24; --ink-2: #4a4e5a; --ink-3: #8a8e99;
  --hairline: rgba(26,29,36,0.07); --hairline-2: rgba(26,29,36,0.12);
  --navy: #1f2a44; --navy-soft: rgba(31,42,68,0.08);
  --amber: #e89a3c; --amber-soft: rgba(232,154,60,0.14);
  --red: #d2533a; --red-soft: rgba(210,83,58,0.10);
  --green: #34c759; --green-soft: rgba(52,199,89,0.14);
  --blue: #4677c8; --blue-soft: rgba(70,119,200,0.12);
  --shadow-card: 0 1px 0 rgba(255,255,255,0.6) inset, 0 1px 2px rgba(26,29,36,0.04), 0 8px 22px rgba(26,29,36,0.05);
}
[data-theme="dark"] {
  --bg: #0e1118; --bg-2: #131722;
  --surface: #1a1f2c; --surface-2: #20263488; --surface-3: #232938;
  --ink: #f1f2f5; --ink-2: #b8bcc8; --ink-3: #7c8090;
  --hairline: rgba(255,255,255,0.07); --hairline-2: rgba(255,255,255,0.12);
}
* { box-sizing: border-box; }
html, body { margin:0; padding:0; min-height: 100vh; font-family: 'Inter', -apple-system, system-ui, sans-serif; color: var(--ink); letter-spacing: -0.01em; -webkit-font-smoothing: antialiased; background: radial-gradient(120% 80% at 50% 0%, var(--surface-2) 0%, var(--bg) 40%, var(--bg-2) 100%); }
.main { padding: 18px 22px 30px; min-width: 0; }
.topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
.topbar h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.025em; margin: 0; line-height: 1.1; }
.topbar .sub { font-size: 12px; color: var(--ink-2); margin-top: 3px; }
.topbar-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

.preview-banner { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ink-2); background: var(--blue-soft); border: 1px solid rgba(70,119,200,0.2); border-radius: 12px; padding: 9px 14px; margin-bottom: 12px; }
.preview-banner .ic { color: var(--blue); flex-shrink: 0; }

/* Day strip ──────────────────────────────────────────────── */
.day-strip { display: inline-flex; align-items: stretch; gap: 4px; background: var(--surface); border: 1px solid var(--hairline); border-radius: 18px; padding: 6px; margin-bottom: 12px; box-shadow: var(--shadow-card); width: fit-content; max-width: 100%; }
.day-strip .nav { width: 38px; border: 0; background: transparent; color: var(--ink-2); cursor: pointer; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; transition: background 120ms, color 120ms; }
.day-strip .nav:hover:not(:disabled) { background: var(--surface-2); color: var(--navy); }
.day-strip .nav:disabled { opacity: 0.3; cursor: not-allowed; }
.day-strip .week-pill { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; padding: 6px 14px; border-radius: 12px; background: var(--navy); color: white; min-width: 60px; line-height: 1.05; }
.day-strip .week-pill .wk { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.75; }
.day-strip .week-pill .wn { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.day-strip .day-pill { appearance: none; border: 0; background: transparent; cursor: pointer; padding: 8px 16px; border-radius: 12px; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; color: var(--ink-2); transition: background 120ms, color 120ms; position: relative; min-width: 78px; }
.day-strip .day-pill:hover { background: var(--surface-2); }
.day-strip .day-pill .dn { font-size: 13px; font-weight: 800; color: var(--ink); letter-spacing: -0.01em; }
.day-strip .day-pill .dd { font-size: 10px; font-weight: 700; color: var(--ink-3); letter-spacing: 0.02em; }
.day-strip .day-pill[aria-pressed="true"] { background: var(--amber); box-shadow: 0 4px 12px rgba(232,154,60,0.35); }
.day-strip .day-pill[aria-pressed="true"] .dn { color: white; }
.day-strip .day-pill[aria-pressed="true"] .dd { color: rgba(255,255,255,0.85); }
.day-strip .day-pill.holiday .dn { color: var(--red); }
.day-strip .day-pill .dot { position: absolute; top: 6px; right: 12px; width: 7px; height: 7px; border-radius: 50%; background: var(--red); box-shadow: 0 0 0 2px var(--surface); }

/* Controls row ─────────────────────────────────────────────── */
.controls-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.spacer { flex: 1; }
.ios-switch { width: 38px; height: 22px; border-radius: 999px; background: rgba(120,120,128,0.32); border: 0; padding: 2px; cursor: pointer; display: inline-flex; align-items: center; transition: background 180ms; flex-shrink: 0; }
.ios-switch.on { background: var(--green); }
.ios-switch .knob { width: 18px; height: 18px; border-radius: 50%; background: white; box-shadow: 0 1px 1px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.18); transition: transform 200ms cubic-bezier(0.32,0.72,0,1); }
.ios-switch.on .knob { transform: translateX(16px); }
.toggle-pill { display: inline-flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 999px; padding: 5px 12px 5px 14px; cursor: pointer; user-select: none; box-shadow: 0 1px 2px rgba(26,29,36,0.04); }
.toggle-pill .lbl { font-size: 12px; font-weight: 600; color: var(--ink-2); }
.mini-btn { appearance: none; border: 1px solid var(--hairline-2); background: var(--surface); color: var(--ink-2); font: inherit; font-size: 12px; font-weight: 600; padding: 7px 12px; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 1px 2px rgba(26,29,36,0.04); }
.mini-btn:hover { background: var(--surface-2); }
.mini-btn .ic { width: 13px; height: 13px; color: var(--ink-3); }

/* Machines filter */
.filter-wrap { position: relative; }
.filter-btn { appearance: none; border: 1px solid var(--hairline-2); background: var(--surface); color: var(--ink); font: inherit; font-size: 12px; font-weight: 600; padding: 7px 13px; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; box-shadow: 0 1px 2px rgba(26,29,36,0.04); }
.filter-btn:hover { background: var(--surface-2); }
.filter-btn.has-filter { background: var(--amber-soft); border-color: rgba(232,154,60,0.4); color: var(--amber); }
.filter-btn .badge { font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: var(--surface-2); color: var(--ink-3); font-variant-numeric: tabular-nums; }
.filter-btn.has-filter .badge { background: var(--amber); color: white; }
.filter-popover { position: absolute; top: calc(100% + 8px); left: 0; z-index: 30; min-width: 280px; max-height: 440px; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 14px; box-shadow: 0 12px 32px rgba(26,29,36,0.16); overflow: hidden; }
.filter-popover .pop-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--hairline); background: var(--surface-2); }
.filter-popover .pop-head .ttl { font-size: 12px; font-weight: 700; color: var(--ink-2); text-transform: uppercase; letter-spacing: 0.06em; }
.filter-popover .pop-head .actions { display: flex; gap: 6px; }
.filter-popover .pop-head button { appearance: none; border: 0; background: transparent; color: var(--navy); font: inherit; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 6px; cursor: pointer; }
.filter-popover .pop-list { overflow-y: auto; padding: 4px 0; }
.filter-popover .pop-item { display: flex; align-items: center; gap: 10px; padding: 9px 14px; cursor: pointer; user-select: none; }
.filter-popover .pop-item:hover { background: var(--surface-2); }
.filter-popover .pop-item .cbx { width: 18px; height: 18px; border-radius: 5px; border: 1.5px solid var(--hairline-2); background: var(--surface); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.filter-popover .pop-item.checked .cbx { background: var(--navy); border-color: var(--navy); color: white; }
.filter-popover .pop-item .lbl { font-size: 13px; color: var(--ink); font-weight: 500; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.filter-popover .pop-item .daytag { font-size: 9px; font-weight: 700; color: var(--blue); background: var(--blue-soft); padding: 1px 6px; border-radius: 4px; flex-shrink: 0; }
.filter-popover .pop-item .jobcount { font-size: 11px; font-weight: 700; color: var(--ink-3); font-variant-numeric: tabular-nums; flex-shrink: 0; min-width: 14px; text-align: right; }

/* Warnings */
.warns { background: var(--surface); border: 1px solid rgba(210,83,58,0.25); border-radius: 14px; padding: 12px 14px; margin-bottom: 12px; }
.warns h4 { margin: 0 0 8px; font-size: 12px; font-weight: 700; color: var(--red); display: flex; align-items: center; gap: 6px; cursor: pointer; }
.warns ul { margin: 0; padding-left: 18px; }
.warns li { font-size: 12px; color: var(--ink-2); margin-bottom: 3px; }

.state { padding: 48px 16px; text-align: center; color: var(--ink-3); font-size: 13px; background: var(--surface); border: 1px solid var(--hairline); border-radius: 18px; }

/* Setup prompt */
.setup { background: var(--surface); border: 1px solid var(--hairline); border-radius: 18px; box-shadow: var(--shadow-card); padding: 36px 28px; text-align: center; max-width: 620px; margin: 8px auto; }
.setup .badge { width: 52px; height: 52px; border-radius: 16px; background: var(--green-soft); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px; }
.setup .badge .ic { color: var(--green); }
.setup h3 { margin: 0 0 8px; font-size: 18px; font-weight: 600; color: var(--ink); }
.setup p { margin: 0 0 8px; font-size: 13px; color: var(--ink-2); line-height: 1.5; }
.setup .prog { font-size: 13px; font-weight: 600; color: var(--ink); margin: 12px 0; }
.setup .prog b { color: var(--amber); }
.setup .names { font-size: 12px; color: var(--ink-3); background: var(--surface-2); border: 1px solid var(--hairline); border-radius: 10px; padding: 10px 12px; margin: 12px auto 4px; text-align: left; max-width: 480px; }
.setup .names b { color: var(--ink-2); display: block; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
.setup .cta { display: inline-flex; align-items: center; gap: 7px; margin-top: 16px; background: var(--navy); color: white; text-decoration: none; font-size: 13px; font-weight: 600; padding: 11px 18px; border-radius: 11px; box-shadow: 0 6px 14px rgba(31,42,68,0.22); }
.setup .cta .ic { color: white; }

/* Machine card ──────────────────────────────────────────── */
.machine-card { background: var(--surface); border: 1px solid var(--hairline); border-radius: 18px; margin-bottom: 10px; box-shadow: var(--shadow-card); overflow: hidden; position: relative; }
.machine-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--stripe, var(--ink-3)); }
.machine-card.idle::before { opacity: 0.35; }
.machine-card.overflowed { border-color: rgba(210,83,58,0.4); box-shadow: 0 0 0 1px rgba(210,83,58,0.15), var(--shadow-card); }
.mc-head { display: grid; grid-template-columns: 18px 1fr auto auto auto; gap: 18px; align-items: center; padding: 16px 22px 16px 26px; cursor: pointer; user-select: none; }
.mc-head .chev { color: var(--ink-3); transition: transform 180ms; flex-shrink: 0; }
.machine-card.open .mc-head .chev { transform: rotate(90deg); }
.mc-head .name-block { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mc-head .name { font-size: 17px; font-weight: 700; color: var(--ink); letter-spacing: -0.02em; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-flex; align-items: center; gap: 8px; }
.mc-head .name .daytag { font-size: 9px; font-weight: 700; color: var(--blue); background: var(--blue-soft); padding: 2px 7px; border-radius: 4px; letter-spacing: 0.04em; flex-shrink: 0; }
.mc-head .substats { font-size: 10px; color: var(--ink-3); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; }
.mc-head .substats .idle-tag { font-style: italic; text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 11px; }
.mc-head .num-stack { display: flex; align-items: baseline; gap: 14px; }
.mc-head .num-stack .num { display: flex; flex-direction: column; align-items: flex-end; line-height: 1; gap: 3px; }
.mc-head .num-stack .num .v { font-size: 18px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.mc-head .num-stack .num .v.muted { color: var(--ink-3); }
.mc-head .num-stack .num .k { font-size: 9px; color: var(--ink-3); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
.mc-head .mini-progress { width: 160px; height: 8px; background: var(--surface-3); border-radius: 999px; position: relative; overflow: hidden; }
.mc-head .mini-progress .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--stripe, var(--navy)); border-radius: 999px; }
.mc-head .mini-progress.over .fill { background: var(--red); }
.mc-head .over-badge { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: 8px; background: var(--red); color: white; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; }
.mc-body { display: none; border-top: 1px solid var(--hairline); }
.machine-card.open .mc-body { display: block; }
.empty-row { padding: 18px 22px; font-size: 12px; color: var(--ink-3); font-style: italic; }

/* Rows ──────────────────────────────────────────────────── */
.row { display: grid; grid-template-columns: 24px 92px 88px 1fr auto; gap: 14px; align-items: center; padding: 12px 18px 12px 22px; }
.row + .row { border-top: 1px solid var(--hairline); }
.row:hover { background: var(--surface-2); }
.row .seq { width: 22px; height: 22px; border-radius: 6px; background: var(--amber-soft); color: var(--amber); font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums; }
.row .when { font-size: 13px; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; line-height: 1.15; }
.row .when .dash { color: var(--ink-3); margin-right: 2px; }
.row .ord-pri { display: flex; flex-direction: column; gap: 2px; }
.row .ord-pri .ord { font-size: 13px; font-weight: 700; color: var(--stripe, var(--navy)); }
.row .ord-pri .carry { font-size: 8px; color: var(--amber); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; display: inline-flex; align-items: center; gap: 3px; }
.row .info { min-width: 0; }
.row .info .part { font-size: 14px; font-weight: 700; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em; line-height: 1.2; display: inline-flex; align-items: center; gap: 8px; max-width: 100%; }
.row .info .asm-tag { display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 5px; background: var(--blue-soft); color: var(--blue); font-size: 9px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; flex-shrink: 0; }
.row .info .meta { font-size: 11px; color: var(--ink-3); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
.row .info .meta .prod-tag { color: var(--ink-2); font-weight: 600; }
.row .info .meta .setup-tag { color: var(--amber); font-weight: 600; }
.row .parts { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; min-width: 84px; }
.row .parts .count { font-size: 28px; font-weight: 700; color: var(--stripe, var(--ink)); line-height: 0.95; font-variant-numeric: tabular-nums; letter-spacing: -0.025em; }
.row .parts .rate-label { font-size: 9px; color: var(--ink-3); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 5px; font-variant-numeric: tabular-nums; }
.row .parts .rate-label .sep { color: var(--hairline-2); margin: 0 4px; font-weight: 400; }

.break-row { display: grid; grid-template-columns: 24px 92px 1fr auto; gap: 14px; align-items: center; padding: 10px 18px 10px 22px; background: var(--surface-2); }
.break-row + .row, .row + .break-row, .break-row + .break-row { border-top: 1px solid var(--hairline); }
.break-row .ic { color: var(--ink-3); }
.break-row .when { font-size: 12px; font-weight: 600; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.break-row .label { font-size: 11px; color: var(--ink-3); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
.break-row .duration { font-size: 11px; color: var(--ink-3); font-weight: 600; font-variant-numeric: tabular-nums; }

@media (max-width: 860px) {
  .mc-head { grid-template-columns: 18px 1fr auto; gap: 12px; padding: 14px 14px 14px 18px; }
  .mc-head .num-stack, .mc-head .mini-progress { display: none; }
  .row { grid-template-columns: 24px 84px 1fr; }
  .row .ord-pri, .row .parts { display: none; }
}
`

// ---------- helpers ----------
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const strToDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const minLabel = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const durationLabel = (a, b) => {
  const t = b - a, h = Math.floor(t / 60), m = t % 60
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`
}
function buildTimeline(jobs, shift) {
  const items = []
  for (const j of jobs) items.push({ type: 'job', startMin: j.startMin, endMin: j.endMin, data: j })
  for (const b of shift.breaks) items.push({ type: 'break', startMin: timeToMin(b.start), endMin: timeToMin(b.end), label: b.label })
  items.sort((a, b) => a.startMin - b.startMin)
  return items
}

function IOSSwitch({ on, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`ios-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span className="knob" />
    </button>
  )
}

function MachinesFilter({ machines, hidden, onToggle, onAll, onNone, jobCountByName, dayByName }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  const visible = machines.length - hidden.size
  return (
    <div className="filter-wrap" ref={ref}>
      <button type="button" className={`filter-btn ${hidden.size > 0 ? 'has-filter' : ''}`} onClick={() => setOpen((o) => !o)}>
        <Filter size={13} /> Machines <span className="badge">{visible}/{machines.length}</span>
      </button>
      {open && (
        <div className="filter-popover">
          <div className="pop-head">
            <span className="ttl">Show machines</span>
            <div className="actions"><button onClick={onAll}>All</button><button onClick={onNone}>None</button></div>
          </div>
          <div className="pop-list">
            {machines.map((name) => {
              const checked = !hidden.has(name)
              return (
                <div key={name} className={`pop-item ${checked ? 'checked' : ''}`} onClick={() => onToggle(name)}>
                  <span className="cbx">{checked && <Check size={12} strokeWidth={3} />}</span>
                  <span className="lbl">{name}</span>
                  {dayByName.get(name) != null && <span className="daytag">D{dayByName.get(name)}</span>}
                  <span className="jobcount">{jobCountByName.get(name) || 0}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function JobRow({ job, sequence }) {
  const dur = durationLabel(job.startMin, job.endMin)
  const orderLabel = job.ord_nr ? `#${job.ord_nr}` : '—'
  const showProd = job.partName !== job.productName && job.productName
  return (
    <div className="row">
      <span className="seq">{sequence}</span>
      <div className="when">
        {minLabel(job.startMin)}<br />
        <span className="dash">→</span>{minLabel(job.endMin)}
      </div>
      <div className="ord-pri">
        <span className="ord">{orderLabel}</span>
        {job.carried && <span className="carry"><CornerDownRight size={9} /> from prev day</span>}
      </div>
      <div className="info">
        <div className="part">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.partName}</span>
          {job.isAssembly && <span className="asm-tag" title="Assembly — waits for all other parts">ASM</span>}
        </div>
        <div className="meta">
          {showProd && <><span className="prod-tag">{job.productName}</span> · </>}
          {job.customerName || '—'} · Step {job.stepSeq} · {dur}
          {job.setupMin > 0 && <span className="setup-tag"> · +{job.setupMin}m setup</span>}
        </div>
      </div>
      <div className="parts">
        <span className="count">{job.units}</span>
        <span className="rate-label">
          {job.split ? `OF ${job.splitTotal} SPLIT` : 'PARTS'}
          <span className="sep">·</span>{job.seconds_per_part}S/PT
        </span>
      </div>
    </div>
  )
}

function BreakRow({ startMin, endMin, label }) {
  return (
    <div className="break-row">
      <Coffee size={13} className="ic" />
      <span className="when">{minLabel(startMin)}–{minLabel(endMin)}</span>
      <span className="label">{label}</span>
      <span className="duration">{durationLabel(startMin, endMin)}</span>
    </div>
  )
}

function MachineCard({ machineName, color, day, dayPlan, open, onToggle }) {
  const jobs = dayPlan?.jobs || []
  const isIdle = jobs.length === 0
  const totalParts = jobs.reduce((s, j) => s + (j.units || 0), 0)
  const totalWorkMin = dayPlan?.totalWorkMin || 0
  const capacity = dayPlan?.capacity || 0
  const pct = capacity > 0 ? Math.min(100, (totalWorkMin / capacity) * 100) : 0
  const overflowed = !!dayPlan?.overflowed
  const shift = useMemo(() => (jobs.length ? shiftForDate(strToDate(dayPlan._date)) : null), [jobs, dayPlan])
  const items = useMemo(() => (shift ? buildTimeline(jobs, shift) : []), [jobs, shift])

  return (
    <div className={`machine-card ${open ? 'open' : ''} ${overflowed ? 'overflowed' : ''} ${isIdle ? 'idle' : ''}`} style={{ '--stripe': color }}>
      <div className="mc-head" onClick={onToggle}>
        <ChevronRight size={16} className="chev" />
        <div className="name-block">
          <span className="name">{machineName}{day != null && <span className="daytag">Day {day}</span>}</span>
          <span className="substats">
            {isIdle ? <span className="idle-tag">No work this day</span> : <>{jobs.length} job{jobs.length === 1 ? '' : 's'} · {totalParts} parts · {totalWorkMin} of {capacity} min</>}
          </span>
        </div>
        <div className="num-stack">
          <div className="num"><span className={`v ${isIdle ? 'muted' : ''}`}>{jobs.length}</span><span className="k">Jobs</span></div>
          <div className="num"><span className={`v ${isIdle ? 'muted' : ''}`}>{totalParts}</span><span className="k">Parts</span></div>
        </div>
        <div className={`mini-progress ${overflowed ? 'over' : ''}`} title={`${totalWorkMin} / ${capacity} min`}>
          <div className="fill" style={{ width: `${pct}%` }} />
        </div>
        {overflowed ? <span className="over-badge"><AlertTriangle size={11} /> Over</span> : <span style={{ width: 0 }} />}
      </div>
      {open && (
        <div className="mc-body">
          {isIdle ? (
            <div className="empty-row">No work on this machine this day.</div>
          ) : (
            (() => {
              let seq = 0
              return items.map((it, i) => {
                if (it.type === 'job') { seq++; return <JobRow key={`j${i}`} job={it.data} sequence={seq} /> }
                return <BreakRow key={`b${i}`} startMin={it.startMin} endMin={it.endMin} label={it.label} />
              })
            })()
          )}
        </div>
      )}
    </div>
  )
}

export default function WoodConveyorScreen() {
  const {
    orders, machines: allMachines, loading, error,
    productByCode, partsByProduct, stepsByPart, machineByName, customerByCode, holidaySet,
  } = useAppData()

  const woodSetup = useMemo(() => {
    const wood = (allMachines || []).filter((m) => m.department === 'wood')
    return { total: wood.length, set: wood.filter((m) => m.wood_day != null).length }
  }, [allMachines])

  const activeOrders = useMemo(
    () => (orders || []).filter((o) => o.status !== 'completed' && !o.shipped_at),
    [orders],
  )

  const result = useMemo(() => buildWoodConveyor({
    orders: activeOrders,
    productByCode, partsByProduct, stepsByPart, machineByName, customerByCode, holidaySet,
  }), [activeOrders, productByCode, partsByProduct, stepsByPart, machineByName, customerByCode, holidaySet])

  const weeks = result.weeks
  const [weekIdx, setWeekIdx] = useState(0)
  const [dayIndex, setDayIndex] = useState(0)
  const [hidden, setHidden] = useState(new Set())
  const [onlyWithWork, setOnlyWithWork] = useState(true)
  const [openCards, setOpenCards] = useState(new Set())
  const [showWarns, setShowWarns] = useState(false)

  const safeWeekIdx = Math.min(weekIdx, Math.max(0, weeks.length - 1))
  const week = weeks[safeWeekIdx] || null
  const dateStr = week ? week.dates[dayIndex] : null

  // Wood machines assigned to this day (for the "show idle" option) + those
  // that actually have work today.
  const dayByName = useMemo(() => {
    const m = new Map()
    for (const mach of (allMachines || [])) if (mach.department === 'wood') m.set(mach.name, mach.wood_day)
    return m
  }, [allMachines])

  const { cards, jobCountByName, filterList } = useMemo(() => {
    if (!dateStr) return { cards: [], jobCountByName: new Map(), filterList: [] }
    const jobCount = new Map()
    // Machines that have a plan today.
    const withWork = []
    for (const [name, mach] of result.machines) {
      const plan = mach.days.get(dateStr)
      if (plan) { jobCount.set(name, plan.jobs.length); withWork.push({ name, mach, plan }) }
    }
    // Machines belonging to this day but idle (only shown when toggle off).
    const idleForDay = []
    for (const [name, wd] of dayByName) {
      if (wd === dayIndex && !jobCount.has(name)) {
        idleForDay.push({ name, mach: { color: (allMachines.find((x) => x.name === name)?.color) || '#9aa0ad', day: wd }, plan: null })
      }
    }
    let list = onlyWithWork ? withWork : [...withWork, ...idleForDay]
    list = list.filter((c) => !hidden.has(c.name))
    list.sort((a, b) => {
      const ad = a.mach.day ?? 99, bd = b.mach.day ?? 99
      if (ad !== bd) return ad - bd
      return a.name.localeCompare(b.name)
    })
    // Filter dropdown lists every machine relevant to this day.
    const flNames = new Set([...withWork.map((c) => c.name)])
    for (const c of idleForDay) flNames.add(c.name)
    const filterList = [...flNames].sort()
    return { cards: list, jobCountByName: jobCount, filterList }
  }, [result, dateStr, dayIndex, onlyWithWork, hidden, dayByName, allMachines])

  const toggleCard = (name) => setOpenCards((prev) => {
    const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n
  })
  const expandAll = () => setOpenCards(new Set(cards.map((c) => c.name)))
  const collapseAll = () => setOpenCards(new Set())

  const dayTotals = useMemo(() => {
    let jobs = 0, parts = 0, over = 0
    for (const c of cards) {
      if (!c.plan) continue
      jobs += c.plan.jobs.length
      parts += c.plan.jobs.reduce((s, j) => s + (j.units || 0), 0)
      if (c.plan.overflowed) over++
    }
    return { jobs, parts, over }
  }, [cards])

  const uniqueWarns = useMemo(() => {
    const seen = new Set(), out = []
    if (result.unassigned.size > 0) {
      const names = [...result.unassigned].sort()
      out.push(`${names.length} machine${names.length === 1 ? '' : 's'} still need a conveyor day (Machines → Wood): ${names.join(', ')}`)
    }
    for (const w of result.warnings) {
      if (w.type === 'unassigned') continue
      if (seen.has(w.message)) continue
      seen.add(w.message); out.push(w.message)
    }
    return out
  }, [result])

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <Sidebar />
        <main className="main">
          <div className="topbar">
            <div>
              <h1>Wood Conveyor</h1>
              <div className="sub">Pick a production day (0–4) · each machine runs its set day</div>
            </div>
            <div className="topbar-actions"><TopbarActions /></div>
          </div>

          <div className="preview-banner">
            <Info size={15} strokeWidth={2} className="ic" />
            <span>Read-only preview. Work that doesn't fit a machine's day spills to the front of its next day. This does <b>not</b> change your live schedule.</span>
          </div>

          {loading && <div className="state">Loading…</div>}
          {error && <div className="state" style={{ color: 'var(--red)' }}>Failed to load: {error}</div>}

          {!loading && !error && woodSetup.set === 0 && (
            <div className="setup">
              <span className="badge"><Trees size={26} strokeWidth={1.8} className="ic" /></span>
              <h3>Set up the wood conveyor</h3>
              <p>Each wood machine needs a day number — 0 = Monday (first day) through 4 = Friday (finishing) — before the preview can lay out the week.</p>
              <div className="prog">You've set <b>0</b> of {woodSetup.total} wood machines.</div>
              {result.unassigned.size > 0 && (
                <div className="names">
                  <b>Machines your current orders use</b>
                  {[...result.unassigned].sort().join(', ')}
                </div>
              )}
              <NavLink to="/machines" className="cta">Open Machines <ArrowRight size={15} className="ic" /></NavLink>
            </div>
          )}

          {!loading && !error && woodSetup.set > 0 && weeks.length === 0 && (
            <div className="state">
              No wood orders land on the conveyor yet. Check that your active orders have a production week
              (run Recalculate on the Import screen), and that the machines they use have a day set.
            </div>
          )}

          {!loading && !error && woodSetup.set > 0 && weeks.length > 0 && week && (
            <>
              {/* Day strip */}
              <div className="day-strip">
                <button className="nav" onClick={() => setWeekIdx((i) => Math.max(0, i - 1))} disabled={safeWeekIdx === 0} aria-label="Previous week"><ChevronLeft size={16} /></button>
                <div className="week-pill"><span className="wk">WK</span><span className="wn">{week.week}</span></div>
                {DAY_NAMES.map((nm, i) => {
                  const d = week.dates[i]
                  const dd = strToDate(d)
                  const isHol = holidaySet.has(d)
                  return (
                    <button key={nm} className={`day-pill ${isHol ? 'holiday' : ''}`} aria-pressed={dayIndex === i} onClick={() => setDayIndex(i)}>
                      <span className="dn">DAY {i}</span>
                      <span className="dd">{DOW[dd.getDay()]} {dd.getDate()} {MON[dd.getMonth()]}</span>
                      {isHol && <span className="dot" />}
                    </button>
                  )
                })}
                <button className="nav" onClick={() => setWeekIdx((i) => Math.min(weeks.length - 1, i + 1))} disabled={safeWeekIdx >= weeks.length - 1} aria-label="Next week"><ChevronRight size={16} /></button>
              </div>

              {/* Controls */}
              <div className="controls-row">
                <MachinesFilter
                  machines={filterList}
                  hidden={hidden}
                  onToggle={(name) => setHidden((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n })}
                  onAll={() => setHidden(new Set())}
                  onNone={() => setHidden(new Set(filterList))}
                  jobCountByName={jobCountByName}
                  dayByName={dayByName}
                />
                <div className="toggle-pill" onClick={() => setOnlyWithWork((v) => !v)}>
                  <IOSSwitch on={onlyWithWork} onChange={setOnlyWithWork} />
                  <span className="lbl">Only with work</span>
                </div>
                <div className="spacer" />
                <span style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 600 }}>
                  <b style={{ color: 'var(--ink)' }}>{dayTotals.jobs}</b> jobs · <b style={{ color: 'var(--ink)' }}>{dayTotals.parts}</b> parts
                  {dayTotals.over > 0 && <span style={{ color: 'var(--red)' }}> · {dayTotals.over} over</span>}
                </span>
                <button className="mini-btn" onClick={expandAll}><ChevronsDown size={13} className="ic" /> Expand</button>
                <button className="mini-btn" onClick={collapseAll}><ChevronsUp size={13} className="ic" /> Collapse</button>
              </div>

              {/* Warnings (collapsed) */}
              {uniqueWarns.length > 0 && (
                <div className="warns">
                  <h4 onClick={() => setShowWarns((v) => !v)}>
                    <AlertTriangle size={14} /> {uniqueWarns.length} issue{uniqueWarns.length === 1 ? '' : 's'} to review {showWarns ? '▲' : '▼'}
                  </h4>
                  {showWarns && <ul>{uniqueWarns.slice(0, 20).map((t, i) => <li key={i}>{t}</li>)}</ul>}
                </div>
              )}

              {/* Machine cards */}
              {cards.length === 0 ? (
                <div className="state">No machines with work on Day {dayIndex} of week {week.week}.</div>
              ) : (
                cards.map((c) => (
                  <MachineCard
                    key={c.name}
                    machineName={c.name}
                    color={c.mach.color}
                    day={c.mach.day}
                    dayPlan={c.plan ? { ...c.plan, _date: dateStr } : null}
                    open={openCards.has(c.name)}
                    onToggle={() => toggleCard(c.name)}
                  />
                ))
              )}
            </>
          )}
        </main>
      </div>
    </>
  )
}
