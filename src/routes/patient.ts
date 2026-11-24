// 患者端 API：预约、取消、复诊、会员优惠券、洁牙专门挂号、购买套餐
// 安全：所有查询一律用登录 token 解析出的手机号，忽略前端传入的 phone，防止越权查他人数据。
import { Router } from 'express';
import { query } from '../db.js';
import * as d from '../domain.js';
import * as m from '../member.js';
import { wrap, today } from '../http.js';
import { requirePatient } from '../guards.js';

export const patientRouter = Router();

// 小程序首页基础数据（公开目录，无需登录）
patientRouter.get('/bootstrap', wrap(async () => {
  const [stores, items, allDentists, transfers] = await Promise.all([
    query('SELECT * FROM store ORDER BY id'),
    query('SELECT * FROM treatment_item ORDER BY id'),
    query(`SELECT d.*, p.name, s.name AS store_name FROM dentist d
      JOIN person p ON p.id=d.person_id JOIN store s ON s.id=d.store_id
      ORDER BY d.person_id`),
    query("SELECT dentist_id, to_store_id FROM doctor_transfer WHERE status='已批准'"),
  ]);
  // 正在借调到外店的牙医不在本部号源目录展示。
  // 用 JS 过滤而非 SQL 关联子查询（pg-mem 对子查询引用外层别名 d.store_id 有兼容问题）。
  const storeOf = new Map<number, number>(allDentists.map((d: any) => [Number(d.person_id), Number(d.store_id)]));
  const away = new Set<number>(transfers
    .filter((t: any) => Number(t.to_store_id) !== storeOf.get(Number(t.dentist_id)))
    .map((t: any) => Number(t.dentist_id)));
  const dentists = allDentists.filter((d: any) => !away.has(Number(d.person_id)));
  return { stores, items, dentists, today: today() };
}));

// 可预约号源（公开号源目录）
patientRouter.get('/schedules', wrap(async (req) =>
  d.listSchedules(Number(req.query.storeId) || undefined, req.query.date || undefined)));

// 我的预约：手机号来自 token
patientRouter.get('/appointments', wrap(async (req) => {
  const { phone } = await requirePatient(req);
  return query(
    `SELECT a.*, p.name AS patient_name, dn.name AS dentist_name, s.name AS store_name
     FROM appointment a JOIN person p ON p.id=a.patient_id
     JOIN person dn ON dn.id=a.dentist_id JOIN store s ON s.id=a.store_id
     WHERE p.phone=$1 ORDER BY a.appt_date DESC, a.id DESC LIMIT 100`, [phone]);
}));

// 提交预约：手机号来自 token，姓名也取登录患者，避免冒名建档
patientRouter.post('/appointments', wrap(async (req) => {
  const me = await requirePatient(req);
  return d.createAppointment({ ...req.body, phone: me.phone, name: me.name });
}));

// 取消预约：先校验该预约属于当前登录患者
patientRouter.post('/appointments/:id/cancel', wrap(async (req) => {
  const me = await requirePatient(req);
  return d.cancelAppointment(Number(req.params.id), me.phone);
}));

// 我的复诊计划：手机号来自 token
patientRouter.get('/revisits', wrap(async (req) => {
  const { phone } = await requirePatient(req);
  const [reminders, plans, visits] = await Promise.all([
    query(`SELECT f.*, pe.name AS patient_name, pe.phone, s.name AS store_name,
      dn.name AS dentist_name FROM followup_reminder f
      JOIN person pe ON pe.id=f.patient_id JOIN store s ON s.id=f.store_id
      LEFT JOIN visit_record v ON v.id=f.visit_record_id
      LEFT JOIN person dn ON dn.id=v.dentist_id
      WHERE pe.phone=$1 ORDER BY f.due_date`, [phone]),
    query(`SELECT tp.*, dn.name AS dentist_name FROM treatment_plan tp
      JOIN person pe ON pe.id=tp.patient_id JOIN person dn ON dn.id=tp.dentist_id
      WHERE pe.phone=$1 ORDER BY tp.id DESC`, [phone]),
    query(`SELECT v.*, dn.name AS dentist_name, s.name AS store_name FROM visit_record v
      JOIN person pe ON pe.id=v.patient_id JOIN person dn ON dn.id=v.dentist_id
      JOIN store s ON s.id=v.store_id WHERE pe.phone=$1 AND v.status='已完成'
      ORDER BY v.id DESC LIMIT 50`, [phone]),
  ]);
  return { reminders, plans, visits };
}));

