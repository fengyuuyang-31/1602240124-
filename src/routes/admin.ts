// 管理网站共用 API：前台/院长/库管的排班、套餐、库存、报到结算等
import { Router } from 'express';
import { query } from '../db.js';
import * as d from '../domain.js';
import { wrap, monthNow } from '../http.js';
import { requireRole } from '../guards.js';

export const adminRouter = Router();
// 管理端菜单按角色过滤见 admin.js GROUPS.roles；服务端用同一口径做 RBAC。
const BOSS = ['院长', '负责人'];
const FRONT = ['院长', '负责人', '前台'];
const STORE = ['院长', '负责人', '库管员'];
const ALL_STAFF = ['院长', '负责人', '前台', '库管员', '护士'];

adminRouter.get('/bootstrap', wrap(async (req) => {
  await requireRole(req, ALL_STAFF);
  const [storesRaw, dentists, items, packages, materials, chairs, dashboard] = await Promise.all([
    query('SELECT * FROM store ORDER BY id'),
    query('SELECT d.*, p.name, p.phone, s.name AS store_name FROM dentist d JOIN person p ON p.id=d.person_id JOIN store s ON s.id=d.store_id ORDER BY d.person_id'),
    query('SELECT * FROM treatment_item ORDER BY id'),
    query('SELECT * FROM package ORDER BY id'),
    query('SELECT m.*, s.name AS store_name FROM material m JOIN store s ON s.id=m.store_id ORDER BY m.id'),
    query('SELECT c.*, s.name AS store_name FROM chair c JOIN store s ON s.id=c.store_id ORDER BY c.id'),
    d.dashboard(),
  ]);
  const stores = storesRaw.map((s: any) => ({ ...s, chairs: chairs.filter((c: any) => c.store_id === s.id).length }));
  return { stores, dentists, items, packages, materials, chairs, dashboard, today: new Date().toISOString().slice(0, 10) };
}));

