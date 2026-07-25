import { supabase } from './supabase'
import { isoWeek } from './scheduling'
import { buildScheduleRows, writeScheduleRows } from './scheduleEngine'

// ============================================================
// Split a big-qty order into batches (child orders).
//
// The original order becomes Batch 1 (qty reduced to the first batch); one new
// sibling order is created per additional batch. Each batch gets its OWN qty and
// start date, so it schedules + tracks independently. We also write per-batch
// order_tracks (prod_week/day pinned to the chosen date, minutes scaled by the
// batch's share of the qty) so the two-track Priority views and CR reflect the
// batch dates, and we generate schedule rows so each batch shows up on Schedule /
// Tracking right away.
//
// batches: [{ qty:number, startDate:'YYYY-MM-DD' }, ...]  — sum must equal order.qty
// maps: { partsByProduct, stepsByPart, productByCode, machineByName, holidaySet, year }
// ============================================================

function slotFromDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const dow = d.getDay() === 0 ? 7 : d.getDay()
  return { prod_week: isoWeek(d), prod_day: dow > 5 ? null : dow }
}

// order_tracks rows for one batch — same dept split as the original, minutes
// scaled by the batch's fraction of the total qty, dates pinned to the batch.
function trackRowsFor(orderId, originalTracks, ratio, slot) {
  return (originalTracks || [])
    .filter((t) => t.department && t.department !== 'other')
    .map((t) => ({
      order_id: orderId,
      department: t.department,
      prod_week: slot.prod_week,
      prod_day: slot.prod_day,
      bottleneck: t.bottleneck || null,
      total_minutes: Math.max(1, Math.round((t.total_minutes || 0) * ratio)),
      work_days: t.work_days || null,
      status: 'pending',
      started_at: null,
      completed_at: null,
      updated_at: new Date().toISOString(),
    }))
}

export async function splitOrder({ order, batches, maps }) {
  if (!order?.id) throw new Error('Order required')
  const total = batches.reduce((s, b) => s + (Number(b.qty) || 0), 0)
  if (batches.length < 2) throw new Error('Add at least 2 batches to split.')
  if (batches.some((b) => !(Number(b.qty) > 0))) throw new Error('Every batch needs a quantity greater than 0.')
  if (batches.some((b) => !b.startDate)) throw new Error('Every batch needs a start date.')
  if (total !== order.qty) throw new Error(`Batch quantities must add up to ${order.qty} (currently ${total}).`)

  const originalQty = order.qty
  const group = `SG-${order.id}`
  const count = batches.length
  const year = maps.year || new Date().getFullYear()

  // --- 1. Original order becomes Batch 1 ---
  const b1 = batches[0]
  const s1 = slotFromDate(b1.startDate)
  const { data: updated, error: uErr } = await supabase
    .from('orders')
    .update({
      qty: b1.qty,
      prod_week: s1.prod_week,
      prod_day: s1.prod_day,
      split_group: group,
      batch_index: 1,
      batch_count: count,
    })
    .eq('id', order.id)
    .select()
    .single()
  if (uErr) throw new Error(`Updating original order: ${uErr.message}`)

  // --- 2. Sibling orders for batches 2..N ---
  const siblingPayloads = batches.slice(1).map((b, i) => {
    const s = slotFromDate(b.startDate)
    return {
      // Manual/derived orders carry a null kwitasie (Postgres unique index
      // allows many nulls); they group by the shared ord_nr + split_group.
      kwitasie_nr: null,
      ord_nr: order.ord_nr || null,
      qty: b.qty,
      product_code: order.product_code,
      customer_code: order.customer_code,
      department: order.department,
      due_date: order.due_date,
      send_week: order.send_week,
      send_day: order.send_day,
      prod_week: s.prod_week,
      prod_day: s.prod_day,
      description: order.description || null,
      group: order.group || null,
      wood_type: order.wood_type || null,
      notes: order.notes || null,
      priority_rank: order.priority_rank ?? null,
      split_group: group,
      batch_index: i + 2,
      batch_count: count,
    }
  })
  const { data: siblings, error: iErr } = await supabase
    .from('orders')
    .insert(siblingPayloads)
    .select()
  if (iErr) throw new Error(`Creating batch orders: ${iErr.message}`)

  // Line up each persisted order with the batch it came from (index order is
  // preserved by the insert).
  const batchOrders = [
    { row: updated, batch: b1 },
    ...siblings.map((row, i) => ({ row, batch: batches[i + 1] })),
  ]

  // --- 3. Per-batch order_tracks (pin dates, scale minutes by qty share) ---
  const allTrackRows = []
  for (const { row, batch } of batchOrders) {
    const ratio = originalQty > 0 ? batch.qty / originalQty : 1
    allTrackRows.push(...trackRowsFor(row.id, order.tracks, ratio, slotFromDate(batch.startDate)))
  }
  if (allTrackRows.length > 0) {
    const { error: tErr } = await supabase
      .from('order_tracks')
      .upsert(allTrackRows, { onConflict: 'order_id,department' })
    if (tErr) throw new Error(`Writing batch tracks: ${tErr.message}`)
  }

  // --- 4. Generate schedule rows for every batch, grouped by week ---
  // Completion-aware: skip units already produced on the original (batch 1).
  const allIds = batchOrders.map((b) => b.row.id)
  const doneByOrderStep = new Map()
  const { data: doneRows } = await supabase
    .from('schedule')
    .select('order_id, machine_step_id, qty_done')
    .in('order_id', allIds)
  for (const r of (doneRows || [])) {
    const qd = r.qty_done ?? 0
    if (!r.order_id || !r.machine_step_id || qd <= 0) continue
    const k = `${r.order_id}::${r.machine_step_id}`
    doneByOrderStep.set(k, (doneByOrderStep.get(k) || 0) + qd)
  }

  const byWeek = new Map() // prod_week -> order rows
  for (const { row } of batchOrders) {
    if (row.prod_week == null || row.prod_day == null) continue
    if (!byWeek.has(row.prod_week)) byWeek.set(row.prod_week, [])
    byWeek.get(row.prod_week).push(row)
  }

  let scheduleInserted = 0
  for (const [week, weekOrders] of byWeek) {
    const { rows } = buildScheduleRows({
      weekNumber: week,
      year,
      orders: weekOrders,
      partsByProductId: maps.partsByProduct,
      stepsByPartId: maps.stepsByPart,
      productByCode: maps.productByCode,
      machineByName: maps.machineByName,
      holidaySet: maps.holidaySet || new Set(),
      doneByOrderStep,
    })
    const { inserted } = await writeScheduleRows({
      orderIds: weekOrders.map((o) => o.id),
      rows,
    })
    scheduleInserted += inserted
  }

  return { updated, siblings, group, count, scheduleInserted }
}
