import { useMemo, useState } from 'react'
import Sidebar from '../components/Sidebar'
import TopbarActions from '../components/TopbarActions'
import { useAppData } from '../store/AppDataContext'
import { computeConstraintLoad, loadBand, fmtHrs } from '../lib/constraint'
import { Gauge, AlertTriangle, ChevronRight } from 'lucide-react'

const DEPTS = [
  { id: 'all', label: 'All' },
  { id: 'steel', label: 'Steel' },
  { id: 'wood', label: 'Wood' },
  { id: 'upholstery', label: 'Upholstery' },
  { id: 'dispatch', label: 'Dispatch' },
]

// Goldratt's voice — a one-line prescription for the drum based on its load.
function drumNote(loadPct) {
  if (loadPct >= 100) return "Overloaded — it can't finish this week's work inside the week. Elevate it (a shift, a second machine, offload work) or the whole plant slips. Every minute here is throughput."
  if (loadPct >= 85) return 'Running near its limit. Protect it: never let it sit idle, keep a buffer of work in front of it, and inspect parts BEFORE it so it never runs scrap. An hour lost here is an hour lost for the whole plant.'
  if (loadPct >= 50) return 'Your busiest machine this week, but it still has slack — so your true limit may be elsewhere, or the week isn’t fully loaded yet. Watch it as work is added.'
  return 'Lightly loaded. You have plenty of capacity this week — your constraint is likely the market (finding more orders), not the floor.'
}

