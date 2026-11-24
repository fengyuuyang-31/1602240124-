// 临时借调路由：申请 -> 负责人/院长审批 -> 自动生成目标门店排班 -> 到期结束
// 审批规则：负责人 / 院长任一通过即生效；两方均不通过才最终驳回。
// 业务规则：同一牙医同一天同一时段只能有一条排班；借调生成的排班用 transfer_id 标记来源，结束只清理本单排班。
import { Router } from 'express';
import { query, one, tx } from '../db.js';
import { wrap, today } from '../http.js';
import { requireApprover, recordApproval, approvalSummaries, approved, APPROVER_ROLES } from './auth.js';
import { requireRole } from '../guards.js';

export const transferRouter = Router();
const SLOTS = ['09:00', '10:00', '14:00', '15:00'];

const listSql = `SELECT t.*, p.name AS dentist_name, fs.name AS from_store, ts.name AS to_store,
  ap.name AS applicant_name, av.name AS approver_name
  FROM doctor_transfer t
  JOIN person p ON p.id=t.dentist_id
  JOIN store fs ON fs.id=t.from_store_id JOIN store ts ON ts.id=t.to_store_id
  LEFT JOIN person ap ON ap.id=t.applicant_id LEFT JOIN person av ON av.id=t.approved_by`;

// 借调单列表（附审批意见）——仅负责人/院长
transferRouter.get('/list', wrap(async (req) => {
  await requireRole(req, ['院长', '负责人']);
  const status = String(req.query.status || '');
  const rows = await query(`${listSql} ${status ? 'WHERE t.status=$1' : ''} ORDER BY t.id DESC`, status ? [status] : []);
  const approvals = await approvalSummaries('医生借调');
  return rows.map((r: any) => ({ ...r, approvals: approvals.get(r.id) || [] }));
}));

// 可借调牙医（不含已被借调在外者）——负责人/院长
transferRouter.get('/dentists', wrap(async (req) => {
  await requireRole(req, ['院长', '负责人']);
  return query(
    `SELECT d.person_id, p.name, d.title, d.specialty, s.id AS store_id, s.name AS store_name
     FROM dentist d JOIN person p ON p.id=d.person_id JOIN store s ON s.id=d.store_id
     WHERE d.person_id NOT IN (SELECT dentist_id FROM doctor_transfer WHERE status IN ('待审批','已批准'))
     ORDER BY d.person_id`);
}));

