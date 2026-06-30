// ============================================================
// Wood "day conveyor" engine  (Stage 4 — side-by-side calculator)
// ============================================================
//
// A different scheduling model for the Wood department, requested by Elmo.
// Instead of bottleneck-minutes deciding how many days before dispatch an order
// must start, the wood week is a FIXED Mon–Fri conveyor:
//
//   • Every wood machine has a `wood_day` (0 = Mon / first day … 4 = Fri /
//     finishing). All machines sharing a number run on the same day.
//   • A part flows step-by-step through its machines, but can only ADVANCE to a
//     machine on that machine's day. If a part finishes a day-0 machine and its
//     next step is a day-1 machine, it waits and goes there on day 1.
//   • Per-product overrides (products.wood_day_overrides) let one product move a
//     machine to a different day for itself only.
//   • Capacity per machine-day = the effective shift minutes (Mon–Thu 515,
//     Fri 325). When a machine's day holds more work than fits, the OVERFLOW
//     spills to the FRONT of that same machine's next work day; that day's own
//     work simply follows behind it. Overflow is never reordered onto other
//     machines, and downstream machines keep their fixed day. (Overtime is the
//     boss's manual call — we only surface which days run over.)
//
// This module is PURE and does not touch the database. It is used by the
// read-only Wood Conveyor comparison view so the new model can be eyeballed
// against the live schedule before wood is switched over. The live scheduler
// (scheduling.js / scheduleEngine.js) is left completely untouched.
//
// The production WEEK for each order is taken from its already-computed
// prod_week / prod_day (so the comparison is apples-to-apples with the live
// schedule). The 5 day-slots are that week's first five work days (Mon→Fri,
// skipping SA public holidays).