// 排班与椅位
adminRouter.get('/schedules', wrap(async (req) => {
  await requireRole(req, ALL_STAFF);
  return d.listSchedules(Number(req.query.storeId) || undefined, req.query.date || undefined);
}));
adminRouter.post('/schedules', wrap(async (req) => {
  await requireRole(req, BOSS);
  const b = req.body;
  const next = (await query('SELECT COALESCE(MAX(id),0)+1 AS id FROM dentist_schedule'))[0].id;
  return query(`INSERT INTO dentist_schedule (id,dentist_id,store_id,chair_id,work_date,slot,quota)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [next, b.dentistId, b.storeId, b.chairId, b.date, b.slot, b.quota || 1]);
}));

// 前台报到 / 初诊到院 / 结算
adminRouter.post('/checkin', wrap(async (req) => { await requireRole(req, FRONT); return d.checkIn(req.body); }));
adminRouter.post('/walkin', wrap(async (req) => { await requireRole(req, FRONT); return d.walkIn(req.body); }));
adminRouter.get('/visits', wrap(async (req) => {
  await requireRole(req, [...FRONT, ...STORE]);
  return query(
    `SELECT v.*, p.name AS patient_name, dn.name AS dentist_name, s.name AS store_name
     FROM visit_record v JOIN person p ON p.id=v.patient_id
     LEFT JOIN person dn ON dn.id=v.dentist_id JOIN store s ON s.id=v.store_id
     ${req.query.status ? 'WHERE v.status=$1' : ''} ORDER BY v.id DESC LIMIT 100`,
    req.query.status ? [req.query.status] : []);
}));
adminRouter.post('/visits/:id/settle', wrap(async (req) => {
  await requireRole(req, FRONT);
  return d.settleBill(Number(req.params.id), req.body);
}));

// 患者档案
adminRouter.get('/patients', wrap(async (req) => {
  await requireRole(req, [...FRONT, ...STORE]);
  return query(
    `SELECT p.*, pe.name, pe.phone, pe.gender, pe.birth_date FROM patient p JOIN person pe ON pe.id=p.person_id
     ${req.query.phone ? 'WHERE pe.phone=$1' : ''} ORDER BY p.person_id LIMIT 100`,
    req.query.phone ? [req.query.phone] : []);
}));
adminRouter.post('/patients', wrap(async (req) => {
  await requireRole(req, FRONT);
  const b = req.body;
  const next = (await query('SELECT COALESCE(MAX(id),0)+1 AS id FROM person'))[0].id;
  const p = await query('INSERT INTO person (id,name,gender,birth_date,phone,role) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [next, b.name, b.gender || '其他', b.birthDate || null, b.phone, '患者']);
  await query('INSERT INTO patient (person_id,allergy,medical_history,member_level) VALUES ($1,$2,$3,$4)',
    [p[0].id, b.allergy || '无', b.medicalHistory || '无', b.memberLevel || '普通']);
  return p[0];
}));

// 套餐目录
adminRouter.get('/packages', wrap(async (req) => {
  await requireRole(req, ALL_STAFF);
  return query('SELECT * FROM package ORDER BY id');
}));
adminRouter.post('/packages', wrap(async (req) => {
  await requireRole(req, FRONT);
  const b = req.body;
  const next = (await query('SELECT COALESCE(MAX(id),0)+1 AS id FROM package'))[0].id;
  return query(`INSERT INTO package (id,tier,name,price,valid_months,total_times,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [next, b.tier, b.name, b.price, b.validMonths, b.totalTimes, b.status || '在售']);
}));
adminRouter.put('/packages/:id', wrap(async (req) => {
  await requireRole(req, FRONT);
  const b = req.body;
  return query(`UPDATE package SET name=$1,price=$2,valid_months=$3,total_times=$4,status=$5 WHERE id=$6 RETURNING *`,
    [b.name, b.price, b.validMonths, b.totalTimes, b.status, Number(req.params.id)]);
}));

// 套餐卡销售与扣次
adminRouter.get('/cards', wrap(async (req) => {
  await requireRole(req, [...FRONT, ...STORE]);
  return query(
    `SELECT pc.*, p.name AS package_name, pe.name AS patient_name, pe.phone
     FROM package_card pc JOIN package p ON p.id=pc.package_id JOIN person pe ON pe.id=pc.patient_id
     ${req.query.phone ? 'WHERE pe.phone=$1' : ''} ORDER BY pc.id DESC LIMIT 100`, req.query.phone ? [req.query.phone] : []);
}));
adminRouter.post('/cards', wrap(async (req) => {
  const me = await requireRole(req, FRONT);
  return d.sellPackageCard({ ...req.body, soldBy: me.personId });
}));
adminRouter.post('/cards/:id/deduct', wrap(async (req) => {
  await requireRole(req, FRONT);
  return d.deductPackageCard(Number(req.params.id));
}));

// 随访工作台
adminRouter.get('/followups', wrap(async (req) => {
  await requireRole(req, FRONT);
  return query(
    `SELECT f.*, pe.name AS patient_name, pe.phone, s.name AS store_name FROM followup_reminder f
     JOIN person pe ON pe.id=f.patient_id JOIN store s ON s.id=f.store_id ORDER BY f.id DESC LIMIT 100`);
}));
adminRouter.post('/followups/:id/result', wrap(async (req) => {
  const me = await requireRole(req, FRONT);
  return query(
    'UPDATE followup_reminder SET callback_result=$1,callback_by=$2 WHERE id=$3 RETURNING *',
    [req.body.result, me.personId, Number(req.params.id)]);
}));

// 库存领用
adminRouter.get('/stock', wrap(async (req) => {
  await requireRole(req, ALL_STAFF);
  return query('SELECT m.*, s.name AS store_name FROM material m JOIN store s ON s.id=m.store_id ORDER BY m.id');
}));
adminRouter.post('/stock/issue', wrap(async (req) => {
  const me = await requireRole(req, STORE);
  return d.issueMaterial({ ...req.body, operatorId: me.personId });
}));

// 复诊提醒 worker
adminRouter.post('/worker/run', wrap(async (req) => {
  await requireRole(req, BOSS);
  return { processed: await d.processFollowups() };
}));
