import { useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TopbarActions from '../components/TopbarActions'
import { useAppData } from '../store/AppDataContext'
import { buildWoodConveyor } from '../lib/woodDayEngine'
import { isoWeek } from '../lib/scheduling'
import { AlertTriangle, Info, Trees, ArrowRight } from 'lucide-react'

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
  --r-sm: 10px; --r-md: 14px; --r-lg: 20px;
}
[data-theme="dark"] {
  --bg: #0e1118; --bg-2: #131722;
  --surface: #1a1f2c; --surface-2: #20263488; --surface-3: #232938;
  --ink: #f1f2f5; --ink-2: #b8bcc8; --ink-3: #7c8090;
  --hairline: rgba(255,255,255,0.07); --hairline-2: rgba(255,255,255,0.12);
  --navy: #2e3d63; --navy-soft: rgba(88,114,180,0.18);
}
* { box-sizing: border-box; }
html, body {
  margin:0; padding:0; min-height: 100vh;
  font-family: 'Inter', -apple-system, system-ui, sans-serif;
  color: var(--ink); letter-spacing: -0.01em;
  -webkit-font-smoothing: antialiased;
  background: radial-gradient(120% 80% at 50% 0%, var(--surface-2) 0%, var(--bg) 40%, var(--bg-2) 100%);
}
.main { padding: 18px 22px 30px; min-width: 0; }
.topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
.topbar h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.025em; margin: 0; line-height: 1.1; }
.topbar .sub { font-size: 12px; color: var(--ink-2); margin-top: 3px; }
.topbar-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

.preview-banner { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ink-2); background: var(--blue-soft); border: 1px solid rgba(70,119,200,0.2); border-radius: 10px; padding: 9px 12px; margin-bottom: 12px; }
.preview-banner .ic { color: var(--blue); flex-shrink: 0; }

.week-tabs { display: flex; gap: 4px; padding: 3px; background: var(--surface-2); border: 1px solid var(--hairline); border-radius: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.week-tab { appearance: none; border: 0; background: transparent; color: var(--ink-2); font: inherit; font-size: 12px; font-weight: 500; padding: 6px 12px; border-radius: 7px; cursor: pointer; }
.week-tab[aria-pressed="true"] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 0 rgba(255,255,255,0.6) inset, 0 2px 4px rgba(26,29,36,0.05); font-weight: 600; }

.card { background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--r-md); padding: 0; margin-bottom: 12px; box-shadow: var(--shadow-card); overflow: hidden; }

.grid-scroll { overflow-x: auto; }
.cgrid { display: grid; min-width: 760px; }
.cgrid .ch { position: sticky; top: 0; background: var(--surface-2); border-bottom: 1px solid var(--hairline-2); padding: 10px 12px; font-size: 11px; font-weight: 700; color: var(--ink-2); letter-spacing: 0.03em; }
.cgrid .ch.day { text-align: center; }
.cgrid .ch.day .dow { font-size: 12px; color: var(--ink); }
.cgrid .ch.day .dt { font-size: 10px; color: var(--ink-3); font-weight: 600; }
.cgrid .ch.day.holiday .dow { color: var(--red); }
.cgrid .rowhead { padding: 10px 12px; border-bottom: 1px solid var(--hairline); display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--ink); background: var(--surface); position: sticky; left: 0; z-index: 1; }
.cgrid .rowhead .sw { width: 4px; height: 26px; border-radius: 2px; flex-shrink: 0; }
.cgrid .rowhead .daytag { font-size: 9px; font-weight: 700; color: var(--blue); background: var(--blue-soft); padding: 1px 6px; border-radius: 4px; margin-left: auto; }
.cgrid .cell { border-bottom: 1px solid var(--hairline); border-left: 1px solid var(--hairline); padding: 7px 8px; min-height: 56px; display: flex; flex-direction: column; gap: 5px; }
.cgrid .cell.over { background: var(--red-soft); }

