// 退款模块（板书硬伤补齐）：退款额度以原收费单为上限、审批校验、幂等键防重复提交。
// 规则：累计退款（含本次）不得超过原单实收；同一幂等键只处理一次；仅待审批可审批；审批通过冲减账单 payable。
import { Router } from 'express';
import { createHash } from 'node:crypto';
import { query, one, tx } from '../db.js';
import { wrap } from '../http.js';
import { requireRole } from '../guards.js';
import { requireApprover, recordApproval, approvalSummaries, approved, APPROVER_ROLES } from './auth.js';

export const refundRouter = Router();
const APPROVERS = ['院长', '负责人'];
const n = (v: any) => Number(v || 0);
const nextId = async (q: any, t: string) => n((await q(`SELECT COALESCE(MAX(id),0)+1 AS id FROM ${t}`))[0].id);

// 已退金额（不含已驳回）
async function refunded(q: any, billId: number) {
  const rows = await q("SELECT COALESCE(SUM(amount),0) AS s FROM refund_request WHERE bill_id=$1 AND status='已退款'", [billId]);
  return n(rows[0]?.s);
}

// 可退款收费单（供前台/管理端选择）
refundRouter.get('/bills', wrap(async (req) => {
  await requireRole(req, [...APPROVERS, '前台']);
  return query(`SELECT b.id, b.payable, b.paid_at, b.payment_method, pe.name AS patient_name, s.name AS store_name
    FROM bill b JOIN person pe ON pe.id=b.patient_id JOIN store s ON s.id=b.store_id
    ORDER BY b.id DESC LIMIT 200`);
}));

// 申请退款：额度校验 + 幂等键
refundRouter.post('/apply', wrap(async (req) => {
  const me = await requireRole(req, ['院长', '负责人', '前台']);
  const billId = Number(req.body.billId);
  const amount = n(req.body.amount);
  const reason = String(req.body.reason || '').trim();
  if (!billId || !reason) throw new Error('请填写收费单与退款原因');
  // 幂等键由服务端根据业务内容自动生成，用户无需填写；相同申请重复提交返回原单
  const key = createHash('sha256').update(`${billId}|${amount}|${reason}`).digest('hex').slice(0, 32);
  if (amount <= 0) throw new Error('退款金额必须大于 0');
  const bill = await one('SELECT * FROM bill WHERE id=$1', [billId]);
  if (!bill) throw new Error('收费单不存在');
  // 幂等：同一业务键直接返回已有申请，不重复创建
  if (key) {
    const exist = await one('SELECT * FROM refund_request WHERE idempotency_key=$1', [key]);
    if (exist) return { ...exist, idempotent: true, message: '重复提交已拦截，返回原退款申请' };
  }
  return tx(async (q) => {
    const refundedSoFar = await refunded(q, billId);
    const remain = n(bill.payable) - refundedSoFar;
    if (amount > remain) throw new Error(`退款超额：该单可退 ${remain.toFixed(2)} 元`);
    const id = await nextId(q, 'refund_request');
    await q(`INSERT INTO refund_request
      (id,bill_id,amount,reason,idempotency_key,status,applicant_id)
      VALUES ($1,$2,$3,$4,$5,'待审批',$6)`,
      [id, billId, amount, reason, key || null, me.personId]);
    return { id, billId, amount, status: '待审批', message: '退款申请已提交，等待负责人或院长审批' };
  });
}));

// 退款申请列表（附审批意见）
refundRouter.get('/list', wrap(async (req) => {
  await requireRole(req, [...APPROVERS, '前台']);
  const rows = await query(`SELECT r.*, b.payable, b.patient_id, pe.name AS patient_name, b.store_id
    FROM refund_request r JOIN bill b ON b.id=r.bill_id JOIN person pe ON pe.id=b.patient_id
    ORDER BY r.id DESC`);
  const approvals = await approvalSummaries('退款审批');
  return rows.map((r: any) => ({ ...r, approvals: approvals.get(r.id) || [] }));
}));

// 审批退款：任一方通过即退款；通过时二次校验额度，防并发超额
refundRouter.post('/:id/approve', wrap(async (req) => {
  const me = await requireApprover(req);
  const id = Number(req.params.id);
  const approve = req.body.approve !== false;
  const rr = await one('SELECT * FROM refund_request WHERE id=$1', [id]);
  if (!rr) throw new Error('退款申请不存在');
  if (rr.status !== '待审批') throw new Error('该退款申请已处理');
  if (await approved('退款审批', id)) throw new Error('该退款申请已有通过记录');

  return tx(async (q) => {
    await q(`INSERT INTO approval_record
      (id,biz_type,biz_id,approver_id,approver_name,approver_role,decision,opinion)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [await nextId(q, 'approval_record'), '退款审批', id, me.person_id, me.person_name || '', me.active_role,
        approve ? '通过' : '不通过', String(req.body.opinion || '')]);

    if (!approve) {
      const rows = await q("SELECT approver_role FROM approval_record WHERE biz_type='退款审批' AND biz_id=$1 AND decision='不通过'", [id]);
      const rejected = new Set(rows.map((r: any) => r.approver_role));
      const finalReject = APPROVER_ROLES.every((role) => rejected.has(role));
      const status = finalReject ? '已驳回' : '待审批';
      if (finalReject) await q("UPDATE refund_request SET status='已驳回' WHERE id=$1", [id]);
      return { status, message: finalReject ? '双方均不通过，退款已驳回' : '已登记不通过意见，仍可由另一方审批' };
    }

    const bill = (await q('SELECT * FROM bill WHERE id=$1', [rr.bill_id]))[0];
    if (!bill) throw new Error('原收费单不存在');
    const refundedSoFar = await refunded(q, rr.bill_id);
    if (n(rr.amount) > n(bill.payable) - refundedSoFar) throw new Error('退款超额，审批被拒绝');
    await q("UPDATE refund_request SET status='已退款',approved_by=$1,approved_at=CURRENT_TIMESTAMP WHERE id=$2", [me.person_id, id]);
    // 冲减账单实收，利润报表自动反映退款
    await q('UPDATE bill SET payable=payable-$1 WHERE id=$2', [rr.amount, rr.bill_id]);
    return { status: '已退款', refunded: n(rr.amount), remainingPayable: n(bill.payable) - n(rr.amount) };
  });
}));
