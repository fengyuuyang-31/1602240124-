// 数据库模块：查看 40 张表的元数据、字段与样例数据（仅工作人员登录后可见）
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, isMemoryMode } from '../db.js';
import { wrap } from '../http.js';
import { requireStaff } from '../guards.js';

export const dbRouter = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 表结构说明（对应 D1 类图映射）
const TABLE_META: Record<string, { cn: string; group: string; note: string }> = {
  store: { cn: '门店', group: '组织与人员', note: '连锁门店主数据' },
  person: { cn: '人员（泛化父类）', group: '组织与人员', note: '泛化：患者/牙医/护士/前台/院长共用身份' },
  patient: { cn: '患者', group: '组织与人员', note: 'person 子类，主键即外键' },
  dentist: { cn: '牙医', group: '组织与人员', note: 'person 子类，含提成比例' },
  nurse: { cn: '护士', group: '组织与人员', note: 'person 子类' },
  chair: { cn: '椅位', group: '组织与人员', note: '门店诊疗椅，号源占用单元' },
  treatment_item: { cn: '诊疗项目', group: '诊疗业务', note: '收费价目字典（64 项，2026 年市场参考价，含正畸/种植分档，模拟数据）' },
  dentist_schedule: { cn: '牙医排班', group: '诊疗业务', note: '号源=quota-locked，牙医+时段唯一；跨诊所不可冲突' },
  appointment: { cn: '预约', group: '诊疗业务', note: '患者小程序预约，含渠道与状态' },
  visit_record: { cn: '就诊记录', group: '诊疗业务', note: '签到/候诊/病历，复诊间隔' },
  prescription: { cn: '处方', group: '诊疗业务', note: '牙医开具，金额由明细汇总' },
  prescription_item: { cn: '处方明细', group: '诊疗业务', note: '项目×数量×单价' },
  treatment_plan: { cn: '治疗计划', group: '诊疗业务', note: '长疗程分次治疗（正畸/种植等）' },
  treatment_plan_item: { cn: '治疗计划项', group: '诊疗业务', note: '期次+项目+预计金额' },
  package: { cn: '洗牙套餐目录', group: '套餐与收费', note: '低/中/高三档，同档仅一个在售' },
  package_item: { cn: '套餐项目', group: '套餐与收费', note: '套餐与诊疗项目多对多' },
  package_card: { cn: '套餐卡', group: '套餐与收费', note: '售卡快照：有效期/次数不受目录调价影响' },
  bill: { cn: '收费单', group: '套餐与收费', note: '收费、折扣、收款方式' },
  followup_reminder: { cn: '复诊提醒', group: '套餐与收费', note: '到期自动生成，前台回访' },
  item_cost: { cn: '项目成本', group: '财务与绩效', note: '材料成本+人工成本+分摊，核算毛利' },
  expense: { cn: '期间费用', group: '财务与绩效', note: '房租/水电/耗材采购/其他' },
  doctor_performance: { cn: '医生绩效', group: '财务与绩效', note: '按牙医+门店+月，含绩效金额' },
  material: { cn: '医疗产品/耗材', group: '库存采购', note: '安全库存预警' },
  stock_movement: { cn: '库存流水', group: '库存采购', note: '入库/领用/盘点留痕' },
  purchase_order: { cn: '采购单', group: '库存采购', note: '负责人/院长审批流程' },
  purchase_order_item: { cn: '采购单明细', group: '库存采购', note: '耗材×数量×单价' },
  staff_role: { cn: '员工角色', group: '账号与权限', note: '一人多角色：院长可兼牙医，登录后可切换身份' },
  patient_session: { cn: '患者登录会话', group: '账号与权限', note: '手机号+模拟验证码登录凭据' },
  staff_session: { cn: '员工登录会话', group: '账号与权限', note: '记住当前激活身份，支持角色切换' },
  doctor_transfer: { cn: '医生借调单', group: '账号与权限', note: '临时跨门店支援，含起止日期与审批' },
  store_manager: { cn: '门店负责人', group: '账号与权限', note: '总院由院长管理，其他分院可设置负责人' },
  approval_record: { cn: '审批记录', group: '账号与权限', note: '负责人/院长审批留痕；任一方通过即生效' },
  sms_message: { cn: '短信通知', group: '账号与权限', note: '注册/审批向手机号发送的模拟短信留痕' },
  refund_request: { cn: '退款申请', group: '套餐与收费', note: '以原收费单为上限，审批通过后冲减收入，幂等键防重复' },
  hygienist: { cn: '洁牙师', group: '会员与洁牙', note: 'person 子类，独立执行洗牙；与牙医号源分开' },
  hygiene_schedule: { cn: '洁牙号源', group: '会员与洁牙', note: '洁牙师＋洁牙椅＋日期＋时段，quota-locked 为余号；与 dentist_schedule 完全分开' },
  coupon_template: { cn: '优惠券模板', group: '会员与洁牙', note: '指定项目优惠价（如超声波洁牙会员价），新客注册按模板发券' },
  coupon: { cn: '优惠券', group: '会员与洁牙', note: '发给会员的一次性券，预约时可核销享会员价' },
  hygiene_appointment: { cn: '洁牙预约', group: '会员与洁牙', note: '专门挂号，与牙痛就诊分开；占号、用券/套餐卡扣次/到店支付三选一' },
  package_order: { cn: '套餐购买单', group: '会员与洁牙', note: '模拟支付购买洁牙套餐，生成套餐卡；用券抵扣差价' },
};

// 列出全部表 + 结构说明
dbRouter.get('/tables', wrap(async (req) => {
  await requireStaff(req);
  const raw = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const clean = raw.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  const ddl = clean.split(';').map((s) => s.trim()).filter((s) => s.startsWith('CREATE TABLE'));
  return ddl.map((statement) => {
    const name = statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1] || '';
    const meta = TABLE_META[name] || { cn: name, group: '其他', note: '' };
    const columns = [...statement.matchAll(/^\s{2}(\w+)\s+([\w()]+(?:\(\d+(?:,\d+)?\))?)[^,]*$/gm)]
      .map((m) => ({ name: m[1], type: m[2] }));
    return { name, ...meta, columns, ddl: statement + ';' };
  });
}));

// 查看某张表的样例数据
dbRouter.get('/data/:name', wrap(async (req) => {
  await requireStaff(req);
  const name = String(req.params.name);
  if (!/^[a-z_]+$/.test(name) || !TABLE_META[name]) throw new Error('未知数据表');
  const rows = await query(`SELECT * FROM ${name} ORDER BY 1 DESC LIMIT 100`);
  const total = (await query(`SELECT COUNT(*)::int AS n FROM ${name}`))[0].n;
  return { name, cn: TABLE_META[name].cn, total, rows };
}));

// 数据库模式信息
dbRouter.get('/info', wrap(async (req) => {
  await requireStaff(req);
  return {
    engine: isMemoryMode ? 'pg-mem（本地内存库，PG 兼容）' : 'PostgreSQL',
    tableCount: Object.keys(TABLE_META).length,
    groups: [...new Set(Object.values(TABLE_META).map((m) => m.group))],
  };
}));