// 申请借调：申请人取登录人
transferRouter.post('/apply', wrap(async (req) => {
  const me = await requireRole(req, ['院长', '负责人']);
  const b = req.body;
  const dentistId = Number(b.dentistId);
  const from = Number(b.fromStoreId);
  const to = Number(b.toStoreId);
  const start = String(b.startDate || '');
  const end = String(b.endDate || '');
  if (!dentistId || !from || !to || !start || !end) throw new Error('请填写牙医、原门店、目标门店和起止日期');
  if (from === to) throw new Error('原门店与目标门店不能相同');
  if (end < start) throw new Error('结束日期不能早于开始日期');
  const d = await one('SELECT * FROM dentist WHERE person_id=$1', [dentistId]);
  if (!d) throw new Error('牙医不存在');
  if (d.store_id !== from) throw new Error('原门店与该牙医所属门店不一致');
  const conflict = await one(`SELECT id FROM doctor_transfer
    WHERE dentist_id=$1 AND status IN ('待审批','已批准') AND NOT (end_date < $2 OR start_date > $3)`,
    [dentistId, start, end]);
  if (conflict) throw new Error('该时段已有借调申请或进行中的借调');
  await query(`INSERT INTO doctor_transfer
    (id,dentist_id,from_store_id,to_store_id,start_date,end_date,reason,status,applicant_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [await nextId('doctor_transfer'), dentistId, from, to, start, end, b.reason || '', '待审批', me.personId]);
  return { message: '借调申请已提交，等待分院负责人或院长审批' };
}));

// 审批借调：批准时生成目标门店排班；整体在一个事务里，失败则全部回滚
transferRouter.post('/:id/approve', wrap(async (req) => {
  const me = await requireApprover(req);
  const id = Number(req.params.id);
  const approve = req.body.approve !== false;
  const tr = await one('SELECT * FROM doctor_transfer WHERE id=$1', [id]);
  if (!tr) throw new Error('借调单不存在');
  if (tr.status !== '待审批') throw new Error('该借调单已处理');
  if (await approved('医生借调', id)) throw new Error('该借调单已有通过记录，不能重复生成排班');

  return tx(async (q) => {
    await q(`INSERT INTO approval_record
      (id,biz_type,biz_id,approver_id,approver_name,approver_role,decision,opinion)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [await nextId('approval_record'), '医生借调', id, me.person_id, me.person_name || '', me.active_role,
        approve ? '通过' : '不通过', String(req.body.opinion || '')]);

    if (!approve) {
      const rows = await q(`SELECT approver_role FROM approval_record WHERE biz_type=$1 AND biz_id=$2 AND decision=$3`,
        ['医生借调', id, '不通过']);
      const rejected = new Set(rows.map((r: any) => r.approver_role));
      const finalReject = APPROVER_ROLES.every((role) => rejected.has(role));
      const status = finalReject ? '已驳回' : '待审批';
      if (finalReject) await q("UPDATE doctor_transfer SET status='已驳回' WHERE id=$1", [id]);
      const approvals = (await approvalSummaries('医生借调')).get(id) || [];
      return { status, approvals, message: finalReject ? '负责人与院长均不通过，借调已驳回'
        : '已登记不通过意见；仍可由另一方审批，任一方通过即生效' };
    }

    // 借调规则：释放原店该时段"未锁定"排班；locked>0 已有预约则保留原班并跳过目标店排班（不可违约）
    const chairs = (await q('SELECT id FROM chair WHERE store_id=$1 ORDER BY id', [tr.to_store_id])).map((c: any) => c.id);
    if (!chairs.length) throw new Error('目标门店暂无可用椅位');
    let sid = Number((await q('SELECT COALESCE(MAX(id),0) AS n FROM dentist_schedule'))[0].n);
    let created = 0, freed = 0, kept = 0;
    for (let d = new Date(tr.start_date); d <= new Date(tr.end_date); d.setDate(d.getDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      for (const slot of SLOTS) {
        const origin = (await q('SELECT id,locked FROM dentist_schedule WHERE dentist_id=$1 AND work_date=$2 AND slot=$3',
          [tr.dentist_id, date, slot]))[0];
        if (origin && Number(origin.locked) > 0) { kept++; continue; } // 原店已有预约，须履约
        if (origin) { await q('DELETE FROM dentist_schedule WHERE id=$1', [origin.id]); freed++; }
        // 在目标店挑一个真正空闲的椅位（逐把检查，而非简单轮转）
        let chairId = null;
        for (const cid of chairs) {
          const busy = (await q('SELECT id FROM dentist_schedule WHERE chair_id=$1 AND work_date=$2 AND slot=$3', [cid, date, slot]))[0];
          if (!busy) { chairId = cid; break; }
        }
        if (!chairId) { kept++; continue; } // 目标店该时段无空闲椅位，跳过
        await q(`INSERT INTO dentist_schedule (id,dentist_id,store_id,chair_id,work_date,slot,quota,locked,transfer_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [++sid, tr.dentist_id, tr.to_store_id, chairId, date, slot, 1, 0, id]);
        created++;
      }
    }
    await q("UPDATE doctor_transfer SET status='已批准',approved_by=$1,approved_at=CURRENT_TIMESTAMP WHERE id=$2", [me.person_id, id]);
    const approvals = (await approvalSummaries('医生借调')).get(id) || [];
    return { status: '已批准', schedulesCreated: created, schedulesFreed: freed, schedulesKept: kept, approvals,
      note: '已释放原店空闲排班并在目标店生成排班；原店已有预约的时段保留履约' };
  });
}));

// 结束借调：只清理本借调单生成的、且未锁定的排班（不碰其他来源的班）
transferRouter.post('/:id/finish', wrap(async (req) => {
  await requireApprover(req);
  const id = Number(req.params.id);
  const tr = await one('SELECT * FROM doctor_transfer WHERE id=$1', [id]);
  if (!tr) throw new Error('借调单不存在');
  if (tr.status !== '已批准') throw new Error('仅已批准的借调可结束');
  await tx(async (q) => {
    await q('DELETE FROM dentist_schedule WHERE transfer_id=$1 AND locked=0', [id]);
    await q("UPDATE doctor_transfer SET status='已结束' WHERE id=$1", [id]);
  });
  return { status: '已结束' };
}));

const nextId = async (table: string) => Number((await query(`SELECT COALESCE(MAX(id),0)+1 AS id FROM ${table}`))[0].id);
