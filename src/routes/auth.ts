// 登录与账号路由：患者（手机号+模拟验证码）、员工（工号/姓名+密码），注册与审批，一人多角色切换
// 审批规则：负责人 / 院长任一通过即生效；两方均不通过才视为最终不通过（作业演示口径）
import { Router } from 'express';
import crypto from 'node:crypto';
import { query, one } from '../db.js';
import { wrap } from '../http.js';

export const authRouter = Router();

const hash = (pwd: string) => crypto.createHash('sha256').update(pwd).digest('hex');
const token = () => crypto.randomBytes(16).toString('hex');
const STAFF_ROLES = ['牙医', '前台', '库管员', '负责人', '院长', '护士'];
export const APPROVER_ROLES = ['负责人', '院长'];

// 读取当前员工身份（供审批接口复用）
export async function currentStaff(req: any) {
  const t = String(req.headers['x-session-token'] || '');
  const rows = await query(`SELECT s.person_id,s.active_role,p.name AS person_name,p.account_status
    FROM staff_session s JOIN person p ON p.id=s.person_id WHERE s.token=$1`, [t]);
  if (!rows.length) throw new Error('未登录或登录已过期');
  if (rows[0].account_status !== '已开通') throw new Error('账号未开通');
  return rows[0];
}

// 审批权限：负责人或院长
export async function requireApprover(req: any) {
  const me = await currentStaff(req);
  if (!APPROVER_ROLES.includes(me.active_role)) throw new Error('仅分院负责人或院长可审批');
  return me;
}

