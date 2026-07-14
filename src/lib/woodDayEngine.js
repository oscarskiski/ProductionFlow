// ============================================================
// Wood "day conveyor" engine v3  (side-by-side calculator)
// ============================================================
//
// A relative, capacity-levelled scheduling model for the Wood department.
// Supersedes the v2 "day 0 = Monday" build (which pinned every product's first
// day to Monday of its prod_week). The real model, confirmed with Elmo:
//
//   • wood_day on a machine is a RANK (route order), not a weekday. Machines run
//     every day. Day 0 is each PRODUCT's own first day of manufacturing; +1 the
//     next work day, etc. (weekends + SA holidays skipped — a Friday start → +1
//     is Monday).
//   • Normal beat = one stage per day. A product's route COMPRESSES the distinct
//     machine ranks it touches to 0, +1, +2… — a skipped rank simply doesn't
//     exist for that product (that is the "route jump", no flag needed).
//   • Per-step override `machine_steps.wood_day_offset` pins a step to an explicit
//     day-offset (same value on two steps = same day / collapse; a smaller value
//     than the beat = a jump). Lives right where the parts map is built.
//   • Starts STAGGER: the whole week's orders can't all start on one day (not
//     enough machine-minutes), so each order's start is computed backwards from
//     its ship day = anchor − (route lead + buffer) work days, then PULLED
//     EARLIER (most-urgent first) whenever a machine-day it needs is already
//     full. Overtime is never forced — if pulling to the cap still won't fit,
//     the residual overflows and the day is flagged.
//   • Capacity is per machine per CALENDAR date (every product hitting it that
//     day, at whatever offset). Load spreads across a step's machine pool
//     (alt_machine_names) — the whole job lands on the least-loaded member.
//   • Residual overflow packs into the shift and spills the remainder to the
//     FRONT of that machine's next work day (splitting the straddling job).
//
// PURE + read-only: never touches the database. Used by the Wood Conveyor
// preview so the new model can be compared to the live schedule before wood is
// switched over. The live scheduler (scheduling.js / scheduleEngine.js) is
// untouched.

import { orderSendDate } from './scheduling'
import {
  shiftForDate,
  effectiveShiftMinutes,
  isWorkDay,
  nextWorkDay,
  timeToMin,
  placeJobOnShift,
  computeAvailableWorkMin,
} from './scheduleEngine'

const MAX_PULL_DAYS = 25 // how far a start may be pulled earlier to relieve a jam
const DEFAULT_BUFFER = 3

const dateToStr = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const strToDate = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const isoDow = (d) => { const j = d.getDay(); return j === 0 ? 7 : j }

function prevWorkDay(date, holidaySet) {
  const d = new Date(date)
  do { d.setDate(d.getDate() - 1) } while (!isWorkDay(d, holidaySet))
  return d
}
function addWorkDays(date, n, holidaySet) {
  let d = new Date(date)
  for (let i = 0; i < n; i++) d = nextWorkDay(d, holidaySet)
  return d
}
function subWorkDays(date, n, holidaySet) {
  let d = new Date(date)
  for (let i = 0; i < n; i++) d = prevWorkDay(d, holidaySet)
  return d
}