import { isoWeekDayToDate } from './scheduling'
import {
  shiftForDate,
  effectiveShiftMinutes,
  isWorkDay,
  nextWorkDay,
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
// otherwise the machine's own wood_day. Returns null when neither is set — the
// machine isn't on the conveyor yet and its steps can't be placed.
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
// starting from Monday of that ISO week (skips weekends + holidays, so a
// mid-week holiday pushes the later slots into the next Monday).
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

const emptyCell = () => ({
  ownMin: 0,        // work + setup placed directly on this day
  setupMin: 0,      // portion of ownMin that is setup
  carryInMin: 0,    // overflow carried in from the previous day (front-loaded)
  totalMin: 0,      // ownMin + carryInMin
  capacity: 0,      // effective shift minutes for the date
  overMin: 0,       // amount that won't fit (spills to next day)
  items: [],        // [{ orderId, ord_nr, product_code, units, workMin }]
})

// Build the wood conveyor placement for a set of orders.
//
// Args (all pulled from useAppData on the calling screen):
//   orders        : array of order rows ({ id, ord_nr, qty, product_code,
//                   prod_week, prod_day, ... })
//   productByCode : Map<code, product>   (product.wood_day_overrides used)
//   partsByProduct: Map<productId, part[]>
//   stepsByPart   : Map<partId, step[]>
//   machineByName : Map<name, machine>   (machine.department / wood_day / color)
//   holidaySet    : Set<'YYYY-MM-DD'>
//   year          : calendar year for ISO-week → date resolution
//
// Returns { machines, weeks, warnings, unassigned, placedOrders }.
export function buildWoodConveyor({
  orders,
  productByCode,
  partsByProduct,
  stepsByPart,
  machineByName,
  holidaySet,
  year = new Date().getFullYear(),
}) {
  // machineName -> { machineName, color, day, cells: Map<dateStr, cell> }
  const machines = new Map()
  const weeks = new Map() // weekKey "YYYY-WW" -> { year, week, dates:[5] }
  const warnings = []
  const unassigned = new Set() // wood machines referenced but with no day set
  const placedOrders = []
  // setup charged once per (product, machine, date)
  const setupSeen = new Set()

  const isWoodMachine = (name) => {
    const m = machineByName.get(name)
    return m && m.department === 'wood'
  }

  const ensureMachine = (name) => {
    if (!machines.has(name)) {
      const m = machineByName.get(name)
      machines.set(name, {
        machineName: name,
        color: m?.color || '#9aa0ad',
        day: m?.wood_day ?? null,
        cells: new Map(),
      })
    }
    return machines.get(name)
  }
  const ensureCell = (machineName, dateStr) => {
    const mach = ensureMachine(machineName)
    if (!mach.cells.has(dateStr)) mach.cells.set(dateStr, emptyCell())
    return mach.cells.get(dateStr)
  }

  for (const o of orders) {
    if (!o.qty || o.qty <= 0) continue
    if (o.prod_week == null || o.prod_day == null) {
      warnings.push({ type: 'no-week', orderId: o.id, ord_nr: o.ord_nr, product_code: o.product_code,
        message: `${o.ord_nr || o.product_code}: no production week yet — recalculate the schedule first.` })
      continue
    }
    const product = productByCode.get(o.product_code)
    if (!product) continue
    const parts = partsByProduct.get(product.id) || []
    if (parts.length === 0) continue

    // Does this order touch any wood machine at all? If not, skip silently —
    // it's a pure steel/dispatch order with no place on the wood conveyor.
    const touchesWood = parts.some((p) =>
      (stepsByPart.get(p.id) || []).some((s) => isWoodMachine(s.machine_name)))
    if (!touchesWood) continue

    const weekKey = `${year}-${String(o.prod_week).padStart(2, '0')}`
    if (!weeks.has(weekKey)) {
      weeks.set(weekKey, { year, week: o.prod_week, dates: weekDaySlots(year, o.prod_week, holidaySet) })
    }
    const slots = weeks.get(weekKey).dates
    const overrides = product.wood_day_overrides || {}
    const placement = { orderId: o.id, ord_nr: o.ord_nr, product_code: o.product_code, qty: o.qty, weekKey, items: [] }

    // Place one part's wood steps. `floorDay` lets assembly parts wait for the
    // latest non-assembly day. Returns the highest day this part used (so the
    // first pass can feed the assembly pass).
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
          warnings.push({ type: 'unassigned', machine: name, product_code: o.product_code,
            message: `${name} has no conveyor day — steps on it for ${o.product_code} were skipped.` })
          continue
        }
        // A part can never go backwards in time: at least the machine's own
        // day, but never before the previous step's day or the assembly floor.
        let placeDay = Math.max(day, prevDay, floorDay)
        if (placeDay !== day) {
          warnings.push({ type: 'reordered', machine: name, product_code: o.product_code,
            message: `${o.product_code}: ${name} (day ${day}) runs after an earlier step — placed on day ${placeDay} instead.` })
        }
        if (placeDay > MAX_DAYS - 1) {
          warnings.push({ type: 'past-week', machine: name, product_code: o.product_code,
            message: `${o.product_code}: ${name} lands on day ${placeDay}, past Friday — clamped to day ${MAX_DAYS - 1}.` })
          placeDay = MAX_DAYS - 1
        }
        prevDay = placeDay
        if (placeDay > maxDay) maxDay = placeDay

        const dateStr = slots[placeDay]
        const cell = ensureCell(name, dateStr)
        const workMin = ((s.seconds_per_part ?? 0) * totalParts) / 60
        cell.ownMin += workMin
        cell.items.push({ orderId: o.id, ord_nr: o.ord_nr, product_code: o.product_code, units: totalParts, workMin })

        // Setup once per (product, machine, date).
        const setupKey = `${o.product_code}|${name}|${dateStr}`
        if (!setupSeen.has(setupKey)) {
          const mach = machineByName.get(name)
          const setupMin = (s.setup_time && s.setup_time > 0) ? s.setup_time : (mach?.setup_time_min || 0)
          if (setupMin > 0) { cell.ownMin += setupMin; cell.setupMin += setupMin }
          setupSeen.add(setupKey)
        }
        placement.items.push({ machineName: name, dateStr, dayIndex: placeDay, units: totalParts, workMin })
      }
      return maxDay
    }

    // Pass 1: non-assembly parts. Track the latest day any of them used so
    // assembly can't start before everything else is finished (mirrors the
    // existing assembly-dependency rule).
    let maxNonAssemblyDay = 0
    for (const p of parts) {
      if (p.is_assembly) continue
      const used = placePart(p, 0)
      if (used > maxNonAssemblyDay) maxNonAssemblyDay = used
    }
    // Pass 2: assembly parts wait for the latest non-assembly day.
    for (const p of parts) {
      if (!p.is_assembly) continue
      placePart(p, maxNonAssemblyDay)
    }

    placedOrders.push(placement)
  }

  // Apply capacity + spill-forward overflow per machine, across the whole
  // calendar (a machine's real daily load), carrying overflow to the FRONT of
  // its next work day. Never reorders other machines; later days' own work just
  // follows the carried-in work.
  for (const mach of machines.values()) {
    const arr = [...mach.cells.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([date, cell]) => ({ date, cell }))
    let carry = 0
    let i = 0
    let guard = 0
    while (i < arr.length && guard < 400) {
      guard++
      const { date, cell } = arr[i]
      cell.carryInMin = carry
      cell.capacity = effectiveShiftMinutes(shiftForDate(strToDate(date)))
      cell.totalMin = cell.ownMin + carry
      if (cell.totalMin > cell.capacity) {
        cell.overMin = cell.totalMin - cell.capacity
        carry = cell.overMin
        const nd = dateToStr(nextWorkDay(strToDate(date), holidaySet))
        if (i + 1 >= arr.length || arr[i + 1].date !== nd) {
          const newCell = emptyCell()
          mach.cells.set(nd, newCell)
          arr.splice(i + 1, 0, { date: nd, cell: newCell })
        }
      } else {
        cell.overMin = 0
        carry = 0
      }
      i++
    }
  }

  const weekList = [...weeks.values()].sort((a, b) => a.week - b.week)
  return { machines, weeks: weekList, warnings, unassigned, placedOrders }
}
