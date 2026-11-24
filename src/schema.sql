-- 信义口腔连锁管理系统 - 34 张表（26 张业务表 + 8 张登录/角色/借调/审批/短信/退款支撑表）
-- 映射规则：类→表，属性→列；泛化→超类主键作子类主键；关联→外键放非 1 方；
-- 组合→外键放非 1 方且不为空；多对多→关联表。

CREATE TABLE IF NOT EXISTS store (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  address TEXT,
  open_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS person (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  gender TEXT CHECK (gender IN ('男', '女', '其他')),
  birth_date DATE,
  phone TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('患者', '牙医', '护士', '前台', '库管员', '负责人', '院长', '洁牙师')),
  staff_no TEXT UNIQUE,
  password_hash TEXT,
  account_status TEXT NOT NULL DEFAULT '已开通' CHECK (account_status IN ('待审批', '已开通', '已停用')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patient (
  person_id INTEGER PRIMARY KEY REFERENCES person(id),
  allergy TEXT,
  allergy_by INTEGER REFERENCES person(id),
  medical_history TEXT,
  member_level TEXT DEFAULT '普通'
);

CREATE TABLE IF NOT EXISTS dentist (
  person_id INTEGER PRIMARY KEY REFERENCES person(id),
  title TEXT,
  specialty TEXT,
  store_id INTEGER REFERENCES store(id),
  commission_rate NUMERIC(5,2) DEFAULT 0.10
);

CREATE TABLE IF NOT EXISTS nurse (
  person_id INTEGER PRIMARY KEY REFERENCES person(id),
  job_title TEXT,
  license_no TEXT
);

CREATE TABLE IF NOT EXISTS chair (
  id SERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES store(id),
  code TEXT NOT NULL UNIQUE,
  type TEXT,
  kind TEXT NOT NULL DEFAULT '诊疗' CHECK (kind IN ('诊疗', '洁牙')),
  status TEXT NOT NULL DEFAULT '空闲' CHECK (status IN ('空闲', '占用', '维护'))
);

CREATE TABLE IF NOT EXISTS treatment_item (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  price NUMERIC(12,2) NOT NULL,
  category TEXT
);

CREATE TABLE IF NOT EXISTS dentist_schedule (
  id SERIAL PRIMARY KEY,
  dentist_id INTEGER NOT NULL REFERENCES dentist(person_id),
  store_id INTEGER NOT NULL REFERENCES store(id),
  chair_id INTEGER NOT NULL REFERENCES chair(id),
  work_date DATE NOT NULL,
  slot TEXT NOT NULL,
  quota INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked >= 0 AND locked <= quota),
  UNIQUE (dentist_id, work_date, slot),
  UNIQUE (chair_id, work_date, slot),
  transfer_id INTEGER
);

CREATE TABLE IF NOT EXISTS appointment (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patient(person_id),
  dentist_id INTEGER NOT NULL REFERENCES dentist(person_id),
  schedule_id INTEGER NOT NULL REFERENCES dentist_schedule(id),
  chair_id INTEGER REFERENCES chair(id),
  store_id INTEGER NOT NULL REFERENCES store(id),
  appt_date DATE NOT NULL,
  slot TEXT NOT NULL,
  channel TEXT DEFAULT '小程序',
  status TEXT NOT NULL DEFAULT '待就诊' CHECK (status IN ('待就诊', '已到院', '已完成', '已取消', '已爽约')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS visit_record (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER REFERENCES appointment(id),
  patient_id INTEGER NOT NULL REFERENCES patient(person_id),
  dentist_id INTEGER REFERENCES dentist(person_id),
  store_id INTEGER NOT NULL REFERENCES store(id),
  chair_id INTEGER REFERENCES chair(id),
  queue_no INTEGER,
  complaint TEXT,
  exam TEXT,
  diagnosis TEXT,
  advice TEXT,
  allergy_alert TEXT,
  recall_interval_days INTEGER DEFAULT 90,
  status TEXT NOT NULL DEFAULT '待接诊' CHECK (status IN ('待接诊', '接诊中', '待结算', '已完成')),
  arrived_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS package (
  id SERIAL PRIMARY KEY,
  tier TEXT NOT NULL CHECK (tier IN ('低', '中', '高')),
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL,
  valid_months INTEGER NOT NULL,
  total_times INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT '在售' CHECK (status IN ('在售', '停售'))
);

CREATE TABLE IF NOT EXISTS package_item (
  id SERIAL PRIMARY KEY,
  package_id INTEGER NOT NULL REFERENCES package(id),
  item_id INTEGER NOT NULL REFERENCES treatment_item(id),
  times INTEGER NOT NULL,
  UNIQUE (package_id, item_id)
);

CREATE TABLE IF NOT EXISTS package_card (
  id SERIAL PRIMARY KEY,
  package_id INTEGER NOT NULL REFERENCES package(id),
  patient_id INTEGER NOT NULL REFERENCES patient(person_id),
  store_id INTEGER NOT NULL REFERENCES store(id),
  card_no TEXT NOT NULL UNIQUE,
  sold_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expire_date DATE NOT NULL,
  total_times INTEGER NOT NULL,
  remain_times INTEGER NOT NULL CHECK (remain_times >= 0 AND remain_times <= total_times),
  status TEXT NOT NULL DEFAULT '有效' CHECK (status IN ('有效', '已用完', '已过期')),
  sold_by INTEGER REFERENCES person(id)
);

CREATE TABLE IF NOT EXISTS prescription (
  id SERIAL PRIMARY KEY,
  visit_record_id INTEGER NOT NULL REFERENCES visit_record(id),
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prescription_item (
  id SERIAL PRIMARY KEY,
  prescription_id INTEGER NOT NULL REFERENCES prescription(id),
  item_id INTEGER NOT NULL REFERENCES treatment_item(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  usage TEXT,
  amount NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS bill (
  id SERIAL PRIMARY KEY,
  visit_record_id INTEGER NOT NULL REFERENCES visit_record(id),
  patient_id INTEGER NOT NULL REFERENCES patient(person_id),
  store_id INTEGER NOT NULL REFERENCES store(id),
  package_card_id INTEGER REFERENCES package_card(id),
  amount NUMERIC(12,2) NOT NULL,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payable NUMERIC(12,2) NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('现金', '微信', '支付宝', '套餐抵扣')),
  paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS followup_reminder (
  id SERIAL PRIMARY KEY,
  visit_record_id INTEGER NOT NULL REFERENCES visit_record(id),
  patient_id INTEGER NOT NULL REFERENCES patient(person_id),
  store_id INTEGER NOT NULL REFERENCES store(id),
  due_date DATE NOT NULL,
  send_status TEXT NOT NULL DEFAULT '待发送' CHECK (send_status IN ('待发送', '已发送', '失败')),
  callback_result TEXT,
  callback_by INTEGER REFERENCES person(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS material (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  spec TEXT,
  unit TEXT,
  safety_stock INTEGER NOT NULL DEFAULT 0,
  current_stock INTEGER NOT NULL DEFAULT 0,
  store_id INTEGER NOT NULL REFERENCES store(id)
);

CREATE TABLE IF NOT EXISTS stock_movement (
  id SERIAL PRIMARY KEY,
  material_id INTEGER NOT NULL REFERENCES material(id),
  store_id INTEGER NOT NULL REFERENCES store(id),
  move_type TEXT NOT NULL CHECK (move_type IN ('入库', '领用', '盘点')),
  quantity INTEGER NOT NULL,
  batch_no TEXT,
  expire_date DATE,
  operator_id INTEGER REFERENCES person(id),
  patient_id INTEGER REFERENCES patient(person_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_order (
  id SERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES store(id),
  order_date DATE NOT NULL,
  supplier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '待审批' CHECK (status IN ('待审批', '已审批', '已收货', '已取消')),
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  approved_by INTEGER REFERENCES person(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_order_item (
  id SERIAL PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_order(id),
  material_id INTEGER NOT NULL REFERENCES material(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS treatment_plan (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patient(person_id),
  dentist_id INTEGER NOT NULL REFERENCES dentist(person_id),
  store_id INTEGER NOT NULL REFERENCES store(id),
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  periods INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT '进行中' CHECK (status IN ('草稿', '进行中', '已完成', '已终止')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS treatment_plan_item (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES treatment_plan(id),
  period INTEGER NOT NULL,
  item_id INTEGER NOT NULL REFERENCES treatment_item(id),
  plan_date DATE,
  estimate NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT '待执行' CHECK (status IN ('待执行', '已完成', '已取消')),
  UNIQUE (plan_id, period)
);

CREATE TABLE IF NOT EXISTS item_cost (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES treatment_item(id),
  material_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  labor_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  allocation NUMERIC(12,2) NOT NULL DEFAULT 0,
  effective_date DATE NOT NULL,
  UNIQUE (item_id, effective_date)
);

CREATE TABLE IF NOT EXISTS expense (
  id SERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES store(id),
  month TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('房租', '水电', '耗材采购', '其他')),
  amount NUMERIC(12,2) NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS doctor_performance (
  id SERIAL PRIMARY KEY,
  dentist_id INTEGER NOT NULL REFERENCES dentist(person_id),
  store_id INTEGER NOT NULL REFERENCES store(id),
  month TEXT NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0,
  income NUMERIC(12,2) NOT NULL DEFAULT 0,
  card_sales INTEGER NOT NULL DEFAULT 0,
  performance NUMERIC(12,2) NOT NULL DEFAULT 0,
  UNIQUE (dentist_id, store_id, month)
);

-- ===== 登录 / 角色 / 借调支撑表 =====
-- 一人多角色：院长可同时是医生（同一账号切换身份）
CREATE TABLE IF NOT EXISTS staff_role (
  person_id INTEGER NOT NULL REFERENCES person(id),
  role TEXT NOT NULL CHECK (role IN ('牙医', '前台', '库管员', '负责人', '院长', '护士')),
  PRIMARY KEY (person_id, role)
);

-- 患者登录会话：手机号 + 模拟验证码
CREATE TABLE IF NOT EXISTS patient_session (
  token TEXT PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES person(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 员工登录会话：记住当前激活身份，支持一人多角色切换
CREATE TABLE IF NOT EXISTS staff_session (
  token TEXT PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES person(id),
  active_role TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 临时借调单：原门店 -> 目标门店，含起止日期与审批
CREATE TABLE IF NOT EXISTS doctor_transfer (
  id SERIAL PRIMARY KEY,
  dentist_id INTEGER NOT NULL REFERENCES dentist(person_id),
  from_store_id INTEGER NOT NULL REFERENCES store(id),
  to_store_id INTEGER NOT NULL REFERENCES store(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT '待审批' CHECK (status IN ('待审批', '已批准', '已驳回', '已结束')),
  applicant_id INTEGER REFERENCES person(id),
  approved_by INTEGER REFERENCES person(id),
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 门店负责人：总院由院长管理，其他分院可有独立负责人（看财务、管员工）
CREATE TABLE IF NOT EXISTS store_manager (
  store_id INTEGER PRIMARY KEY REFERENCES store(id),
  person_id INTEGER NOT NULL REFERENCES person(id),
  title TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 审批留痕：负责人 / 院长任一通过即生效；两方均不通过才视为最终不通过
CREATE TABLE IF NOT EXISTS approval_record (
  id SERIAL PRIMARY KEY,
  biz_type TEXT NOT NULL CHECK (biz_type IN ('员工注册', '医生借调', '退款审批')),
  biz_id INTEGER NOT NULL,
  approver_id INTEGER NOT NULL REFERENCES person(id),
  approver_name TEXT,
  approver_role TEXT NOT NULL CHECK (approver_role IN ('负责人', '院长')),
  decision TEXT NOT NULL CHECK (decision IN ('通过', '不通过')),
  opinion TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 短信通知：注册/审批等事件向手机号发送模拟短信并留痕（真实项目接短信网关）
CREATE TABLE IF NOT EXISTS sms_message (
  id SERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  biz_type TEXT NOT NULL,
  biz_id INTEGER,
  content TEXT NOT NULL,
  send_status TEXT NOT NULL DEFAULT '已发送' CHECK (send_status IN ('已发送', '失败')),
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 退款申请：以原收费单为额度上限，需负责人/院长审批；幂等键防重复提交
CREATE TABLE IF NOT EXISTS refund_request (
  id SERIAL PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES bill(id),
  amount NUMERIC(12,2) NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT '待审批' CHECK (status IN ('待审批', '已退款', '已驳回')),
  applicant_id INTEGER REFERENCES person(id),
  approved_by INTEGER REFERENCES person(id),
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===== 会员 / 优惠券 / 洁牙专门挂号 支撑表 =====
-- 说明：患者首次登录即成为会员（patient.member_level 由'普通'升为'会员'），并自动发放新客券。
-- 洁牙与牙痛看医生分开：洁牙走独立的洁牙师排班与洁牙椅位号源，不占用牙医号源。

-- 洁牙师：person 中 role='洁牙师' 的人员，专门执行洗牙/洁牙
CREATE TABLE IF NOT EXISTS hygienist (
  person_id INTEGER PRIMARY KEY REFERENCES person(id),
  store_id INTEGER REFERENCES store(id),
  title TEXT,
  commission_rate NUMERIC(5,2) DEFAULT 0.08
);

-- 洁牙号源：洁牙师 + 洁牙椅位 + 日期 + 时段；与 dentist_schedule 完全分开
CREATE TABLE IF NOT EXISTS hygiene_schedule (
  id SERIAL PRIMARY KEY,
  hygienist_id INTEGER NOT NULL REFERENCES hygienist(person_id),
  store_id INTEGER NOT NULL REFERENCES store(id),
  chair_id INTEGER NOT NULL REFERENCES chair(id),
  work_date DATE NOT NULL,
  slot TEXT NOT NULL,
  quota INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked >= 0 AND locked <= quota),
  UNIQUE (hygienist_id, work_date, slot),
  UNIQUE (chair_id, work_date, slot)
);

-- 优惠券模板：绑定具体诊疗项目的会员优惠价（如超声波洁牙会员价 68 元，原价 98）
CREATE TABLE IF NOT EXISTS coupon_template (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES treatment_item(id),
  discount_price NUMERIC(12,2) NOT NULL,
  valid_days INTEGER NOT NULL DEFAULT 90,
  biz_type TEXT NOT NULL DEFAULT '新客注册',
  status TEXT NOT NULL DEFAULT '启用' CHECK (status IN ('启用', '停用'))
);

-- 优惠券实例：发给具体会员，一次性使用
CREATE TABLE IF NOT EXISTS coupon (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES coupon_template(id),
  patient_id INTEGER NOT NULL REFERENCES patient(person_id),
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT '未使用' CHECK (status IN ('未使用', '已使用', '已过期')),
  issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expire_date DATE NOT NULL,
  used_at TIMESTAMP,
  used_biz TEXT
);

-- 洁牙预约：可用优惠券享会员价，或用套餐卡扣次
CREATE TABLE IF NOT EXISTS hygiene_appointment (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patient(person_id),
  hygienist_id INTEGER NOT NULL REFERENCES hygienist(person_id),
  schedule_id INTEGER NOT NULL REFERENCES hygiene_schedule(id),
  chair_id INTEGER REFERENCES chair(id),
  store_id INTEGER NOT NULL REFERENCES store(id),
  item_id INTEGER NOT NULL REFERENCES treatment_item(id),
  appt_date DATE NOT NULL,
  slot TEXT NOT NULL,
  coupon_id INTEGER REFERENCES coupon(id),
  package_card_id INTEGER REFERENCES package_card(id),
  pay_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment TEXT NOT NULL DEFAULT '到店支付' CHECK (payment IN ('优惠券', '套餐抵扣', '到店支付')),
  channel TEXT DEFAULT '患者端',
  status TEXT NOT NULL DEFAULT '待就诊' CHECK (status IN ('待就诊', '已完成', '已取消')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 套餐购买订单：患者端模拟支付购买洁牙次数套餐，可用券抵扣，支付后生成套餐卡
CREATE TABLE IF NOT EXISTS package_order (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patient(person_id),
  package_id INTEGER NOT NULL REFERENCES package(id),
  store_id INTEGER NOT NULL REFERENCES store(id),
  coupon_id INTEGER REFERENCES coupon(id),
  list_price NUMERIC(12,2) NOT NULL,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  pay_amount NUMERIC(12,2) NOT NULL,
  package_card_id INTEGER REFERENCES package_card(id),
  status TEXT NOT NULL DEFAULT '已支付' CHECK (status IN ('已支付', '已取消')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
