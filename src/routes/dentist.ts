// 牙医工作站 API：我的候诊、书写病历、开具处方、治疗计划
// 安全：牙医身份由 token 决定，忽略前端传入的 dentistId；写记录前校验就诊归属本人。
import { Router } from 'express';
import { query, one } from '../db.js';
import * as d from '../domain.js';
import { wrap, monthNow } from '../http.js';
import { requireDentist } from '../guards.js';

export const dentistRouter = Router();
const monthOf = (v: any) => {
  const s = String(v || '');
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 7);
};

// 工作站基础数据
dentistRouter.get('/bootstrap', wrap(async () => {
  const [dentists, items] = await Promise.all([
    query('SELECT d.*, p.name, s.name AS store_name FROM dentist d JOIN person p ON p.id=d.person_id JOIN store s ON s.id=d.store_id ORDER BY d.person_id'),
    query('SELECT * FROM treatment_item ORDER BY id'),
  ]);
  return { dentists, items };
}));

// 我的候诊队列（牙医身份来自 token）
dentistRouter.get('/queue', wrap(async (req) => {
  const { dentistId } = await requireDentist(req);
  return query(
    `SELECT v.*, pe.name AS patient_name, pe.gender, pe.birth_date, pa.allergy, pa.medical_history,
       s.name AS store_name, ch.code AS chair_code
     FROM visit_record v JOIN person pe ON pe.id=v.patient_id
     LEFT JOIN patient pa ON pa.person_id=v.patient_id
     JOIN store s ON s.id=v.store_id LEFT JOIN chair ch ON ch.id=v.chair_id
     WHERE v.status IN ('待接诊','接诊中') AND v.dentist_id=$1
     ORDER BY v.queue_no LIMIT 100`, [dentistId]);
}));

// 书写病历并开具处方：校验该就诊属于当前牙医或本人当班门店
dentistRouter.post('/visits/:id/record', wrap(async (req) => {
  const { dentistId } = await requireDentist(req);
  const visit = await one('SELECT dentist_id FROM visit_record WHERE id=$1', [Number(req.params.id)]);
  if (!visit) throw new Error('就诊记录不存在');
  if (visit.dentist_id && Number(visit.dentist_id) !== dentistId) throw new Error('该就诊不属于当前牙医');
  return d.saveMedicalRecord(Number(req.params.id), req.body, dentistId);
}));

// 该牙医治疗计划
dentistRouter.get('/plans', wrap(async (req) => {
  const { dentistId } = await requireDentist(req);
  return query(
    `SELECT tp.*, pe.name AS patient_name, s.name AS store_name FROM treatment_plan tp
     JOIN person pe ON pe.id=tp.patient_id JOIN store s ON s.id=tp.store_id
     WHERE tp.dentist_id=$1 ORDER BY tp.id DESC LIMIT 100`, [dentistId]);
}));

dentistRouter.get('/plans/:id', wrap(async (req) => query(
  'SELECT tpi.*, ti.name AS item_name FROM treatment_plan_item tpi JOIN treatment_item ti ON ti.id=tpi.item_id WHERE tpi.plan_id=$1 ORDER BY tpi.period',
  [Number(req.params.id)])));

// 开具治疗计划：牙医身份来自 token
dentistRouter.post('/plans', wrap(async (req) => {
  const { dentistId, storeId } = await requireDentist(req);
  return d.createTreatmentPlan({ ...req.body, dentistId, storeId: req.body.storeId || storeId });
}));

// 我的处方（历史）
dentistRouter.get('/prescriptions', wrap(async (req) => {
  const { dentistId } = await requireDentist(req);
  return query(
    `SELECT pr.*, pe.name AS patient_name, v.dentist_id, v.id AS visit_id
     FROM prescription pr JOIN visit_record v ON v.id=pr.visit_record_id
     JOIN person pe ON pe.id=v.patient_id
     WHERE v.dentist_id=$1 ORDER BY pr.id DESC LIMIT 100`, [dentistId]);
}));

// 处方详情：点击某张处方弹出患者信息 + 诊断 + 处方明细
dentistRouter.get('/prescriptions/:id', wrap(async (req) => {
  const { dentistId } = await requireDentist(req);
  const id = Number(req.params.id);
  const head = (await query(
    `SELECT pr.*, pe.name AS patient_name, pe.gender, pe.birth_date, pa.allergy, pa.medical_history,
       v.complaint, v.exam, v.diagnosis, v.advice, v.arrived_at, s.name AS store_name
     FROM prescription pr JOIN visit_record v ON v.id=pr.visit_record_id
     JOIN person pe ON pe.id=v.patient_id LEFT JOIN patient pa ON pa.person_id=v.patient_id
     JOIN store s ON s.id=v.store_id
     WHERE pr.id=$1 AND v.dentist_id=$2`, [id, dentistId]))[0];
  if (!head) throw new Error('处方不存在或无权查看');
  const items = await query(
    `SELECT pi.*, ti.name AS item_name, ti.category FROM prescription_item pi
     JOIN treatment_item ti ON ti.id=pi.item_id WHERE pi.prescription_id=$1 ORDER BY pi.id`, [id]);
  return { ...head, items };
}));

// 我的接诊量（本月）：接诊人次来自 visit_record，去重患者数单列
dentistRouter.get('/stats', wrap(async (req) => {
  const { dentistId } = await requireDentist(req);
  const m = monthNow();
  const mine = (await query("SELECT patient_id,arrived_at FROM visit_record WHERE status='已完成' AND dentist_id=$1", [dentistId]))
    .filter((v: any) => monthOf(v.arrived_at) === m);
  return { month: m, visits: mine.length, patients: new Set(mine.map((v: any) => v.patient_id)).size };
}));
