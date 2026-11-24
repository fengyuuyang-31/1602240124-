// 连锁医生绩效模块：跨门店统计，按牙医/门店/月份排名
import { Router } from 'express';
import { query } from '../db.js';
import * as d from '../domain.js';
import { wrap, monthNow } from '../http.js';
import { requireRole } from '../guards.js';

export const performanceRouter = Router();
const MANAGERS = ['院长', '负责人'];

// 医生绩效排名（可跨门店）
performanceRouter.get('/ranking', wrap(async (req) => {
  await requireRole(req, MANAGERS);
  return d.performanceReport(Number(req.query.storeId) || null, req.query.month || '');
}));

// 门店绩效汇总（连锁对比）
performanceRouter.get('/stores', wrap(async (req) => {
  await requireRole(req, MANAGERS);
  const m = req.query.month || monthNow();
  const list = await d.performanceReport(null, String(m));
  const stores = await query('SELECT * FROM store ORDER BY id');
  return stores.map((s: any) => {
    const rows = list.filter((r: any) => r.storeId === s.id);
    return {
      storeId: s.id, storeName: s.name,
      dentists: rows.length,
      visits: rows.reduce((sum: number, r: any) => sum + r.visits, 0),
      income: Number(rows.reduce((sum: number, r: any) => sum + r.income, 0).toFixed(2)),
      cardSales: rows.reduce((sum: number, r: any) => sum + r.cardSales, 0),
      performance: Number(rows.reduce((sum: number, r: any) => sum + r.performance, 0).toFixed(2)),
    };
  });
}));

// 绩效明细（可追溯来源）
performanceRouter.get('/details', wrap(async (req) => {
  await requireRole(req, MANAGERS);
  return query(
    `SELECT dp.*, p.name AS dentist_name, s.name AS store_name FROM doctor_performance dp
     JOIN person p ON p.id=dp.dentist_id JOIN store s ON s.id=dp.store_id
     WHERE dp.month=$1 ORDER BY dp.performance DESC`, [req.query.month || monthNow()]);
}));
