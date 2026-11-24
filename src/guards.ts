// 统一服务端鉴权：所有业务接口以 token 为准，不信任前端传来的 phone/dentistId/角色。
// 患者端：x-patient-token -> 当前患者手机号；员工端：x-session-token -> 当前员工身份与角色。
import { query, one } from './db.js';

export type Staff = {
  personId: number;
  name: string;
  activeRole: string;
  roles: string[];
  accountStatus: string;
};

// 患者身份：返回 person 行；未登录/失效直接抛错
export async function requirePatient(req: any) {
  const token = String(req.headers['x-patient-token'] || '');
  if (!token) throw new Error('请先登录患者账号');
  const rows = await query(`SELECT p.id AS person_id, p.name, p.phone
    FROM patient_session s JOIN person p ON p.id = s.person_id WHERE s.token=$1`, [token]);
  if (!rows.length) throw new Error('患者登录已失效，请重新登录');
  return rows[0] as { person_id: number; name: string; phone: string };
}

// 员工身份：返回当前激活角色与所拥有的全部角色；停用账号一律拒绝
export async function requireStaff(req: any): Promise<Staff> {
  const token = String(req.headers['x-session-token'] || '');
  if (!token) throw new Error('请先登录工作人员账号');
  const rows = await query(`SELECT s.person_id, s.active_role, p.name, p.account_status
    FROM staff_session s JOIN person p ON p.id=s.person_id WHERE s.token=$1`, [token]);
  if (!rows.length) throw new Error('登录已失效，请重新登录');
  const me = rows[0];
  if (me.account_status !== '已开通') throw new Error('账号未开通或已停用');
  const roles = (await query('SELECT role FROM staff_role WHERE person_id=$1', [me.person_id])).map((r: any) => r.role);
  return {
    personId: me.person_id, name: me.name, activeRole: me.active_role,
    roles, accountStatus: me.account_status,
  };
}

// 角色守卫：当前激活角色必须在允许列表内
export async function requireRole(req: any, allowed: string[]): Promise<Staff> {
  const me = await requireStaff(req);
  if (!allowed.includes(me.activeRole)) {
    throw new Error(`当前身份「${me.activeRole}」无权执行此操作（需要：${allowed.join(' / ')}）`);
  }
  return me;
}

// 牙医身份：返回当前登录人对应的 dentist 行；无牙医档案则拒绝
export async function requireDentist(req: any) {
  const me = await requireRole(req, ['牙医', '院长']);
  const d = await one('SELECT * FROM dentist WHERE person_id=$1', [me.personId]);
  if (!d) throw new Error('当前账号没有牙医档案');
  return { me, dentistId: d.person_id as number, storeId: d.store_id as number };
}

// 从 token 解析患者手机号，忽略前端传入的 phone（防止越权查他人）
export async function phoneOf(req: any): Promise<string> {
  return (await requirePatient(req)).phone;
}