// 审批留痕：任一通过即生效，两方均不通过才最终不通过
export async function recordApproval(bizType: string, bizId: number, me: any, decision: '通过' | '不通过', opinion = '') {
  await query(`INSERT INTO approval_record
    (id,biz_type,biz_id,approver_id,approver_name,approver_role,decision,opinion)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [await nextId('approval_record'), bizType, bizId, me.person_id, me.person_name || '', me.active_role, decision, opinion]);
}

export async function approved(bizType: string, bizId: number) {
  const rows = await query('SELECT approver_role,decision FROM approval_record WHERE biz_type=$1 AND biz_id=$2', [bizType, bizId]);
  return rows.some((r: any) => r.decision === '通过');
}

// 汇总审批意见，供管理端展示"谁已通过/谁不通过"
export async function approvalSummaries(bizType: string) {
  const rows = await query(`SELECT biz_id,approver_name,approver_role,decision,opinion,created_at
    FROM approval_record WHERE biz_type=$1 ORDER BY id`, [bizType]);
  const map = new Map<number, string[]>();
  for (const r of rows) {
    const list = map.get(r.biz_id) || [];
    list.push(`${r.approver_name}（${r.approver_role}）${r.decision}${r.opinion ? '：' + r.opinion : ''}`);
    map.set(r.biz_id, list);
  }
  return map;
}

async function resolveByApprovals(bizType: string, bizId: number, approvedStatus: string, rejectedStatus: string, pendingStatus: string) {
  const rows = await query('SELECT approver_role,decision FROM approval_record WHERE biz_type=$1 AND biz_id=$2', [bizType, bizId]);
  if (rows.some((r: any) => r.decision === '通过')) return approvedStatus;
  const rejected = new Set(rows.filter((r: any) => r.decision === '不通过').map((r: any) => r.approver_role));
  if (APPROVER_ROLES.every((role) => rejected.has(role))) return rejectedStatus;
  return pendingStatus;
}

// 模拟验证码：固定 1234，便于作业演示（真实项目应短信下发并校验有效期）
export const MOCK_CODE = '1234';

// 模拟短信发送：写入 sms_message 留痕便于演示与核对（真实项目此处对接短信网关）
async function sendSms(phone: string, bizType: string, bizId: number | null, content: string) {
  const id = await nextId('sms_message');
  await query(`INSERT INTO sms_message (id,phone,biz_type,biz_id,content,send_status,sent_at)
    VALUES ($1,$2,$3,$4,$5,'已发送',CURRENT_TIMESTAMP)`, [id, phone, bizType, bizId, content]);
  return { id, phone, content, status: '已发送' };
}

// 患者登录：首次登录自动建档并成为会员、发放新客优惠券
authRouter.post('/patient/login', wrap(async (req) => {
  const phone = String(req.body.phone || '').trim();
  const code = String(req.body.code || '').trim();
  const name = String(req.body.name || '').trim();
  if (!phone) throw new Error('请输入手机号');
  if (code !== MOCK_CODE) throw new Error(`验证码错误（演示验证码 ${MOCK_CODE}）`);
  // 已是患者直接登录；新手机号自动建档。ensureMember 同时升级会员并幂等发券。
  const anyPerson = await one('SELECT role,name FROM person WHERE phone=$1', [phone]);
  if (anyPerson && anyPerson.role !== '患者') throw new Error('该手机号不是患者账号');
  const { ensureMember } = await import('../member.js');
  const member = await ensureMember(phone, name || anyPerson?.name || '患者');
  const t = token();
  await query('INSERT INTO patient_session (token,person_id) VALUES ($1,$2)', [t, member.personId]);
  const me = await one('SELECT name,phone FROM person WHERE id=$1', [member.personId]);
  return { token: t, personId: member.personId, name: me?.name, phone: me?.phone, role: '患者', member: true };
}));

// 患者注册：手机号 + 验证码 + 姓名 + 性别 + 年龄，注册即成为会员并自动发放新客券。
// 与"直接登录"分开：登录页只留手机号/验证码，新用户走此注册入口填写资料。
authRouter.post('/patient/register', wrap(async (req) => {
  const phone = String(req.body.phone || '').trim();
  const code = String(req.body.code || '').trim();
  const name = String(req.body.name || '').trim();
  const gender = String(req.body.gender || '').trim();
  const ageRaw = req.body.age;
  if (!/^1\d{10}$/.test(phone)) throw new Error('请输入正确的 11 位手机号');
  if (code !== MOCK_CODE) throw new Error(`验证码错误（演示验证码 ${MOCK_CODE}）`);
  if (!name) throw new Error('请输入姓名');
  if (!['男', '女', '其他'].includes(gender)) throw new Error('请选择性别');
  const age = Number(ageRaw);
  if (!Number.isInteger(age) || age < 1 || age > 120) throw new Error('请输入 1～120 之间的年龄');
  if (await one('SELECT id FROM person WHERE phone=$1', [phone])) throw new Error('该手机号已注册，请直接登录');
  // 年龄换算为出生日期（按当前年份 - 年龄，生日取 1 月 1 日，模拟数据够用）
  const birthDate = `${new Date().getFullYear() - age}-01-01`;
  const { ensureMember } = await import('../member.js');
  const member = await ensureMember(phone, name, gender, birthDate);
  const t = token();
  await query('INSERT INTO patient_session (token,person_id) VALUES ($1,$2)', [t, member.personId]);
  await sendSms(phone, '会员注册', member.personId,
    `【信义口腔】${name}，注册成功！您已成为会员并获赠新客洗牙优惠券。`);
  return { token: t, personId: member.personId, name, phone, role: '患者', member: true,
    message: '注册成功，已自动成为会员并获赠新客券' };
}));

// 校验患者 token，返回当前登录患者（前端每次进入时调用）
authRouter.get('/patient/me', wrap(async (req) => {
  const t = String(req.headers['x-patient-token'] || '');
  const rows = await query(`SELECT p.id,p.name,p.phone,p.role FROM patient_session s JOIN person p ON p.id=s.person_id WHERE s.token=$1`, [t]);
  if (!rows.length) throw new Error('未登录或登录已过期');
  return rows[0];
}));

authRouter.post('/patient/logout', wrap(async (req) => {
  await query('DELETE FROM patient_session WHERE token=$1', [String(req.headers['x-patient-token'] || '')]);
  return { ok: true };
}));

// 员工登录：工号 或 姓名 或 手机号 + 密码
authRouter.post('/staff/login', wrap(async (req) => {
  const account = String(req.body.account || '').trim();
  const pwd = String(req.body.password || '');
  if (!account || !pwd) throw new Error('请输入工号/姓名和密码');
  const p = await one(`SELECT * FROM person WHERE (staff_no=$1 OR name=$1 OR phone=$1) AND role<>'患者'`, [account]);
  if (!p) throw new Error('账号不存在');
  if (hash(pwd) !== p.password_hash) throw new Error('密码错误');
  if (p.account_status === '待审批') throw new Error('账号待分院负责人或院长审批开通');
  if (p.account_status === '已停用') throw new Error('账号已停用');
  const roles = (await query('SELECT role FROM staff_role WHERE person_id=$1', [p.id])).map((r: any) => r.role);
  if (!roles.length) throw new Error('该账号未分配角色，请联系负责人或院长');
  const preferred = roles.includes('院长') ? '院长' : roles.includes('负责人') ? '负责人' : roles[0];
  const t = token();
  await query('INSERT INTO staff_session (token,person_id,active_role) VALUES ($1,$2,$3)', [t, p.id, preferred]);
  return { token: t, personId: p.id, name: p.name, staffNo: p.staff_no, roles, activeRole: preferred };
}));

// 校验员工 token + 取当前身份
authRouter.get('/staff/me', wrap(async (req) => {
  const t = String(req.headers['x-session-token'] || '');
  const rows = await query(`SELECT s.person_id,s.active_role,p.name,p.staff_no,p.account_status
    FROM staff_session s JOIN person p ON p.id=s.person_id WHERE s.token=$1`, [t]);
  if (!rows.length) throw new Error('未登录或登录已过期');
  const me = rows[0];
  if (me.account_status !== '已开通') throw new Error('账号未开通');
  const roles = (await query('SELECT role FROM staff_role WHERE person_id=$1', [me.person_id])).map((r: any) => r.role);
  // 前端统一用 activeRole（驼峰），同时保留 active_role 兼容后端内部审批逻辑
  return { ...me, activeRole: me.active_role, personId: me.person_id, roles };
}));

// 切换身份（一人多角色，如院长⇄医生）
authRouter.post('/staff/switch-role', wrap(async (req) => {
  const t = String(req.headers['x-session-token'] || '');
  const role = String(req.body.role || '');
  const me = await one(`SELECT s.person_id, p.account_status FROM staff_session s
    JOIN person p ON p.id=s.person_id WHERE s.token=$1`, [t]);
  if (!me) throw new Error('未登录');
  if (me.account_status !== '已开通') throw new Error('账号未开通或已停用，无法切换身份');
  const has = await one('SELECT role FROM staff_role WHERE person_id=$1 AND role=$2', [me.person_id, role]);
  if (!has) throw new Error('该账号无此角色');
  await query('UPDATE staff_session SET active_role=$1 WHERE token=$2', [role, t]);
  return { personId: me.person_id, activeRole: role };
}));

authRouter.post('/staff/logout', wrap(async (req) => {
  await query('DELETE FROM staff_session WHERE token=$1', [String(req.headers['x-session-token'] || '')]);
  return { ok: true };
}));

// 修改密码：校验原密码 + 两次新密码一致，成功后旧密码立即失效
authRouter.post('/staff/change-password', wrap(async (req) => {
  const t = String(req.headers['x-session-token'] || '');
  const s = await one(`SELECT s.person_id, p.account_status FROM staff_session s
    JOIN person p ON p.id=s.person_id WHERE s.token=$1`, [t]);
  if (!s) throw new Error('未登录或登录已过期');
  if (s.account_status !== '已开通') throw new Error('账号未开通或已停用');
  const oldPwd = String(req.body.oldPassword || '');
  const newPwd = String(req.body.newPassword || '');
  const confirmPwd = String(req.body.confirmPassword || '');
  if (!oldPwd || !newPwd) throw new Error('请填写原密码和新密码');
  if (newPwd !== confirmPwd) throw new Error('两次输入的新密码不一致');
  const p = await one('SELECT password_hash,phone,name FROM person WHERE id=$1', [s.person_id]);
  if (!p) throw new Error('账号不存在');
  if (hash(oldPwd) !== p.password_hash) throw new Error('原密码错误');
  if (hash(newPwd) === p.password_hash) throw new Error('新密码不能与原密码相同');
  await query('UPDATE person SET password_hash=$1 WHERE id=$2', [hash(newPwd), s.person_id]);
  await sendSms(p.phone, '密码修改', s.person_id, `【信义口腔】${p.name}，您的账号密码已修改成功。如非本人操作，请联系负责人或院长。`);
  return { message: '密码修改成功，下次登录请使用新密码' };
}));

// 员工注册（无需填工号，系统自动生成；提交后待负责人或院长审批，短信告知结果）
authRouter.post('/staff/register', wrap(async (req) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const pwd = String(req.body.password || '');
  const pwdConfirm = String(req.body.confirmPassword || '');
  const role = String(req.body.role || '');
  if (!name || !phone || !pwd || !role) throw new Error('请填写姓名、手机号、密码和岗位');
  if (pwd !== pwdConfirm) throw new Error('两次输入的密码不一致');
  if (!/^1\d{10}$/.test(phone)) throw new Error('请输入正确的 11 位手机号');
  if (!STAFF_ROLES.includes(role)) throw new Error('岗位不合法');
  if (await one('SELECT id FROM person WHERE phone=$1', [phone])) throw new Error('手机号已存在');
  // 工号由系统自动生成，注册页不再要求填写
  const no = 'XY' + String(Date.now()).slice(-6);
  const p = await query(`INSERT INTO person (id,name,phone,role,staff_no,password_hash,account_status,gender)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [await nextId('person'), name, phone, role, no, hash(pwd), '待审批', '其他']);
  await query('INSERT INTO staff_role (person_id,role) VALUES ($1,$2)', [p[0].id, role]);
  const sms = await sendSms(phone, '员工注册', p[0].id,
    `【信义口腔】${name}，您的员工账号注册已提交（工号 ${no}，岗位 ${role}），待分院负责人或院长审批开通后可凭手机号登录。`);
  return {
    id: p[0].id, staffNo: no, phone, status: '待审批', sms,
    message: `注册已提交，通知短信已发送至 ${phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}，请等待分院负责人或院长审批`,
  };
}));

