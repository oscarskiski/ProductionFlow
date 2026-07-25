import { workDatesOfWeek, shiftForDate, effectiveShiftMinutes } from './scheduleEngine'

// ============================================================
// Theory of Constraints — the "drum" finder.
//
// For one prod_week, sum the work-minutes every order demands of every machine
// (seconds_per_part × units ÷ 60, over all parts/steps that route through it),
// and compare to that machine's available shift-minutes for the week. The
// machine with the highest load is the CONSTRAINT (Herbie) — the one that
// governs the whole factory's throughput.
//
// Load is department-agnostic here (a machine belongs to one department), so
// callers can filter the returned rows by department to see each line's own
// drum. Setup time is deliberately left out of the load estimate for now —
// work-minutes dominate and drive the ranking; we can fold setups in later.
// ============================================================
export function computeConstraintLoad({
  orders, week, year,
  partsByProduct, stepsByPart, productByCode, machines, holidaySet,
}) {
  const reqByMachine = new Map() // name -> { workMin, orders:Set, products:Set, byProduct:Map }
  const bump = (name, min, orderId, code) => {
    if (!name) return
    let e = reqByMachine.get(name)
    if (!e) { e = { workMin: 0, orders: new Set(), products: new Set(), byProduct: new Map() }; reqByMachine.set(name, e) }
    e.workMin += min
    if (orderId) e.orders.add(orderId)
    if (code) {
      e.products.add(code)
      // Per-product breakdown so a machine row can show WHAT loads it and for
      // how long. Keyed by product code; sums minutes and unique orders.
      let pe = e.byProduct.get(code)
      if (!pe) { pe = { code, workMin: 0, orders: new Set() }; e.byProduct.set(code, pe) }
      pe.workMin += min
      if (orderId) pe.orders.add(orderId)
    }
  }

  for (const o of (orders || [])) {
    if (o.prod_week !== week) continue
    const product = productByCode.get(o.product_code)
    if (!product) continue
    const parts = partsByProduct.get(product.id) || []
    for (const part of parts) {
      const steps = stepsByPart.get(part.id) || []
      const units = (o.qty || 0) * (part.qty_per_unit || 1)
      if (units <= 0) continue
      for (const s of steps) {
        const secs = s.seconds_per_part || 0
        if (secs <= 0) continue
        bump(s.machine_name, (secs * units) / 60, o.id, o.product_code)
      }
    }
  }

  // Available shift-minutes for the week — same working calendar for every
  // machine (one shift). Mon–Thu ≈ 515 min, Fri ≈ 325, minus holidays.
  const dates = workDatesOfWeek(week, year, holidaySet || new Set())
  let availableMin = 0
  for (const ds of dates) {
    const [y, m, d] = ds.split('-').map(Number)
    availableMin += effectiveShiftMinutes(shiftForDate(new Date(y, m - 1, d)))
  }

  const machineByName = new Map((machines || []).map((m) => [m.name, m]))
  const rows = [...reqByMachine.entries()].map(([name, e]) => {
    const machine = machineByName.get(name)
    return {
      name,
      department: machine?.department || null,
      active: machine ? machine.active !== false : true,
      workMin: Math.round(e.workMin),
      availableMin,
      loadPct: availableMin > 0 ? (e.workMin / availableMin) * 100 : 0,
      orderCount: e.orders.size,
      productCount: e.products.size,
      // Which products load this machine, heaviest first.
      breakdown: [...e.byProduct.values()]
        .map((pe) => ({ code: pe.code, workMin: Math.round(pe.workMin), orderCount: pe.orders.size }))
        .sort((a, b) => b.workMin - a.workMin),
    }
  })
  rows.sort((a, b) => b.workMin - a.workMin)
  return { rows, availableMin, dates, weekDays: dates.length }
}

// Colour band for a machine's load — mirrors the CR bands in spirit.
// red = over capacity (can't fit the week, will spill), amber = tight,
// green = comfortable slack.
export function loadBand(loadPct) {
  if (loadPct >= 100) return 'over'
  if (loadPct >= 85) return 'tight'
  if (loadPct >= 50) return 'mid'
  return 'slack'
}

export function fmtHrs(min) {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h <= 0) return `${m}m`
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
