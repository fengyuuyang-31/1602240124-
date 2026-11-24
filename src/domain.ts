import { query, one, tx } from './db.js';

// 本地时区日期（北京时间 UTC+8 在 00:00-08:00 时，UTC 日期会差一天）
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => localDate();
const monthNow = () => localDate().slice(0, 7);
const n = (v: any) => Number(v || 0);
// 显式取下一个主键：兼容 PostgreSQL 与内存库（内存库的 SERIAL 不会因种子数据的显式 id 前移）
const nextId = async (q: any, table: string) => n((await q(`SELECT COALESCE(MAX(id),0)+1 AS id FROM ${table}`))[0].id);
const monthOf = (v: any) => {
  const s = String(v || '');
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 7);
};

export async function listStores() {
  return query('SELECT * FROM store ORDER BY id');
}

export async function listSchedules(storeId?: number, date?: string) {
  let sql = `SELECT s.*, p.name AS dentist_name, c.code AS chair_code,
    (s.quota - s.locked) AS available
    FROM dentist_schedule s
    JOIN person p ON p.id = s.dentist_id
    JOIN chair c ON c.id = s.chair_id WHERE 1=1`;
  const args: any[] = [];
  if (storeId) { sql += ' AND s.store_id = $' + (args.push(storeId)); }
  if (date) { sql += ' AND s.work_date = $' + (args.push(date)); }
  sql += ' ORDER BY s.work_date, s.slot';
  return query(sql, args);
}