// 给员工列表补上角色串与审批意见（避免数据库标量子查询，兼容 pg-mem）
async function withRoles(rows: any[]) {
  const all = await query('SELECT person_id,role FROM staff_role');
  const approvals = await approvalSummaries('员工注册');
  return rows.map((p) => ({
    ...p,
    roles: all.filter((r: any) => r.person_id === p.id).map((r: any) => r.role).join('/'),
    approvals: approvals.get(p.id) || [],
  }));
}

// 待审批账号列表（负责人 / 院长）
authRouter.get('/staff/pending', wrap(async (req) => {
  await requireApprover(req);
  return withRoles(await query(
    `SELECT id,name,phone,staff_no,role,account_status,created_at
     FROM person WHERE role<>'患者' AND account_status='待审批' ORDER BY id DESC`));
}));

// 审批：负责人 / 院长任一通过即开通；两方均不通过才最终停用
authRouter.post('/staff/approve', wrap(async (req) => {
  const me = await requireApprover(req);
  const id = Number(req.body.id);
  const target = await one("SELECT id,account_status FROM person WHERE id=$1 AND role<>'患者'", [id]);
  if (!target) throw new Error('待审批的员工账号不存在');
  const requested = String(req.body.status || '已开通');
  if (!['已开通', '已停用'].includes(requested)) throw new Error('状态不合法');
  const decision = requested === '已开通' ? '通过' : '不通过';
  await recordApproval('员工注册', id, me, decision, String(req.body.opinion || ''));
  const status = await resolveByApprovals('员工注册', id, '已开通', '已停用', '待审批');
  await query('UPDATE person SET account_status=$1 WHERE id=$2', [status, id]);
  // 账号状态确定后短信告知本人（开通/拒绝）
  if (status === '已开通' || status === '已停用') {
    const person = await one('SELECT name,phone FROM person WHERE id=$1', [id]);
    if (person) {
      const result = status === '已开通' ? '已审批通过，账号已开通，可凭手机号和密码登录' : '审批未通过，账号未开通';
      await sendSms(person.phone, '注册审批结果', id, `【信义口腔】${person.name}，您的员工账号注册${result}。`);
    }
  }
  const approvals = (await approvalSummaries('员工注册')).get(id) || [];
  return {
    id, status, approvals,
    message: status === '已开通' ? '审批通过，账号已开通'
      : status === '已停用' ? '负责人与院长均不通过，账号已拒绝'
        : '已登记审批意见；仍可由另一方审批，任一方通过即开通',
  };
}));

// 员工列表（负责人 / 院长查看账号）
authRouter.get('/staff/list', wrap(async (req) => {
  await requireApprover(req);
  return withRoles(await query(
    `SELECT id,name,phone,staff_no,role,account_status
     FROM person WHERE role<>'患者' ORDER BY id`));
}));

const nextId = async (table: string) => Number((await query(`SELECT COALESCE(MAX(id),0)+1 AS id FROM ${table}`))[0].id);
