import { isoWeekDayToDate } from './scheduling'

// ============================================================
// Schedule slip — how far an order has drifted from its ORIGINAL plan.
//
// Every end-of-day reschedule overwrites orders.prod_week / prod_day to wherever
// the leftover work landed, which used to make a chronically-late order look
// on-time again. Migration 025 freezes the original slot in baseline_prod_week /
// _day the first time an order is pushed; these helpers measure current-vs-
// baseline so "days behind" GROWS with each push instead of resetting.
// ============================================================

// Count work days (Mon–Fri, minus SA public holidays) strictly after `fromD`,
// up to and including `toD`. Zero when toD isn't after fromD.
export function workDaysBetween(fromD, toD, holidaySet) {
  if (!(toD > fromD)) return 0
  let n = 0
  let guard = 0
  const d = new Date(fromD)
  while (d < toD && guard < 2000) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay() === 0 ? 7 : d.getDay()
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (dow <= 5 && !holidaySet.has(ds)) n += 1
    guard += 1
  }
  return n
}

// An order's slip vs. its frozen baseline. `daysBehind` grows every time the
// order is pushed further from where it was originally planned; `count` = how
// many times its leftovers were rescheduled. Both stay 0 until the first manual
// reschedule stamps a baseline — so a never-touched order reads clean.
export function computeSlip(order, holidaySet, year) {
  const count = order.reschedule_count || 0
  const bw = order.baseline_prod_week
  const bd = order.baseline_prod_day
  if (bw == null || bd == null || order.prod_week == null || order.prod_day == null) {
    return { daysBehind: 0, count, baselineWeek: bw, baselineDay: bd }
  }
  const from = isoWeekDayToDate(year, bw, bd)
  const to = isoWeekDayToDate(year, order.prod_week, order.prod_day)
  return { daysBehind: workDaysBetween(from, to, holidaySet), count, baselineWeek: bw, baselineDay: bd }
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Where SHOULD this order be TODAY to stay on schedule? Takes the order's
// planned window (earliest → latest scheduled_date across its rows, or
// prod-start + ttp_days as a fallback), works out what fraction has elapsed by
// today, and turns it into an expected unit count. `behind` = units short of
// that pace. A LEADING day-to-day indicator, distinct from the reschedule slip.
export function computePace({ order, tracking, holidaySet, today, year }) {
  const total = tracking.totalUnits
  if (!total || total <= 0) return null

  let minD = null
  let maxD = null
  for (const pt of tracking.parts) {
    for (const sv of pt.steps) {
      for (const r of sv.rows) {
        const ds = r.scheduled_date
        if (!ds) continue
        if (minD == null || ds < minD) minD = ds
        if (maxD == null || ds > maxD) maxD = ds
      }
    }
  }

  if (!minD && order.prod_week != null && order.prod_day != null) {
    const start = isoWeekDayToDate(year, order.prod_week, order.prod_day)
    minD = ymd(start)
    const days = Math.max(1, order.ttp_days || 1)
    const end = new Date(start)
    let added = 0
    let guard = 0
    while (added < days - 1 && guard < 90) {
      end.setDate(end.getDate() + 1)
      const dow = end.getDay() === 0 ? 7 : end.getDay()
      if (dow <= 5 && !holidaySet.has(ymd(end))) added += 1
      guard += 1
    }
    maxD = ymd(end)
  }
  if (!minD) return null
  if (!maxD || maxD < minD) maxD = minD

  const windowDays = workDaysBetween(new Date(minD + 'T00:00:00'), new Date(maxD + 'T00:00:00'), holidaySet) + 1
  let expectedFrac
  if (today < minD) expectedFrac = 0
  else if (today >= maxD) expectedFrac = 1
  else {
    const elapsed = workDaysBetween(new Date(minD + 'T00:00:00'), new Date(today + 'T00:00:00'), holidaySet) + 1
    expectedFrac = Math.min(1, elapsed / windowDays)
  }
  const expectedUnits = Math.round(expectedFrac * total)
  const behind = Math.max(0, expectedUnits - tracking.doneUnits)
  return { expectedFrac, expectedUnits, behind, started: today >= minD }
}
