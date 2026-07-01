// ============================================================
// Wood "day conveyor" engine  (side-by-side calculator)
// ============================================================
//
// A different scheduling model for the Wood department, requested by Elmo.
// The wood week is a FIXED Mon–Fri conveyor:
//
//   • Every wood machine has a `wood_day` (0 = Mon / first day … 4 = Fri /
//     finishing). All machines sharing a number run on the same day.
//   • A part flows step-by-step through its machines, but can only ADVANCE to a
//     machine on that machine's day. If a part finishes a day-0 machine and its
//     next step is a day-1 machine, it waits and goes there on day 1.
//   • Per-product overrides (products.wood_day_overrides) move a machine to a
//     different day for one product only.
//   • Each machine-day is packed into the real shift (Mon–Thu 07:00–17:15 /
//     Fri short, minus breaks) so it reads exactly like the Steel schedule —
//     every job gets a start→end time and the breaks show as rows.
//   • Capacity = the effective shift minutes. When a machine's day can't hold
//     all its work, the OVERFLOW spills to the FRONT of that same machine's
//     next work day (splitting the job that straddles the boundary); that day's
//     own work follows behind it. Overflow never jumps to another machine, and
//     downstream machines keep their fixed day. Overtime is the boss's manual
//     call — we only surface which days run over.
//
// PURE + read-only: never touches the database. Used by the Wood Conveyor
// preview so the new model can be compared to the live schedule before wood is
// switched over. The live scheduler (scheduling.js / scheduleEngine.js) is
// untouched. Each order's WEEK comes from its already-computed prod_week; the
// 5 day-slots are that week's first five work days.

import { isoWeekDayToDate } from './scheduling'
import {
  shiftForDate,
  effectiveShiftMinutes,
  isWorkDay,
  nextWorkDay,
  timeToMin,
  placeJobOnShift,
  computeAvailableWorkMin,
} from './scheduleEngine'

const MAX_DAYS = 5 // day 0 (Mon) … day 4 (Fri)

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

// Effective conveyor day for a (product, machine): a per-product override wins,
// otherwise the machine's own wood_day. Returns null when neither is set.
export function effectiveWoodDay(machineName, machineByName, overrides) {
  if (overrides && machineName in overrides) {
    const v = overrides[machineName]
    if (v != null && v !== '') {
      const n = Number(v)
      if (!Number.isNaN(n)) return n
    }
  }
  const m = machineByName.get(machineName)
  if (m && m.wood_day != null) return Number(m.wood_day)
  return null
}

// The 5 day-slot dates for a production week: the first MAX_DAYS work days
// starting from Monday of that ISO week (skips weekends + holidays).
function weekDaySlots(year, week, holidaySet) {
  const dates = []
  let cur = isoWeekDayToDate(year, week, 1) // Monday
  if (!isWorkDay(cur, holidaySet)) cur = nextWorkDay(cur, holidaySet)
  dates.push(dateToStr(cur))
  while (dates.length < MAX_DAYS) {
    cur = nextWorkDay(cur, holidaySet)
    dates.push(dateToStr(cur))
  }
  return dates
}