export default function ConstraintScreen() {
  const {
    enrichedOrders, machines, partsByProduct, stepsByPart, productByCode, holidaySet,
  } = useAppData()
  const year = useMemo(() => new Date().getFullYear(), [])

  // Weeks that actually have scheduled orders.
  const weeks = useMemo(() => {
    const set = new Set()
    for (const o of (enrichedOrders || [])) if (o.prod_week != null) set.add(o.prod_week)
    return [...set].sort((a, b) => a - b)
  }, [enrichedOrders])

  const [week, setWeek] = useState(null)
  const activeWeek = week ?? weeks[0] ?? null
  const [dept, setDept] = useState('all')
  const [openRows, setOpenRows] = useState(() => new Set())
  const toggleRow = (name) => setOpenRows((prev) => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })

  const result = useMemo(() => {
    if (activeWeek == null) return { rows: [], availableMin: 0, weekDays: 0 }
    return computeConstraintLoad({
      orders: enrichedOrders, week: activeWeek, year,
      partsByProduct, stepsByPart, productByCode, machines, holidaySet: holidaySet || new Set(),
    })
  }, [enrichedOrders, activeWeek, year, partsByProduct, stepsByPart, productByCode, machines, holidaySet])

  const rows = useMemo(
    () => (dept === 'all' ? result.rows : result.rows.filter((r) => r.department === dept)),
    [result.rows, dept],
  )
  const constraint = rows[0] || null

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <Sidebar />
        <main className="main">
          <div className="topbar">
            <div>
              <h1>The Constraint</h1>
              <div className="sub">Your factory&apos;s drum — the machine that sets the pace · Theory of Constraints</div>
            </div>
            <div className="topbar-actions"><TopbarActions /></div>
          </div>

          <div className="drum-filters">
            <div className="week-tabs">
              {weeks.length === 0 && <span className="drum-nowk">No scheduled weeks yet</span>}
              {weeks.map((w) => (
                <button key={w} className="week-tab" aria-pressed={w === activeWeek} onClick={() => setWeek(w)}>Wk {w}</button>
              ))}
            </div>
            <div className="dept-tabs">
              {DEPTS.map((d) => (
                <button key={d.id} className="dept-tab" aria-pressed={dept === d.id} onClick={() => setDept(d.id)}>{d.label}</button>
              ))}
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="card drum-empty">
              No routed work found for this week/department. Set prod weeks on Priority and make sure products have machine routings.
            </div>
          ) : (
            <>
              <div className={`drum-hero band-${loadBand(constraint.loadPct)}`}>
                <div className="drum-hero-icon"><Gauge size={30} strokeWidth={1.8} /></div>
                <div className="drum-hero-body">
                  <div className="drum-hero-label">The constraint this week — your Herbie</div>
                  <div className="drum-hero-name">{constraint.name}</div>
                  <div className="drum-hero-meta">
                    {fmtHrs(constraint.workMin)} demanded · {fmtHrs(constraint.availableMin)} available · {constraint.orderCount} orders
                  </div>
                  <div className="drum-hero-note">{drumNote(constraint.loadPct)}</div>
                </div>
                <div className="drum-hero-pct">{Math.round(constraint.loadPct)}<span>%</span></div>
              </div>

              <div className="section-label">Machine load — highest first</div>
              <div className="drum-list">
                {rows.map((r, i) => {
                  const isOpen = openRows.has(r.name)
                  return (
                    <div className={`drum-item ${isOpen ? 'open' : ''}`} key={r.name}>
                      <div
                        className={`drum-row band-${loadBand(r.loadPct)} ${i === 0 ? 'is-constraint' : ''}`}
                        onClick={() => toggleRow(r.name)}
                        role="button"
                        aria-expanded={isOpen}
                      >
                        <span className="drum-rank">{i + 1}</span>
                        <div className="drum-info">
                          <div className="drum-name">
                            <ChevronRight size={14} strokeWidth={2.2} className="drum-chev" />
                            {r.name}
                            {i === 0 && <span className="drum-tag">Constraint / Herbie</span>}
                            {r.loadPct >= 100 && <span className="drum-tag over"><AlertTriangle size={10} /> over</span>}
                            {!r.active && <span className="drum-tag off">disabled</span>}
                          </div>
                          <div className="drum-sub">{r.department || '—'} · {r.orderCount} orders · {r.productCount} products</div>
                        </div>
                        <div className="drum-bar">
                          <div className="drum-fill" style={{ width: `${Math.min(100, r.loadPct)}%` }} />
                        </div>
                        <div className="drum-nums">
                          <b>{Math.round(r.loadPct)}%</b>
                          <span>{fmtHrs(r.workMin)} / {fmtHrs(r.availableMin)}</span>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="drum-breakdown">
                          <div className="drum-bd-head">
                            <span>Product</span>
                            <span>Orders</span>
                            <span>Machine time</span>
                          </div>
                          {r.breakdown.length === 0 ? (
                            <div className="drum-bd-empty">No product detail for this machine.</div>
                          ) : r.breakdown.map((b) => {
                            const prod = productByCode.get(b.code)
                            return (
                              <div className="drum-bd-row" key={b.code}>
                                <div className="drum-bd-prod">
                                  <span className="drum-bd-code">{b.code}</span>
                                  {prod?.description && <span className="drum-bd-desc">{prod.description}</span>}
                                </div>
                                <span className="drum-bd-orders">{b.orderCount}</span>
                                <span className="drum-bd-hrs">{fmtHrs(b.workMin)}</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </main>
      </div>
    </>
  )
}

const styles = `
:root {
  --bg: #f4f2ee; --bg-2: #ece8e0;
  --surface: #ffffff; --surface-2: #fbf9f5; --surface-3: #f1eee7;
  --ink: #1a1d24; --ink-2: #4a4e5a; --ink-3: #8a8e99;
  --hairline: rgba(26,29,36,0.08); --hairline-2: rgba(26,29,36,0.12);
  --navy: #1f2a44; --navy-soft: rgba(31,42,68,0.08);
  --amber: #e89a3c; --amber-soft: rgba(232,154,60,0.14);
  --red: #d2533a; --red-soft: rgba(210,83,58,0.10);
  --green: #4caf6a; --green-soft: rgba(76,175,106,0.12);
  --blue: #4677c8; --blue-soft: rgba(70,119,200,0.12);
  --shadow-card: 0 1px 0 rgba(255,255,255,0.6) inset, 0 1px 2px rgba(26,29,36,0.04), 0 8px 20px rgba(26,29,36,0.04);
  --r-md: 14px; --r-lg: 20px;
}
[data-theme="dark"] {
  --bg: #0e1118; --bg-2: #131722;
  --surface: #1a1f2c; --surface-2: #202634; --surface-3: #232938;
  --ink: #f1f2f5; --ink-2: #b8bcc8; --ink-3: #7c8090;
  --hairline: rgba(255,255,255,0.07); --hairline-2: rgba(255,255,255,0.12);
  --navy: #2e3d63; --navy-soft: rgba(88,114,180,0.18);
}
* { box-sizing: border-box; }
html, body {
  margin:0; padding:0; min-height: 100vh;
  font-family: 'Inter', -apple-system, system-ui, sans-serif;
  color: var(--ink); letter-spacing: -0.01em; -webkit-font-smoothing: antialiased;
  background: radial-gradient(120% 80% at 50% 0%, var(--surface-2) 0%, var(--bg) 40%, var(--bg-2) 100%);
}
.main { padding: 18px 22px 30px; min-width: 0; }
.topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
.topbar h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.025em; margin: 0; line-height: 1.1; }
.topbar .sub { font-size: 12px; color: var(--ink-2); margin-top: 3px; }
.topbar-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.section-label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); margin: 18px 2px 8px; }

.drum-filters { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.week-tabs, .dept-tabs { display: flex; gap: 4px; padding: 3px; background: var(--surface-2); border: 1px solid var(--hairline); border-radius: 10px; }
.week-tab, .dept-tab { appearance: none; border: 0; background: transparent; color: var(--ink-2); font: inherit; font-size: 12px; font-weight: 500; padding: 6px 12px; border-radius: 7px; cursor: pointer; }
.week-tab[aria-pressed="true"], .dept-tab[aria-pressed="true"] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 0 rgba(255,255,255,0.6) inset, 0 2px 4px rgba(26,29,36,0.05); font-weight: 600; }
.drum-nowk { font-size: 12px; color: var(--ink-3); padding: 6px 8px; }

.card { background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--r-md); padding: 16px 18px; box-shadow: var(--shadow-card); }
.drum-empty { color: var(--ink-2); font-size: 13px; }

/* Hero — the named constraint */
.drum-hero {
  display: grid; grid-template-columns: auto 1fr auto; gap: 18px; align-items: center;
  background: var(--surface); border: 1px solid var(--hairline); border-left: 4px solid var(--navy);
  border-radius: var(--r-lg); padding: 20px 22px; box-shadow: var(--shadow-card); margin-bottom: 6px;
}
.drum-hero.band-over { border-left-color: var(--red); background: linear-gradient(90deg, var(--red-soft), var(--surface) 40%); }
.drum-hero.band-tight { border-left-color: var(--amber); background: linear-gradient(90deg, var(--amber-soft), var(--surface) 40%); }
.drum-hero.band-mid { border-left-color: var(--blue); }
.drum-hero.band-slack { border-left-color: var(--green); }
.drum-hero-icon { width: 56px; height: 56px; border-radius: 16px; display: flex; align-items: center; justify-content: center; background: var(--navy-soft); color: var(--navy); }
.drum-hero.band-over .drum-hero-icon { background: var(--red-soft); color: var(--red); }
.drum-hero.band-tight .drum-hero-icon { background: var(--amber-soft); color: var(--amber); }
.drum-hero-label { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
.drum-hero-name { font-size: 26px; font-weight: 700; color: var(--ink); letter-spacing: -0.02em; margin: 2px 0 4px; }
.drum-hero-meta { font-size: 12px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.drum-hero-note { font-size: 13px; color: var(--ink-2); margin-top: 8px; max-width: 62ch; line-height: 1.45; }
.drum-hero-pct { font-size: 42px; font-weight: 800; color: var(--navy); letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.drum-hero.band-over .drum-hero-pct { color: var(--red); }
.drum-hero.band-tight .drum-hero-pct { color: var(--amber); }
.drum-hero-pct span { font-size: 20px; font-weight: 600; color: var(--ink-3); margin-left: 1px; }

/* Ranked list */
.drum-list { display: flex; flex-direction: column; gap: 8px; }
.drum-item { background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--r-md); box-shadow: var(--shadow-card); overflow: hidden; }
.drum-item.open { border-color: var(--hairline-2); }
.drum-row {
  display: grid; grid-template-columns: 30px 1fr minmax(120px, 240px) auto; gap: 14px; align-items: center;
  padding: 12px 16px; cursor: pointer; transition: background 120ms ease;
}
.drum-row:hover { background: var(--surface-2); }
.drum-row.is-constraint { box-shadow: inset 3px 0 0 var(--navy); }
.drum-chev { color: var(--ink-3); flex-shrink: 0; transition: transform 180ms ease; margin-right: 1px; }
.drum-item.open .drum-chev { transform: rotate(90deg); }

/* Per-machine product breakdown */
.drum-breakdown { border-top: 1px solid var(--hairline); background: var(--surface-2); padding: 8px 16px 12px 60px; }
.drum-bd-head, .drum-bd-row { display: grid; grid-template-columns: 1fr 70px 110px; gap: 12px; align-items: center; }
.drum-bd-head { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); padding: 6px 0; border-bottom: 1px solid var(--hairline); }
.drum-bd-head span:nth-child(2), .drum-bd-head span:nth-child(3) { text-align: right; }
.drum-bd-row { padding: 8px 0; border-bottom: 1px solid var(--hairline); }
.drum-bd-row:last-child { border-bottom: 0; }
.drum-bd-prod { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.drum-bd-code { font-size: 13px; font-weight: 700; color: var(--ink); letter-spacing: -0.01em; }
.drum-bd-desc { font-size: 11.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drum-bd-orders { text-align: right; font-size: 13px; font-weight: 600; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.drum-bd-hrs { text-align: right; font-size: 13px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.drum-bd-empty { font-size: 12px; color: var(--ink-3); padding: 8px 0; }
.drum-rank { width: 26px; height: 26px; border-radius: 8px; background: var(--surface-3); color: var(--ink-2); font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums; }
.drum-row.is-constraint .drum-rank { background: var(--navy); color: #fff; }
.drum-name { font-size: 14px; font-weight: 600; color: var(--ink); display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.drum-sub { font-size: 11px; color: var(--ink-3); font-weight: 500; margin-top: 2px; text-transform: capitalize; }
.drum-tag { font-size: 9px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 6px; border-radius: 999px; background: var(--navy); color: #fff; display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
.drum-tag.over { background: var(--red-soft); color: var(--red); }
.drum-tag.off { background: var(--surface-3); color: var(--ink-3); }
.drum-bar { height: 8px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
.drum-fill { height: 100%; border-radius: 999px; background: var(--blue); }
.drum-row.band-over .drum-fill { background: var(--red); }
.drum-row.band-tight .drum-fill { background: var(--amber); }
.drum-row.band-mid .drum-fill { background: var(--blue); }
.drum-row.band-slack .drum-fill { background: var(--green); }
.drum-nums { text-align: right; min-width: 92px; }
.drum-nums b { display: block; font-size: 15px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.drum-nums span { font-size: 11px; color: var(--ink-3); font-variant-numeric: tabular-nums; }

@media (max-width: 720px) {
  .drum-hero { grid-template-columns: 1fr auto; }
  .drum-hero-icon { display: none; }
  .drum-row { grid-template-columns: 26px 1fr auto; }
  .drum-bar { grid-column: 2 / 4; order: 3; }
}
`