// 从复诊提醒发起复诊预约
patientRouter.post('/revisits/book', wrap(async (req) => {
  const me = await requirePatient(req);
  const date = String(req.body.date || '').trim();
  const slot = String(req.body.slot || '').trim();
  const dentistId = Number(req.body.dentistId);
  if (!date || !slot || !dentistId) throw new Error('缺少复诊预约参数');
  return d.createAppointment({ phone: me.phone, name: me.name,
    storeId: Number(req.body.storeId) || undefined,
    dentistId, date, slot, project: req.body.project || '复诊' });
}));

// 我的套餐卡
patientRouter.get('/cards', wrap(async (req) => {
  const { phone } = await requirePatient(req);
  return query(
    `SELECT pc.*, p.name AS package_name, s.name AS store_name, pe.name AS patient_name, pe.phone
     FROM package_card pc JOIN package p ON p.id=pc.package_id
     JOIN person pe ON pe.id=pc.patient_id LEFT JOIN store s ON s.id=pc.store_id
     WHERE pe.phone=$1 ORDER BY pc.id DESC`, [phone]);
}));

// 我的治疗计划列表
patientRouter.get('/plans', wrap(async (req) => {
  const { phone } = await requirePatient(req);
  return query(
    `SELECT tp.*, dn.name AS dentist_name FROM treatment_plan tp
     JOIN person pe ON pe.id=tp.patient_id JOIN person dn ON dn.id=tp.dentist_id
     WHERE pe.phone=$1 ORDER BY tp.id DESC`, [phone]);
}));

// 治疗计划期次明细：先校验归属当前患者，再返回明细
patientRouter.get('/plans/:id', wrap(async (req) => {
  const { phone } = await requirePatient(req);
  const pid = Number(req.params.id);
  const plan = (await query(
    `SELECT tp.* FROM treatment_plan tp JOIN person pe ON pe.id=tp.patient_id
     WHERE tp.id=$1 AND pe.phone=$2`, [pid, phone]))[0];
  if (!plan) throw new Error('治疗计划不存在或无权查看');
  const items = await query(
    `SELECT tpi.*, ti.name AS item_name, ti.category FROM treatment_plan_item tpi
     JOIN treatment_item ti ON ti.id=tpi.item_id WHERE tpi.plan_id=$1 ORDER BY tpi.period`, [pid]);
  return { plan, items };
}));

// ===== 会员 / 优惠券 =====
// 会员信息与我的券（手机号来自 token）
patientRouter.get('/member', wrap(async (req) => {
  const { phone } = await requirePatient(req);
  return m.memberInfo(phone);
}));

// ===== 洁牙专门挂号（与牙痛就诊预约分开）=====
// 洁牙号源目录（公开）
patientRouter.get('/hygiene/schedules', wrap(async (req) =>
  m.listHygieneSchedules(Number(req.query.storeId) || undefined, req.query.date || undefined)));

// 洁牙项目与在售套餐目录（公开）
patientRouter.get('/hygiene/catalog', wrap(async () => m.hygieneCatalog()));

// 我的洁牙预约
patientRouter.get('/hygiene/appointments', wrap(async (req) => {
  const { phone } = await requirePatient(req);
  return m.myHygieneAppointments(phone);
}));

// 提交洁牙预约：用券享会员价 / 套餐卡扣次 / 到店支付
patientRouter.post('/hygiene/appointments', wrap(async (req) => {
  const { phone } = await requirePatient(req);
  return m.createHygieneAppointment({ ...req.body, phone });
}));

// 取消洁牙预约：释放号源并退回券/次数
patientRouter.post('/hygiene/appointments/:id/cancel', wrap(async (req) => {
  const { phone } = await requirePatient(req);
  return m.cancelHygieneAppointment(Number(req.params.id), phone);
}));

// ===== 购买洁牙次数套餐 =====
// 在售套餐（含所含项目与单次原价，供对比展示）
patientRouter.get('/packages', wrap(async () => (await m.hygieneCatalog()).packages));

// 模拟支付购买套餐：可用券抵扣，生成套餐卡
patientRouter.post('/packages/buy', wrap(async (req) => {
  const { phone } = await requirePatient(req);
  return m.buyPackage({ ...req.body, phone });
}));

// 我的套餐购买订单
patientRouter.get('/package-orders', wrap(async (req) => {
  const { phone } = await requirePatient(req);
  return m.myPackageOrders(phone);
}));