// Build the wood conveyor placement for a set of orders.
//
// Returns { machines, weeks, warnings, unassigned }.
//   machines : Map<name, { machineName, color, day, days: Map<dateStr, dayPlan> }>
//     dayPlan: { jobs:[job], totalWorkMin, capacity, overMin, overflowed }
//     job    : { orderId, ord_nr, product_code, productName, customerName,
//                partName, isAssembly, stepSeq, seconds_per_part, units,
//                workMin, setupMin, startMin, endMin, carried, split, splitTotal }
//   weeks    : [{ week, dates:[5 dateStr] }] sorted by week
export function buildWoodConveyor({
  orders,
  productByCode,
  partsByProduct,
  stepsByPart,
  machineByName,
  customerByCode,
  holidaySet,
  year = new Date().getFullYear(),
}) {
  const warnings = []
  const unassigned = new Set()
  const weeks = new Map() // weekNo -> { week, dates:[5] }

  const isWoodMachine = (name) => {
    const m = machineByName.get(name)
    return m && m.department === 'wood'
  }

  // ---- Phase 1: assign every wood step to a (machine, date) as a job. ----
  // ownJobs: Map<machineName, Map<dateStr, job[]>>
  const ownJobs = new Map()
  const pushJob = (machineName, dateStr, job) => {
    if (!ownJobs.has(machineName)) ownJobs.set(machineName, new Map())
    const byDate = ownJobs.get(machineName)
    if (!byDate.has(dateStr)) byDate.set(dateStr, [])
    byDate.get(dateStr).push(job)
  }

  for (const o of orders) {
    if (!o.qty || o.qty <= 0) continue
    if (o.prod_week == null || o.prod_day == null) {
      warnings.push({ type: 'no-week', message: `${o.ord_nr || o.product_code}: no production week yet — recalculate the schedule first.` })
      continue
    }
    const product = productByCode.get(o.product_code)
    if (!product) continue
    const parts = partsByProduct.get(product.id) || []
    if (parts.length === 0) continue
    const touchesWood = parts.some((p) =>
      (stepsByPart.get(p.id) || []).some((s) => isWoodMachine(s.machine_name)))
    if (!touchesWood) continue

    if (!weeks.has(o.prod_week)) {
      weeks.set(o.prod_week, { week: o.prod_week, dates: weekDaySlots(year, o.prod_week, holidaySet) })
    }
    const slots = weeks.get(o.prod_week).dates
    const overrides = product.wood_day_overrides || {}
    const productName = product.description || o.product_code
    const customerName = customerByCode?.get(o.customer_code)?.name || null

    // Place one part's wood steps. `floorDay` lets assembly parts wait for the
    // latest non-assembly day. Returns the highest day this part used.
    const placePart = (p, floorDay) => {
      const totalParts = (p.qty_per_unit ?? 1) * o.qty
      if (totalParts <= 0) return floorDay
      const steps = (stepsByPart.get(p.id) || [])
        .filter((s) => isWoodMachine(s.machine_name))
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
      let prevDay = floorDay - 1
      let maxDay = floorDay
      for (const s of steps) {
        const name = s.machine_name
        const day = effectiveWoodDay(name, machineByName, overrides)
        if (day == null) {
          unassigned.add(name)
          warnings.push({ type: 'unassigned', machine: name, message: `${name} has no conveyor day — steps on it for ${o.product_code} were skipped.` })
          continue
        }
        let placeDay = Math.max(day, prevDay, floorDay)
        if (placeDay !== day) {
          warnings.push({ type: 'reordered', message: `${o.product_code}: ${name} (day ${day}) runs after an earlier step — placed on day ${placeDay}.` })
        }
        if (placeDay > MAX_DAYS - 1) {
          warnings.push({ type: 'past-week', message: `${o.product_code}: ${name} lands past Friday — clamped to day ${MAX_DAYS - 1}.` })
          placeDay = MAX_DAYS - 1
        }
        prevDay = placeDay
        if (placeDay > maxDay) maxDay = placeDay

        const mach = machineByName.get(name)
        const secs = s.seconds_per_part ?? 0
        pushJob(name, slots[placeDay], {
          orderId: o.id,
          ord_nr: o.ord_nr || o.kwitasie_nr || null,
          product_code: o.product_code,
          productName,
          customerName,
          partName: p.name || productName,
          isAssembly: !!p.is_assembly,
          stepSeq: s.sequence,
          seconds_per_part: secs,
          units: totalParts,
          workMin: Math.ceil((secs * totalParts) / 60),
          baseSetupMin: (s.setup_time && s.setup_time > 0) ? s.setup_time : (mach?.setup_time_min || 0),
        })
      }
      return maxDay
    }

    let maxNonAssemblyDay = 0
    for (const p of parts) {
      if (p.is_assembly) continue
      const used = placePart(p, 0)
      if (used > maxNonAssemblyDay) maxNonAssemblyDay = used
    }
    for (const p of parts) {
      if (!p.is_assembly) continue
      placePart(p, maxNonAssemblyDay)
    }
  }

  // ---- Phase 2: pack each machine's days into the shift, spilling forward. --
  const machines = new Map()
  for (const [name, byDate] of ownJobs) {
    const m = machineByName.get(name)
    const machine = { machineName: name, color: m?.color || '#9aa0ad', day: m?.wood_day ?? null, days: new Map() }
    machines.set(name, machine)

    // Ordered sequence of work days from the first own date onward. Extended
    // on the fly while carry work remains.
    const ownDates = [...byDate.keys()].sort()
    const seq = []
    let d = strToDate(ownDates[0])
    const last = strToDate(ownDates[ownDates.length - 1])
    while (d <= last) { seq.push(dateToStr(d)); d = nextWorkDay(d, holidaySet) }

    let carry = []
    let i = 0
    let guard = 0
    while (i < seq.length && guard < 60) {
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
        // Doesn't fully fit. Try to split units into the remaining time.
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
          // A single job bigger than an empty day (pathological). Force-place it
          // over capacity so we don't loop forever; the rest carries.
          placed.push({ ...job, setupMin, startMin: usedTill, endMin: timeToMin(shift.end), overflow: true })
          usedTill = timeToMin(shift.end)
          seenSetup.add(job.product_code)
          for (let k = qi + 1; k < queue.length; k++) carry.push({ ...queue[k], carried: true })
          break
        }
        // Some work placed today; carry this job + the rest to tomorrow's front.
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

      // Extend the sequence if carry work remains past the last known day.
      if (carry.length > 0 && i >= seq.length) {
        seq.push(dateToStr(nextWorkDay(strToDate(dateStr), holidaySet)))
      }
    }
  }

  const weekList = [...weeks.values()].sort((a, b) => a.week - b.week)
  return { machines, weeks: weekList, warnings, unassigned }
}