export async function createAppointment(input: any) {
  return tx(async (q) => {
    const { phone, name, storeId, dentistId, date, slot, project } = input;
    let pat = (await q('SELECT person_id FROM patient JOIN person ON person.id=patient.person_id WHERE person.phone=$1', [phone]))[0];
    if (!pat) {
      if (!name) throw new Error('新患者需填写姓名');
      const inserted = await q('INSERT INTO person (id,name,gender,phone,role) VALUES ($1,$2,$3,$4,$5) RETURNING id', [await nextId(q, 'person'), name, '其他', phone, '患者']);
      const pid = inserted[0].id;
      await q('INSERT INTO patient (person_id,allergy,member_level) VALUES ($1,$2,$3)', [pid, '无', '普通']);
      pat = { person_id: pid };
    }
    const pid = pat.person_id;
    const sameDay = await q(`SELECT COUNT(*)::int AS c FROM appointment
      WHERE patient_id=$1 AND appt_date=$2 AND status IN ('待就诊','已到院')`, [pid, date]);
    if (n(sameDay[0]?.c) > 0) throw new Error('同一患者同一天只能有一条有效预约');

    const sched = (await q('SELECT * FROM dentist_schedule WHERE dentist_id=$1 AND work_date=$2 AND slot=$3', [dentistId, date, slot]))[0];
    if (!sched) throw new Error('该牙医此时段无排班');
    if (n(sched.locked) >= n(sched.quota)) throw new Error('号源已满，请选择其他时段');
    // 条件更新 + 复核 locked，防止并发把同一号源超卖（事务内 CAS）
    await q('UPDATE dentist_schedule SET locked=locked+1 WHERE id=$1 AND locked<quota', [sched.id]);
    const check = (await q('SELECT locked FROM dentist_schedule WHERE id=$1', [sched.id]))[0];
    if (n(check.locked) !== n(sched.locked) + 1) throw new Error('并发预约冲突，请重试');
    const appt = await q(`INSERT INTO appointment (id,patient_id,dentist_id,schedule_id,chair_id,store_id,appt_date,slot,channel,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [await nextId(q, 'appointment'), pid, dentistId, sched.id, sched.chair_id, sched.store_id, date, slot, '小程序', '待就诊']);
    return { appointment: appt[0], project, notification: '预约成功通知已请求（模拟推送）' };
  });
}

export async function cancelAppointment(id: number, phone?: string) {
  return tx(async (q) => {
    const appt = (await q(`SELECT a.*, p.phone FROM appointment a JOIN person p ON p.id=a.patient_id WHERE a.id=$1`, [id]))[0];
    if (!appt) throw new Error('预约不存在');
    if (phone && appt.phone && appt.phone !== phone) throw new Error('无权取消他人的预约');
    if (appt.status !== '待就诊') throw new Error('仅待就诊预约可取消');
    if (appt.appt_date < today()) throw new Error('就诊日已过，不可自助取消');
    await q("UPDATE appointment SET status='已取消' WHERE id=$1", [id]);
    const sched = (await q('SELECT locked FROM dentist_schedule WHERE id=$1', [appt.schedule_id]))[0];
    const nextLocked = Math.max(0, n(sched?.locked) - 1);
    await q('UPDATE dentist_schedule SET locked=$1 WHERE id=$2', [nextLocked, appt.schedule_id]);
    return { ok: true, notification: '取消成功通知已请求（模拟推送）' };
  });
}

export async function checkIn(input: any) {
  return tx(async (q) => {
    const { phone, appointmentId, storeId } = input;
    let appt: any = null;
    if (appointmentId) appt = (await q('SELECT * FROM appointment WHERE id=$1', [appointmentId]))[0];
    else if (phone) appt = (await q(`SELECT a.* FROM appointment a JOIN person p ON p.id=a.patient_id
      WHERE p.phone=$1 AND a.appt_date=$2 AND a.status='待就诊'`, [phone, today()]))[0];
    if (!appt) throw new Error('未找到当日有效预约，请选择初诊直接到院');
    const patientId = appt.patient_id;
    const sid = storeId || appt.store_id;
    await q("UPDATE appointment SET status='已到院' WHERE id=$1", [appt.id]);
    const allVisits = await q('SELECT arrived_at FROM visit_record WHERE store_id=$1', [sid]);
    const queue = { c: allVisits.filter((v: any) => String(v.arrived_at || '').slice(0, 10) === today()).length };
    const chair = (await q("SELECT * FROM chair WHERE store_id=$1 AND status='空闲' ORDER BY id LIMIT 1", [sid]))[0];
    const visit = await q(`INSERT INTO visit_record (id,appointment_id,patient_id,dentist_id,store_id,chair_id,queue_no,status,arrived_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [await nextId(q, 'visit_record'), appt.id, patientId, appt.dentist_id, sid, chair?.id ?? null, n(queue?.c) + 1, '待接诊', new Date().toISOString()]);
    if (chair) await q("UPDATE chair SET status='占用' WHERE id=$1", [chair.id]);
    return { visit: visit[0], screen: '候诊大屏队列已更新（模拟）' };
  });
}

export async function walkIn(input: any) {
  return tx(async (q) => {
    const { phone, storeId, dentistId } = input;
    let pat = (await q('SELECT person_id FROM patient JOIN person ON person.id=patient.person_id WHERE phone=$1', [phone]))[0];
    if (!pat) throw new Error('请先建档');
    const allVisits = await q('SELECT arrived_at FROM visit_record WHERE store_id=$1', [storeId]);
    const queue = { c: allVisits.filter((v: any) => String(v.arrived_at || '').slice(0, 10) === today()).length };
    const chair = (await q("SELECT * FROM chair WHERE store_id=$1 AND status='空闲' ORDER BY id LIMIT 1", [storeId]))[0];
    const visit = await q(`INSERT INTO visit_record (id,patient_id,dentist_id,store_id,chair_id,queue_no,status,arrived_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [await nextId(q, 'visit_record'), pat.person_id, dentistId || null, storeId, chair?.id ?? null, n(queue?.c) + 1, '待接诊', new Date().toISOString()]);
    if (chair) await q("UPDATE chair SET status='占用' WHERE id=$1", [chair.id]);
    return visit[0];
  });
}

export async function saveMedicalRecord(visitId: number, input: any, dentistId?: number) {
  return tx(async (q) => {
    const visit = (await q('SELECT * FROM visit_record WHERE id=$1', [visitId]))[0];
    if (!visit) throw new Error('就诊记录不存在');
    // 服务端鉴权：医生只能给自己接诊的就诊写病历开处方
    if (dentistId && visit.dentist_id && n(visit.dentist_id) !== dentistId) throw new Error('无权操作他人的就诊');
    // 幂等：同一就诊只允许一份有效处方，避免重复收费
    const exists = (await q("SELECT id FROM prescription WHERE visit_record_id=$1", [visitId]))[0];
    if (exists) throw new Error('该就诊已开处方，不可重复开具');
    const patient = (await q('SELECT allergy FROM patient WHERE person_id=$1', [visit.patient_id]))[0];
    const items = input.items || [];
    if (!items.length) throw new Error('请至少添加一个处方项');
    let total = 0;
    for (const it of items) {
      const p = (await q('SELECT price FROM treatment_item WHERE id=$1', [it.itemId]))[0];
      if (!p) throw new Error('诊疗项目不存在');
      total += n(p.price) * n(it.quantity || 1);
    }
    await q(`UPDATE visit_record SET complaint=$1,exam=$2,diagnosis=$3,advice=$4,allergy_alert=$5,
      recall_interval_days=$6,status='待结算' WHERE id=$7`,
      [input.complaint, input.exam, input.diagnosis, input.advice, patient?.allergy || '无', input.recallDays || 90, visitId]);
    const pres = await q('INSERT INTO prescription (id,visit_record_id,total_amount) VALUES ($1,$2,$3) RETURNING id',
      [await nextId(q, 'prescription'), visitId, total]);
    for (const it of items) {
      const p = (await q('SELECT price FROM treatment_item WHERE id=$1', [it.itemId]))[0];
      await q('INSERT INTO prescription_item (id,prescription_id,item_id,quantity,usage,amount) VALUES ($1,$2,$3,$4,$5,$6)',
        [await nextId(q, 'prescription_item'), pres[0].id, it.itemId, it.quantity || 1, it.usage || '一次', n(p.price) * n(it.quantity || 1)]);
    }
    return { prescriptionId: pres[0].id, total, allergyAlert: patient?.allergy || '无' };
  });
}

export async function settleBill(visitId: number, input: any) {
  return tx(async (q) => {
    const visit = (await q('SELECT * FROM visit_record WHERE id=$1', [visitId]))[0];
    if (!visit || visit.status !== '待结算') throw new Error('该就诊不在待结算状态');
    const pres = (await q('SELECT * FROM prescription WHERE visit_record_id=$1 ORDER BY id DESC LIMIT 1', [visitId]))[0];
    if (!pres) throw new Error('未找到处方');
    const total = n(pres.total_amount) + 30;
    let discount = 0;
    let cardId = null;
    if (input.packageCardId) {
      const card = (await q(`SELECT pc.* FROM package_card pc WHERE pc.id=$1 AND pc.patient_id=$2`, [input.packageCardId, visit.patient_id]))[0];
      if (!card) throw new Error('套餐卡不属于该患者');
      if (card.status !== '有效' || n(card.remain_times) <= 0) throw new Error('套餐卡不可使用');
      const covered = (await q('SELECT item_id FROM package_item WHERE package_id=$1', [card.package_id])).map((x) => x.item_id);
      const used = (await q('SELECT item_id FROM prescription_item WHERE prescription_id=$1', [pres.id])).filter((x) => covered.includes(x.item_id));
      if (!used.length) throw new Error('本次处方不含套餐项目');
      discount = Math.min(total, used.reduce((s, x) => s + n(x.amount), 0));
      await q('UPDATE package_card SET remain_times=remain_times-1 WHERE id=$1', [card.id]);
      await q("UPDATE package_card SET status='已用完' WHERE id=$1 AND remain_times=0", [card.id]);
      cardId = card.id;
    }
    const bill = await q(`INSERT INTO bill (id,visit_record_id,patient_id,store_id,package_card_id,amount,discount,payable,payment_method)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [await nextId(q, 'bill'), visitId, visit.patient_id, visit.store_id, cardId, total, discount, total - discount, discount > 0 ? '套餐抵扣' : (input.paymentMethod || '微信')]);
    await q("UPDATE visit_record SET status='已完成' WHERE id=$1", [visitId]);
    if (visit.chair_id) await q("UPDATE chair SET status='空闲' WHERE id=$1", [visit.chair_id]);
    return bill[0];
  });
}

export async function sellPackageCard(input: any) {
  return tx(async (q) => {
    const { phone, packageId, storeId } = input;
    const pat = (await q('SELECT person_id FROM patient JOIN person ON person.id=patient.person_id WHERE phone=$1', [phone]))[0];
    if (!pat) throw new Error('患者未建档');
    const pkg = (await q("SELECT * FROM package WHERE id=$1 AND status='在售'", [packageId]))[0];
    if (!pkg) throw new Error('套餐不存在或已停售');
    const expire = new Date(); expire.setMonth(expire.getMonth() + n(pkg.valid_months));
    const cardNo = 'XYCARD' + Date.now().toString().slice(-8);
    const card = await q(`INSERT INTO package_card (id,package_id,patient_id,store_id,card_no,expire_date,total_times,remain_times,sold_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8) RETURNING *`,
      [await nextId(q, 'package_card'), packageId, pat.person_id, storeId || 1, cardNo, expire.toISOString().slice(0, 10), pkg.total_times, input.soldBy || 2]);
    return card[0];
  });
}

export async function deductPackageCard(id: number) {
  return tx(async (q) => {
    const card = (await q('SELECT * FROM package_card WHERE id=$1', [id]))[0];
    if (!card) throw new Error('套餐卡不存在');
    if (card.status !== '有效' || n(card.remain_times) <= 0) throw new Error('套餐卡不可扣次');
    if (card.expire_date < today()) throw new Error('套餐卡已过期');
    await q('UPDATE package_card SET remain_times=remain_times-1 WHERE id=$1', [id]);
    await q("UPDATE package_card SET status='已用完' WHERE id=$1 AND remain_times=0", [id]);
    return { ok: true };
  });
}

export async function createPurchaseOrder(input: any) {
  return tx(async (q) => {
    const items = input.items || [];
    if (!items.length) throw new Error('请填写采购明细');
    let amount = 0;
    for (const it of items) amount += n(it.quantity) * n(it.price);
    if (amount > n(input.limit || 100000)) throw new Error('超出采购上限，需院长调整上限后重新提交');
    const po = await q(`INSERT INTO purchase_order (id,store_id,order_date,supplier,status,amount) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [await nextId(q, 'purchase_order'), input.storeId || 1, today(), input.supplier || '模拟医疗器械供应商', '待审批', amount]);
    for (const it of items) {
      await q('INSERT INTO purchase_order_item (id,purchase_order_id,material_id,quantity,price) VALUES ($1,$2,$3,$4,$5)',
        [await nextId(q, 'purchase_order_item'), po[0].id, it.materialId, it.quantity, it.price]);
    }
    return po[0];
  });
}

export async function purchaseAction(id: number, action: 'approve' | 'receive', operatorId: number) {
  return tx(async (q) => {
    const po = (await q('SELECT * FROM purchase_order WHERE id=$1', [id]))[0];
    if (!po) throw new Error('采购单不存在');
    if (action === 'approve') {
      await q("UPDATE purchase_order SET status='已审批',approved_by=$1 WHERE id=$2", [operatorId, id]);
      return { ok: true };
    }
    if (po.status !== '已审批') throw new Error('仅已审批采购单可收货');
    const items = await q('SELECT * FROM purchase_order_item WHERE purchase_order_id=$1', [id]);
    for (const it of items) {
      await q('UPDATE material SET current_stock=current_stock+$1 WHERE id=$2', [it.quantity, it.material_id]);
      await q('INSERT INTO stock_movement (id,material_id,store_id,move_type,quantity,batch_no,operator_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [await nextId(q, 'stock_movement'), it.material_id, po.store_id, '入库', it.quantity, 'MOCK-' + Date.now().toString().slice(-6), operatorId]);
    }
    await q("UPDATE purchase_order SET status='已收货' WHERE id=$1", [id]);
    return { ok: true };
  });
}

export async function issueMaterial(input: any) {
  return tx(async (q) => {
    const m = (await q('SELECT * FROM material WHERE id=$1', [input.materialId]))[0];
    if (!m) throw new Error('耗材不存在');
    if (n(m.current_stock) < n(input.quantity)) throw new Error('库存不足');
    await q('UPDATE material SET current_stock=current_stock-$1 WHERE id=$2', [input.quantity, input.materialId]);
    await q('INSERT INTO stock_movement (id,material_id,store_id,move_type,quantity,operator_id,patient_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [await nextId(q, 'stock_movement'), input.materialId, input.storeId || m.store_id, '领用', input.quantity, input.operatorId || 4, input.patientId || null]);
    return { lowStock: n(m.current_stock) - n(input.quantity) < n(m.safety_stock) };
  });
}

export async function createTreatmentPlan(input: any) {
  return tx(async (q) => {
    const items = input.items || [];
    if (!items.length) throw new Error('请填写计划项');
    const total = items.reduce((s: number, it: any) => s + n(it.estimate), 0);
    const plan = await q(`INSERT INTO treatment_plan (id,patient_id,dentist_id,store_id,total_amount,periods,status)
      VALUES ($1,$2,$3,$4,$5,$6,'进行中') RETURNING *`,
      [await nextId(q, 'treatment_plan'), input.patientId, input.dentistId, input.storeId || 1, total, items.length]);
    for (const it of items) {
      await q('INSERT INTO treatment_plan_item (id,plan_id,period,item_id,plan_date,estimate,status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [await nextId(q, 'treatment_plan_item'), plan[0].id, it.period, it.itemId, it.planDate || null, it.estimate, '待执行']);
    }
    return plan[0];
  });
}

export async function profitReport(storeId: number | null, month: string) {
  const m = month || monthNow();
  const bills = await query(`SELECT b.*, v.dentist_id, v.store_id, v.id AS visit_id
    FROM bill b JOIN visit_record v ON v.id=b.visit_record_id`);
  const filtered = bills.filter((b) => {
    return monthOf(b.paid_at) === m && (!storeId || b.store_id === storeId);
  });
  const income = filtered.reduce((s, b) => s + n(b.payable), 0);
  const visits = filtered.map((b) => b.visit_id);
  let cost = 0;
  const byItem: Record<string, { income: number; cost: number }> = {};
  if (visits.length) {
    const visitSet = new Set(visits);
    const allItems = await query(`SELECT pi.item_id, pi.quantity, pi.amount, p.visit_record_id, ti.name, ic.material_cost, ic.labor_cost, ic.allocation, ic.effective_date
      FROM prescription_item pi JOIN prescription p ON p.id=pi.prescription_id
      JOIN treatment_item ti ON ti.id=pi.item_id
      LEFT JOIN item_cost ic ON ic.item_id=pi.item_id`);
    const rows = allItems.filter((r: any) => visitSet.has(r.visit_record_id));
    // 同一项目可能有多条成本版本；每个项目只取最新生效的一条用于核算，避免成本重复累加。
    const costOf = new Map<number, { date: string; unit: number }>();
    for (const r of rows) {
      const prev = costOf.get(r.item_id);
      const date = String(r.effective_date || '');
      if (!prev || date >= prev.date) {
        costOf.set(r.item_id, { date, unit: n(r.material_cost) + n(r.labor_cost) + n(r.allocation) });
      }
    }
    for (const r of rows) {
      const unit = costOf.get(r.item_id)?.unit || 0;
      const c = unit * n(r.quantity);
      cost += c;
      byItem[r.name] ||= { income: 0, cost: 0 };
      byItem[r.name].income += n(r.amount);
      byItem[r.name].cost += c;
    }
  }
  const expenses = (await query('SELECT type,amount FROM expense WHERE month=$1' + (storeId ? ' AND store_id=$2' : ''), storeId ? [m, storeId] : [m]));
  const expenseTotal = expenses.reduce((s, e) => s + n(e.amount), 0);
  return {
    month: m,
    storeId,
    income: Number(income.toFixed(2)),
    itemCost: Number(cost.toFixed(2)),
    expense: Number(expenseTotal.toFixed(2)),
    gross: Number((income - cost).toFixed(2)),
    profit: Number((income - cost - expenseTotal).toFixed(2)),
    byItem: Object.entries(byItem).map(([name, v]) => ({ name, income: n(v.income), cost: n(v.cost), gross: n(v.income) - n(v.cost) })),
    expenses,
  };
}

export async function performanceReport(storeId: number | null, month: string) {
  const m = month || monthNow();
  const dentists = await query(`SELECT d.person_id, p.name, d.title, d.specialty, d.store_id, d.commission_rate
    FROM dentist d JOIN person p ON p.id=d.person_id`);
  const allVisits = await query("SELECT * FROM visit_record WHERE status='已完成'");
  const visits = allVisits.filter((v: any) => monthOf(v.arrived_at) === m);
  const bills = await query('SELECT * FROM bill');
  const cards = await query('SELECT * FROM package_card');
  const result: any[] = [];

  // 跨店借调：接诊按 visit_record.store_id 归集到实际出诊门店；
  // 同一医生在不同门店分别成行，筛选门店时才能正确显示借调贡献。
  for (const d of dentists) {
    const byStore = new Map<number, any[]>();
    for (const v of visits) {
      if (n(v.dentist_id) !== n(d.person_id)) continue;
      const sid = n(v.store_id) || n(d.store_id);
      const list = byStore.get(sid) || [];
      list.push(v);
      byStore.set(sid, list);
    }
    for (const [sid, vlist] of byStore) {
      if (storeId && sid !== storeId) continue;
      const vids = new Set(vlist.map((x: any) => x.id));
      const patients = new Set(vlist.map((x: any) => x.patient_id));
      const income = bills.filter((b: any) => vids.has(b.visit_record_id)).reduce((s: number, b: any) => s + n(b.payable), 0);
      const sales = cards.filter((c: any) => c.sold_by === d.person_id && n(c.store_id) === sid && monthOf(c.sold_at) === m).length;
      const perf = income * n(d.commission_rate);
      result.push({
        dentistId: d.person_id, name: d.name, title: d.title, storeId: sid,
        visits: vlist.length, patients: patients.size,
        income: Number(income.toFixed(2)), cardSales: sales, performance: Number(perf.toFixed(2)),
      });
    }
  }

  // 写入 doctor_performance 明细表（先清当月旧数据保证可重算）
  if (result.length) {
    const maxId = n((await query('SELECT COALESCE(MAX(id),0) AS n FROM doctor_performance'))[0].n);
    await query('DELETE FROM doctor_performance WHERE month=$1', [m]);
    let id = maxId;
    for (const r of result) {
      await query(`INSERT INTO doctor_performance
        (id,dentist_id,store_id,month,visits,income,card_sales,performance)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [++id, r.dentistId, r.storeId, m, r.visits, r.income, r.cardSales, r.performance]);
    }
  }
  return result.sort((a, b) => b.performance - a.performance);
}

export async function processFollowups() {
  return tx(async (q) => {
    const due = await q("SELECT * FROM followup_reminder WHERE send_status='待发送' AND due_date<=$1", [today()]);
    for (const r of due) {
      await q("UPDATE followup_reminder SET send_status='已发送' WHERE id=$1", [r.id]);
      console.log(`[worker] 复诊提醒已模拟推送给患者 ${r.patient_id}（提醒 #${r.id}）`);
    }
    return due.length;
  });
}

export async function dashboard() {
  const stores = (await query('SELECT COUNT(*)::int AS n FROM store'))[0]?.n;
  const patients = (await query('SELECT COUNT(*)::int AS n FROM patient'))[0]?.n;
  const dentists = (await query('SELECT COUNT(*)::int AS n FROM dentist'))[0]?.n;
  const appointments = (await query("SELECT COUNT(*)::int AS n FROM appointment WHERE status='待就诊'"))[0]?.n;
  const visits = (await query("SELECT COUNT(*)::int AS n FROM visit_record WHERE status='待接诊'"))[0]?.n;
  const lowStock = (await query('SELECT COUNT(*)::int AS n FROM material WHERE current_stock<safety_stock'))[0]?.n;
  const due = (await query("SELECT COUNT(*)::int AS n FROM followup_reminder WHERE send_status='待发送' AND due_date<=$1", [today()]))[0]?.n;
  return { stores, patients, dentists, appointments, visits, lowStock, due };
}