.chip { font-size: 11px; font-weight: 600; color: var(--ink); background: var(--surface-3); border: 1px solid var(--hairline); border-radius: 6px; padding: 3px 6px; display: flex; justify-content: space-between; gap: 6px; }
.chip .u { color: var(--ink-3); font-weight: 600; font-variant-numeric: tabular-nums; }
.chip.carry { background: var(--amber-soft); border-color: rgba(232,154,60,0.3); color: var(--amber); }

.loadbar { margin-top: auto; }
.loadbar .lt { display: flex; justify-content: space-between; font-size: 10px; font-weight: 600; color: var(--ink-3); margin-bottom: 2px; font-variant-numeric: tabular-nums; }
.loadbar .lt .over { color: var(--red); }
.loadbar .track { height: 5px; background: var(--surface-3); border-radius: 3px; overflow: hidden; }
.loadbar .fill { height: 100%; background: var(--green); border-radius: 3px; }
.loadbar .fill.warn { background: var(--amber); }
.loadbar .fill.bad { background: var(--red); }

.empty { padding: 40px 20px; text-align: center; color: var(--ink-3); font-size: 13px; }

.setup { background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--r-md); box-shadow: var(--shadow-card); padding: 36px 28px; text-align: center; max-width: 620px; margin: 8px auto; }
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
.warns { background: var(--surface); border: 1px solid rgba(210,83,58,0.25); border-radius: var(--r-md); padding: 12px 14px; margin-bottom: 12px; }
.warns h4 { margin: 0 0 8px; font-size: 12px; font-weight: 700; color: var(--red); display: flex; align-items: center; gap: 6px; }
.warns ul { margin: 0; padding-left: 18px; }
.warns li { font-size: 12px; color: var(--ink-2); margin-bottom: 3px; }
.legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; color: var(--ink-3); margin-bottom: 12px; align-items: center; }
.legend .li { display: flex; align-items: center; gap: 5px; }
.legend .dot { width: 10px; height: 10px; border-radius: 3px; }
`

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const strToDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const fmtDay = (s) => { const d = strToDate(s); return { dow: DOW[d.getDay()], dt: `${d.getDate()} ${MON[d.getMonth()]}` } }
const fmtMin = (m) => {
  const r = Math.round(m)
  if (r < 60) return `${r}m`
  const h = Math.floor(r / 60); const mm = r % 60
  return mm ? `${h}h${mm}` : `${h}h`
}

export default function WoodConveyorScreen() {
  const {
    orders, machines, loading, error,
    productByCode, partsByProduct, stepsByPart, machineByName, holidaySet,
  } = useAppData()

  // How many wood machines have a conveyor day set? Drives the setup prompt.
  const woodSetup = useMemo(() => {
    const wood = (machines || []).filter((m) => m.department === 'wood')
    const withDay = wood.filter((m) => m.wood_day != null)
    return { total: wood.length, set: withDay.length }
  }, [machines])

  // Active orders only — completed/shipped orders aren't on the conveyor.
  const activeOrders = useMemo(
    () => (orders || []).filter((o) => o.status !== 'completed' && !o.shipped_at),
    [orders],
  )

  const result = useMemo(() => buildWoodConveyor({
    orders: activeOrders,
    productByCode, partsByProduct, stepsByPart, machineByName, holidaySet,
  }), [activeOrders, productByCode, partsByProduct, stepsByPart, machineByName, holidaySet])

  // Group every cell date by ISO week so carry-over days always show in the
  // right column, even if no order's prod_week landed there.
  const byWeek = useMemo(() => {
    const weeks = new Map() // weekNo -> { week, dates:Set }
    for (const mach of result.machines.values()) {
      for (const dateStr of mach.cells.keys()) {
        const wk = isoWeek(strToDate(dateStr))
        if (!weeks.has(wk)) weeks.set(wk, { week: wk, dates: new Set() })
        weeks.get(wk).dates.add(dateStr)
      }
    }
    const list = [...weeks.values()].map((w) => ({ week: w.week, dates: [...w.dates].sort() }))
    list.sort((a, b) => a.week - b.week)
    return list
  }, [result])

  // Aggregate warnings: collapse the per-(machine×order) "no conveyor day"
  // spam into a single line listing the distinct machines, then dedupe the rest.
  const summary = useMemo(() => {
    const out = []
    if (result.unassigned.size > 0) {
      const names = [...result.unassigned].sort()
      out.push(`${names.length} machine${names.length === 1 ? '' : 's'} still need a conveyor day (set in Machines → Wood): ${names.join(', ')}`)
    }
    const seen = new Set()
    for (const w of result.warnings) {
      if (w.type === 'unassigned') continue
      if (seen.has(w.message)) continue
      seen.add(w.message)
      out.push(w.message)
    }
    return out
  }, [result])

  const [activeWeek, setActiveWeek] = useState(null)
  const week = byWeek.find((w) => w.week === activeWeek) || byWeek[0] || null

  // Machines that have any load in the active week, sorted by conveyor day then name.
  const rows = useMemo(() => {
    if (!week) return []
    const out = []
    for (const mach of result.machines.values()) {
      const cellsInWeek = week.dates.some((d) => mach.cells.has(d))
      if (cellsInWeek) out.push(mach)
    }
    out.sort((a, b) => {
      const ad = a.day ?? 99, bd = b.day ?? 99
      if (ad !== bd) return ad - bd
      return a.machineName.localeCompare(b.machineName)
    })
    return out
  }, [result, week])

  const gridCols = week ? `220px repeat(${week.dates.length}, minmax(120px, 1fr))` : '1fr'

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <Sidebar />
        <main className="main">
          <div className="topbar">
            <div>
              <h1>Wood Conveyor</h1>
              <div className="sub">Fixed Mon–Fri day schedule — preview of the new wood model</div>
            </div>
            <div className="topbar-actions"><TopbarActions /></div>
          </div>

          <div className="preview-banner">
            <Info size={15} strokeWidth={2} className="ic" />
            <span>
              Read-only preview. Each wood machine runs on its set day; parts only advance to a machine on that day.
              Work that doesn't fit a day spills to the front of the next day. This does <b>not</b> change your live schedule.
            </span>
          </div>

          <div className="legend">
            <span className="li"><span className="dot" style={{ background: 'var(--green)' }} /> within capacity</span>
            <span className="li"><span className="dot" style={{ background: 'var(--amber)' }} /> near full</span>
            <span className="li"><span className="dot" style={{ background: 'var(--red)' }} /> over — spills / overtime</span>
            <span className="li"><span className="dot" style={{ background: 'var(--amber-soft)', border: '1px solid var(--amber)' }} /> carried in from previous day</span>
          </div>

          {loading && <div className="empty">Loading…</div>}
          {error && <div className="empty" style={{ color: 'var(--red)' }}>Failed to load: {error}</div>}

          {/* Setup state: no wood machine has a day yet → guide, don't alarm. */}
          {!loading && !error && woodSetup.set === 0 && (
            <div className="setup">
              <span className="badge"><Trees size={26} strokeWidth={1.8} className="ic" /></span>
              <h3>Set up the wood conveyor</h3>
              <p>Each wood machine needs a day number — 0 = Monday (first day of manufacturing) through 4 = Friday (finishing) — before the preview can lay out the week.</p>
              <div className="prog">You've set <b>0</b> of {woodSetup.total} wood machines.</div>
              {result.unassigned.size > 0 && (
                <div className="names">
                  <b>Machines your current orders use</b>
                  {[...result.unassigned].sort().join(', ')}
                </div>
              )}
              <NavLink to="/machines" className="cta">
                Open Machines <ArrowRight size={15} className="ic" />
              </NavLink>
            </div>
          )}

          {/* Some machines set: show aggregated issues (one line per machine,
              not one per machine×order) + the grid. */}
          {!loading && !error && woodSetup.set > 0 && summary.length > 0 && (
            <div className="warns">
              <h4><AlertTriangle size={14} /> {summary.length} issue{summary.length === 1 ? '' : 's'} to review</h4>
              <ul>
                {summary.slice(0, 15).map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}

          {!loading && !error && woodSetup.set > 0 && byWeek.length === 0 && (
            <div className="card"><div className="empty">
              No wood orders land on the conveyor yet. Check that your active orders have a production week
              (run Recalculate on the Import screen), and that the machines they use have a day set.
            </div></div>
          )}

          {!loading && !error && woodSetup.set > 0 && byWeek.length > 0 && (
            <>
              <div className="week-tabs">
                {byWeek.map((w) => (
                  <button
                    key={w.week}
                    className="week-tab"
                    aria-pressed={week && w.week === week.week}
                    onClick={() => setActiveWeek(w.week)}
                  >
                    Week {w.week}
                  </button>
                ))}
              </div>

              <div className="card">
                <div className="grid-scroll">
                  <div className="cgrid" style={{ gridTemplateColumns: gridCols }}>
                    {/* header row */}
                    <div className="ch">Machine</div>
                    {week.dates.map((d) => {
                      const f = fmtDay(d)
                      const holiday = holidaySet.has(d)
                      return (
                        <div key={d} className={`ch day ${holiday ? 'holiday' : ''}`}>
                          <div className="dow">{f.dow}</div>
                          <div className="dt">{f.dt}{holiday ? ' · holiday' : ''}</div>
                        </div>
                      )
                    })}
                    {/* machine rows */}
                    {rows.map((mach) => (
                      <RowCells key={mach.machineName} mach={mach} dates={week.dates} />
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  )
}

function RowCells({ mach, dates }) {
  return (
    <>
      <div className="rowhead">
        <span className="sw" style={{ background: mach.color }} />
        <span>{mach.machineName}</span>
        {mach.day != null && <span className="daytag">Day {mach.day}</span>}
      </div>
      {dates.map((d) => {
        const cell = mach.cells.get(d)
        if (!cell) return <div key={d} className="cell" />
        const pct = cell.capacity > 0 ? Math.min(100, (cell.totalMin / cell.capacity) * 100) : 0
        const fillClass = cell.overMin > 0 ? 'bad' : pct >= 85 ? 'warn' : ''
        return (
          <div key={d} className={`cell ${cell.overMin > 0 ? 'over' : ''}`}>
            {cell.carryInMin > 0 && (
              <div className="chip carry"><span>↪ carried in</span><span className="u">{fmtMin(cell.carryInMin)}</span></div>
            )}
            {groupItems(cell.items).map((it, i) => (
              <div key={i} className="chip">
                <span>{it.label}</span>
                <span className="u">{fmtMin(it.workMin)}</span>
              </div>
            ))}
            <div className="loadbar">
              <div className="lt">
                <span>{fmtMin(cell.totalMin)} / {fmtMin(cell.capacity)}</span>
                {cell.overMin > 0 && <span className="over">+{fmtMin(cell.overMin)} over</span>}
              </div>
              <div className="track"><div className={`fill ${fillClass}`} style={{ width: `${pct}%` }} /></div>
            </div>
          </div>
        )
      })}
    </>
  )
}

// Collapse multiple part-rows of the same order/product on one machine-day into
// a single chip with summed minutes.
function groupItems(items) {
  const m = new Map()
  for (const it of items) {
    const key = `${it.ord_nr || ''}|${it.product_code}`
    if (!m.has(key)) m.set(key, { label: it.ord_nr ? `${it.ord_nr} · ${it.product_code}` : it.product_code, workMin: 0 })
    m.get(key).workMin += it.workMin
  }
  return [...m.values()].sort((a, b) => b.workMin - a.workMin)
}
