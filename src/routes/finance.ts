// 费用模块：每个诊疗项目花了多少钱 / 收费多少 / 房租水电 / 医疗产品采购 / 利润
import { Router } from 'express';
import { query } from '../db.js';
import * as d from '../domain.js';
import { wrap, monthNow } from '../http.js';
import { requireRole } from '../guards.js';

export const financeRouter = Router();
const MANAGERS = ['院长', '负责人'];
// 利润/成本属经营敏感数据，仅管理层与前台结算需要；库管只看采购与库存
const READERS = ['院长', '负责人', '前台'];
const PURCHASE_READERS = ['院长', '负责人', '前台', '库管员'];

// 项目收支字典：收费价 vs 成本（材料+人工+分摊）vs 单位毛利
financeRouter.get('/items', wrap(async (req) => {
  await requireRole(req, READERS);
  const rows = await query(
    `SELECT ti.id, ti.name, ti.category, ti.price AS charge_price,
       COALESCE(ic.material_cost,0) AS material_cost,
       COALESCE(ic.labor_cost,0) AS labor_cost,
       COALESCE(ic.allocation,0) AS allocation
     FROM treatment_item ti
     LEFT JOIN item_cost ic ON ic.item_id=ti.id
     ORDER BY ti.id`);
  return rows.map((r: any) => {
    const cost = Number(r.material_cost) + Number(r.labor_cost) + Number(r.allocation);
    return { ...r, unit_cost: Number(cost.toFixed(2)), unit_margin: Number((Number(r.charge_price) - cost).toFixed(2)) };
  });
}));

// 维护项目成本（每个项目花了多少钱）
financeRouter.put('/items/:id/cost', wrap(async (req) => {
  await requireRole(req, MANAGERS);
  const itemId = Number(req.params.id);
  const b = req.body;
  const date = b.effectiveDate || new Date().toISOString().slice(0, 10);
  const existing = await query('SELECT id FROM item_cost WHERE item_id=$1 AND effective_date=$2', [itemId, date]);
  if (existing.length) {
    return query(`UPDATE item_cost SET material_cost=$1,labor_cost=$2,allocation=$3 WHERE id=$4 RETURNING *`,
      [b.materialCost || 0, b.laborCost || 0, b.allocation || 0, existing[0].id]);
  }
  const next = (await query('SELECT COALESCE(MAX(id),0)+1 AS id FROM item_cost'))[0].id;
  return query(`INSERT INTO item_cost (id,item_id,material_cost,labor_cost,allocation,effective_date)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [next, itemId, b.materialCost || 0, b.laborCost || 0, b.allocation || 0, date]);
}));

// 房租水电等期间费用
financeRouter.get('/expenses', wrap(async (req) => {
  await requireRole(req, READERS);
  return query(
    `SELECT e.*, s.name AS store_name FROM expense e JOIN store s ON s.id=e.store_id
     WHERE e.month=$1 ORDER BY e.id`, [req.query.month || monthNow()]);
}));

financeRouter.post('/expenses', wrap(async (req) => {
  await requireRole(req, MANAGERS);
  const b = req.body;
  const next = (await query('SELECT COALESCE(MAX(id),0)+1 AS id FROM expense'))[0].id;
  return query(`INSERT INTO expense (id,store_id,month,type,amount,note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [next, b.storeId, b.month || monthNow(), b.type, b.amount, b.note || '']);
}));

financeRouter.delete('/expenses/:id', wrap(async (req) => {
  await requireRole(req, MANAGERS);
  return query('DELETE FROM expense WHERE id=$1 RETURNING *', [Number(req.params.id)]);
}));

// 医疗产品采购单
financeRouter.get('/purchases', wrap(async (req) => {
  await requireRole(req, PURCHASE_READERS);
  const orders = await query(`SELECT po.*, s.name AS store_name
    FROM purchase_order po JOIN store s ON s.id=po.store_id ORDER BY po.id DESC`);
  const items = await query('SELECT purchase_order_id, quantity, price FROM purchase_order_item');
  return orders.map((o: any) => ({
    ...o,
    calc_amount: Number(items.filter((i: any) => i.purchase_order_id === o.id)
      .reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.price), 0).toFixed(2)),
  }));
}));

financeRouter.get('/purchases/:id/items', wrap(async (req) => {
  await requireRole(req, PURCHASE_READERS);
  return query(
    `SELECT poi.*, m.name AS material_name, m.spec, m.unit FROM purchase_order_item poi
     JOIN material m ON m.id=poi.material_id WHERE poi.purchase_order_id=$1 ORDER BY poi.id`,
    [Number(req.params.id)]);
}));

financeRouter.post('/purchases', wrap(async (req) => {
  await requireRole(req, ['院长', '负责人', '库管员']);
  return d.createPurchaseOrder(req.body);
}));
// 审批人从 token 取，不再信任前端传来的 operatorId
financeRouter.post('/purchases/:id/approve', wrap(async (req) => {
  const me = await requireRole(req, MANAGERS);
  return d.purchaseAction(Number(req.params.id), 'approve', me.personId);
}));
financeRouter.post('/purchases/:id/receive', wrap(async (req) => {
  const me = await requireRole(req, ['院长', '负责人', '库管员']);
  return d.purchaseAction(Number(req.params.id), 'receive', me.personId);
}));

// 利润核算：收入 - 项目成本 - 期间费用
financeRouter.get('/profit', wrap(async (req) => {
  await requireRole(req, READERS);
  return d.profitReport(Number(req.query.storeId) || null, req.query.month || '');
}));

// 采购支出汇总（按门店/月）
financeRouter.get('/purchase-summary', wrap(async (req) => {
  await requireRole(req, PURCHASE_READERS);
  const rows = await query(`SELECT po.store_id, po.order_date, po.amount, s.name AS store_name
    FROM purchase_order po JOIN store s ON s.id=po.store_id WHERE po.status='已收货'`);
  const m = req.query.month || monthNow();
  const sid = Number(req.query.storeId) || null;
  const filtered = rows.filter((r: any) => String(r.order_date).slice(0, 7) === m && (!sid || r.store_id === sid));
  return { month: m, total: Number(filtered.reduce((s: number, r: any) => s + Number(r.amount || 0), 0).toFixed(2)), rows: filtered };
}));