// ISO week number (1..53) for grouping placed dates into week strips.
function isoWeekNum(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dow = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dow)
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil((((t - ys) / 86400000) + 1) / 7)
}
// Monday of the calendar week containing d.
function mondayOf(d) {
  const x = new Date(d)
  x.setDate(x.getDate() - (isoDow(x) - 1))
  return x
}
// The work days (Mon–Fri, minus holidays) of the calendar week starting `monday`.
// Does NOT spill into the next week — a holiday just yields fewer pills.
function weekWorkDates(monday, holidaySet) {
  const out = []
  const d = new Date(monday)
  for (let i = 0; i < 5; i++) {
    if (isWorkDay(d, holidaySet)) out.push(dateToStr(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

// Effective per-step day-offset within a product's compressed route.
//   explicit machine_steps.wood_day_offset wins;
//   otherwise the machine's rank compressed against the product's other ranks.
// Returns null when the step has neither (unassigned machine).
function stepOffset(step, machineByName, rankToCompressed) {
  if (step.wood_day_offset != null && step.wood_day_offset !== '') {
    const n = Number(step.wood_day_offset)
    if (!Number.isNaN(n)) return n
  }
  const m = machineByName.get(step.machine_name)
  if (m && m.wood_day != null) return rankToCompressed.get(Number(m.wood_day)) ?? null
  return null
}

// Build the wood conveyor placement for a set of orders.
//
// Returns { machines, weeks, orders, warnings, unassigned }.
//   machines : Map<name, { machineName, color, rank, days: Map<dateStr, dayPlan> }>
//     dayPlan: { jobs:[job], totalWorkMin, capacity, overMin, overflowed }
//     job    : { …, offset, startMin, endMin, setupMin, carried, split, splitTotal }
//   weeks   : [{ week, monday, dates:[work dateStr…] }] sorted by date
//   orders  : [{ orderId, ord_nr, product_code, productName, customerName, qty,
//                startDate, leadDays, bufferDays, pulledDays, over,
//                route:[{ offset, dateStr, machine, partName, isAssembly,
//                         stepSeq, units }] }]  — for the per-order route ribbon
export function buildWoodConveyor({
  orders,
  productByCode,
  partsByProduct,
  stepsByPart,
  machineByName,
  customerByCode,
  holidaySet,
  bufferDaysByDept,
  year = new Date().getFullYear(),
  today = new Date(),
}) {
  const warnings = []
  const unassigned = new Set()

  const isWoodMachine = (name) => {
    const m = machineByName.get(name)
    return m && m.department === 'wood'
  }
  const woodBuffer = bufferDaysByDept?.get?.('wood') ?? DEFAULT_BUFFER

  // ---- Phase 1: per-order compressed route + lead. --------------------------
  // routed: [{ order, product, leadDays, steps:[{ machine, pool, secs, units,
  //            offset, partName, isAssembly, stepSeq, baseSetupMin }],
  //            anchorStr, latestStart, urgency }]
  const routed = []

  for (const o of orders) {
    if (!o.qty || o.qty <= 0) continue
    const product = productByCode.get(o.product_code)
    if (!product) continue
    const parts = partsByProduct.get(product.id) || []
    if (parts.length === 0) continue

    // Every wood step across all parts (used both for the compression map and
    // the route). Non-wood steps are ignored here.
    const woodStepsByPart = new Map()
    const ranksSeen = new Set()
    for (const p of parts) {
      const ws = (stepsByPart.get(p.id) || [])
        .filter((s) => isWoodMachine(s.machine_name))
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
      if (ws.length) woodStepsByPart.set(p.id, ws)
      for (const s of ws) {
        const m = machineByName.get(s.machine_name)
        if (m && m.wood_day != null) ranksSeen.add(Number(m.wood_day))
      }
    }
    if (woodStepsByPart.size === 0) continue // product doesn't touch wood

    // Compression map: distinct machine ranks → 0,1,2… in ascending order.
    const rankToCompressed = new Map()
    ;[...ranksSeen].sort((a, b) => a - b).forEach((r, i) => rankToCompressed.set(r, i))

    const overrides = product.wood_day_overrides || {}
    const productName = product.description || o.product_code
    const customerName = customerByCode?.get(o.customer_code)?.name || null

    // Place one part's wood steps. floorOffset lets assembly parts wait for the
    // latest non-assembly offset. Returns { steps, maxOffset }.
    const placePart = (p, ws, floorOffset) => {
      const totalParts = (p.qty_per_unit ?? 1) * o.qty
      const out = []
      let prevOff = -1
      let maxOff = floorOffset
      for (const s of ws) {
        let off = stepOffset(s, machineByName, rankToCompressed)
        // A legacy per-product override (wood_day_overrides jsonb) can still
        // pin a machine — treat it the same as an explicit offset.
        if (off == null && s.machine_name in overrides) {
          const v = Number(overrides[s.machine_name])
          if (!Number.isNaN(v)) off = rankToCompressed.get(v) ?? v
        }
        if (off == null) {
          unassigned.add(s.machine_name)
          warnings.push({ type: 'unassigned', machine: s.machine_name, message: `${s.machine_name} has no conveyor rank — steps on it for ${o.product_code} were skipped.` })
          continue
        }
        // Forward-only: a step never lands earlier than a prior step of this
        // part or the assembly floor. Equal offset = runs the same day.
        const placeOff = Math.max(off, prevOff, floorOffset)
        prevOff = placeOff
        if (placeOff > maxOff) maxOff = placeOff

        const mach = machineByName.get(s.machine_name)
        const alts = Array.isArray(s.alt_machine_names) ? s.alt_machine_names : []
        const pool = [s.machine_name, ...alts]
          .map((m) => (m == null ? '' : String(m).trim()))
          .filter((m) => m && isWoodMachine(m))
        const uniquePool = [...new Set(pool)]
        const secs = s.seconds_per_part ?? 0
        out.push({
          machine: s.machine_name,
          pool: uniquePool.length ? uniquePool : [s.machine_name],
          secs,
          units: totalParts,
          workMin: Math.ceil((secs * totalParts) / 60),
          baseSetupMin: (s.setup_time && s.setup_time > 0) ? s.setup_time : (mach?.setup_time_min || 0),
          offset: placeOff,
          partName: p.name || productName,
          isAssembly: !!p.is_assembly,
          stepSeq: s.sequence,
        })
      }
      return { steps: out, maxOffset: maxOff }
    }

    // Non-assembly parts first (to find the assembly floor), then assembly.
    let maxNonAssembly = 0
    const routeSteps = []
    for (const p of parts) {
      if (p.is_assembly) continue
      const ws = woodStepsByPart.get(p.id)
      if (!ws) continue
      const { steps, maxOffset } = placePart(p, ws, 0)
      routeSteps.push(...steps)
      if (maxOffset > maxNonAssembly) maxNonAssembly = maxOffset
    }
    for (const p of parts) {
      if (!p.is_assembly) continue
      const ws = woodStepsByPart.get(p.id)
      if (!ws) continue
      const { steps } = placePart(p, ws, maxNonAssembly)
      routeSteps.push(...steps)
    }
    if (routeSteps.length === 0) continue

    const leadDays = Math.max(...routeSteps.map((s) => s.offset)) + 1

    // Ship anchor: the planned dispatch day. Send date first (what the live
    // scheduler walks back from), else the committed Due date.
    const anchorStr = orderSendDate(o, year) || o.due_date || null
    if (!anchorStr) {
      warnings.push({ type: 'no-anchor', message: `${o.ord_nr || o.product_code}: no ship/Due date — can't place on the conveyor.` })
      continue
    }
    const anchorDate = strToDate(anchorStr)
    const latestStart = subWorkDays(anchorDate, leadDays + woodBuffer, holidaySet)

    // Urgency for the leveling order: work/calendar days to ship ÷ lead. Lower
    // = more urgent (start protected). Overdue → negative → most urgent.
    const daysToShip = Math.round((anchorDate - today) / 86400000)
    const urgency = daysToShip / Math.max(leadDays, 1)

    routed.push({ order: o, productName, customerName, leadDays, steps: routeSteps, anchorStr, latestStart, urgency })
  }

  // ---- Phase 2/3: global pull-earlier leveling on real dates. ---------------
  // Ledger of committed minutes per machine per date.
  const ledger = new Map() // machine -> Map<dateStr, { used, seen:Set<product> }>
  const cell = (machine, dateStr) => {
    if (!ledger.has(machine)) ledger.set(machine, new Map())
    const byDate = ledger.get(machine)
    if (!byDate.has(dateStr)) byDate.set(dateStr, { used: 0, seen: new Set() })
    return byDate.get(dateStr)
  }
  const capOf = (dateStr) => effectiveShiftMinutes(shiftForDate(strToDate(dateStr)))

  // Least-loaded pool member for a date, factoring committed load + a temp
  // delta from placements made earlier in this same order.
  const leastLoaded = (pool, dateStr, temp) => {
    let best = pool[0]
    let bestLoad = Infinity
    for (const m of pool) {
      const committed = ledger.get(m)?.get(dateStr)?.used || 0
      const t = temp.get(`${m}|${dateStr}`) || 0
      const load = committed + t
      if (load < bestLoad) { bestLoad = load; best = m }
    }
    return best
  }

  // Sort most-urgent first so their starts win the capacity race.
  routed.sort((a, b) => a.urgency - b.urgency)

  const ownJobs = new Map() // machine -> Map<dateStr, job[]>
  const pushJob = (machine, dateStr, job) => {
    if (!ownJobs.has(machine)) ownJobs.set(machine, new Map())
    const byDate = ownJobs.get(machine)
    if (!byDate.has(dateStr)) byDate.set(dateStr, [])
    byDate.get(dateStr).push(job)
  }
  const orderRoutes = []

  for (const r of routed) {
    const o = r.order
    // Try increasing pull until every step fits without overflow, or give up
    // at the cap and accept overflow.
    let chosenPull = MAX_PULL_DAYS
    let fits = false
    for (let pull = 0; pull <= MAX_PULL_DAYS; pull++) {
      const start = subWorkDays(r.latestStart, pull, holidaySet)
      const temp = new Map()
      let ok = true
      for (const s of r.steps) {
        const dateStr = dateToStr(addWorkDays(start, s.offset, holidaySet))
        const member = leastLoaded(s.pool, dateStr, temp)
        const c = cell(member, dateStr)
        const setup = c.seen.has(o.product_code) ? 0 : (s.baseSetupMin || 0)
        const est = s.workMin + setup
        const already = c.used + (temp.get(`${member}|${dateStr}`) || 0)
        if (already + est > capOf(dateStr)) { ok = false; break }
        temp.set(`${member}|${dateStr}`, (temp.get(`${member}|${dateStr}`) || 0) + est)
      }
      if (ok) { chosenPull = pull; fits = true; break }
    }

    const start = subWorkDays(r.latestStart, chosenPull, holidaySet)
    const routeCells = []
    const noTemp = new Map()
    for (const s of r.steps) {
      const dateStr = dateToStr(addWorkDays(start, s.offset, holidaySet))
      const member = leastLoaded(s.pool, dateStr, noTemp)
      const c = cell(member, dateStr)
      const setup = c.seen.has(o.product_code) ? 0 : (s.baseSetupMin || 0)
      c.used += s.workMin + setup
      c.seen.add(o.product_code)
      pushJob(member, dateStr, {
        orderId: o.id,
        ord_nr: o.ord_nr || o.kwitasie_nr || null,
        product_code: o.product_code,
        productName: r.productName,
        customerName: r.customerName,
        partName: s.partName,
        isAssembly: s.isAssembly,
        stepSeq: s.stepSeq,
        seconds_per_part: s.secs,
        units: s.units,
        workMin: s.workMin,
        baseSetupMin: s.baseSetupMin,
        offset: s.offset,
      })
      routeCells.push({ offset: s.offset, dateStr, machine: member, partName: s.partName, isAssembly: s.isAssembly, stepSeq: s.stepSeq, units: s.units })
    }
    if (!fits) {
      warnings.push({ type: 'over-capacity', message: `${o.ord_nr || o.product_code}: couldn't fit at normal capacity even pulled ${MAX_PULL_DAYS} days early — overtime or a longer lead is needed.` })
    }
    orderRoutes.push({
      orderId: o.id,
      ord_nr: o.ord_nr || o.kwitasie_nr || null,
      product_code: o.product_code,
      productName: r.productName,
      customerName: r.customerName,
      qty: o.qty,
      startDate: dateToStr(start),
      leadDays: r.leadDays,
      bufferDays: woodBuffer,
      pulledDays: chosenPull,
      over: !fits,
      route: routeCells.sort((a, b) => a.offset - b.offset || a.stepSeq - b.stepSeq),
    })
  }

  // ---- Phase 4: pack each machine's dates into the shift, spilling forward. --
  const machines = new Map()
  for (const [name, byDate] of ownJobs) {
    const m = machineByName.get(name)
    const machine = { machineName: name, color: m?.color || '#9aa0ad', rank: m?.wood_day ?? null, days: new Map() }
    machines.set(name, machine)

    const ownDates = [...byDate.keys()].sort()
    const seq = []
    let d = strToDate(ownDates[0])
    const last = strToDate(ownDates[ownDates.length - 1])
    while (d <= last) { seq.push(dateToStr(d)); d = nextWorkDay(d, holidaySet) }

    let carry = []
    let i = 0
    let guard = 0
    while (i < seq.length && guard < 120) {
      guard++
      const dateStr = seq[i]
      const own = byDate.get(dateStr) || []
      const queue = [...carry, ...own]
      carry = []
      i++
      if (queue.length === 0) continue

      const shift = shiftForDate(strToDate(dateStr))
      const shiftStart = timeToMin(shift.start)
      const capacity = effectiveShiftMinutes(shift)
      let usedTill = shiftStart
      const seenSetup = new Set()
      const placed = []

      for (let qi = 0; qi < queue.length; qi++) {
        const job = queue[qi]
        const needSetup = !seenSetup.has(job.product_code)
        const setupMin = needSetup ? (job.baseSetupMin || 0) : 0
        const slot = placeJobOnShift(shift, usedTill, shiftStart, job.workMin + setupMin)
        if (slot) {
          placed.push({ ...job, setupMin, startMin: slot.startMin, endMin: slot.endMin })
          usedTill = slot.endMin
          seenSetup.add(job.product_code)
          continue
        }
        const avail = computeAvailableWorkMin(shift, usedTill, shiftStart)
        const workAvail = avail - setupMin
        if (workAvail > 0 && job.seconds_per_part > 0) {
          const unitsFit = Math.floor((workAvail * 60) / job.seconds_per_part)
          if (unitsFit >= 1 && unitsFit < job.units) {
            const partWorkMin = Math.ceil((job.seconds_per_part * unitsFit) / 60)
            const slot2 = placeJobOnShift(shift, usedTill, shiftStart, partWorkMin + setupMin)
            if (slot2) {
              placed.push({ ...job, units: unitsFit, workMin: partWorkMin, setupMin, startMin: slot2.startMin, endMin: slot2.endMin, split: true, splitTotal: job.units })
              usedTill = slot2.endMin
              seenSetup.add(job.product_code)
              const remUnits = job.units - unitsFit
              carry.push({ ...job, units: remUnits, workMin: Math.ceil((job.seconds_per_part * remUnits) / 60), carried: true, split: true, splitTotal: job.splitTotal || job.units })
              for (let k = qi + 1; k < queue.length; k++) carry.push({ ...queue[k], carried: true })
              break
            }
          }
        }
        if (placed.length === 0) {
          placed.push({ ...job, setupMin, startMin: usedTill, endMin: timeToMin(shift.end), overflow: true })
          usedTill = timeToMin(shift.end)
          seenSetup.add(job.product_code)
          for (let k = qi + 1; k < queue.length; k++) carry.push({ ...queue[k], carried: true })
          break
        }
        for (let k = qi; k < queue.length; k++) carry.push({ ...queue[k], carried: true })
        break
      }

      const totalWorkMin = placed.reduce((s, j) => s + j.workMin + (j.setupMin || 0), 0)
      machine.days.set(dateStr, {
        jobs: placed,
        totalWorkMin,
        capacity,
        overMin: Math.max(0, totalWorkMin - capacity),
        overflowed: totalWorkMin > capacity || placed.some((j) => j.overflow),
      })

      if (carry.length > 0 && i >= seq.length) {
        seq.push(dateToStr(nextWorkDay(strToDate(dateStr), holidaySet)))
      }
    }
  }

  // ---- Phase 5: group all placed dates into week strips. --------------------
  const allDates = new Set()
  for (const m of machines.values()) for (const dstr of m.days.keys()) allDates.add(dstr)
  const weekByMonday = new Map()
  for (const dstr of allDates) {
    const mon = mondayOf(strToDate(dstr))
    const key = dateToStr(mon)
    if (!weekByMonday.has(key)) {
      weekByMonday.set(key, { week: isoWeekNum(mon), monday: key, dates: weekWorkDates(mon, holidaySet) })
    }
  }
  const weeks = [...weekByMonday.values()].sort((a, b) => (a.monday < b.monday ? -1 : 1))

  return { machines, weeks, orders: orderRoutes, warnings, unassigned }
}
