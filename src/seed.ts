// 全部为模拟数据，不含真实患者或个人信息
import crypto from 'node:crypto';
type Q = (text: string, params?: any[]) => Promise<any[]>;

const hash = (pwd: string) => crypto.createHash('sha256').update(pwd).digest('hex');
const PWD = hash('123456'); // 演示统一密码
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return iso(d); };
const month = () => new Date().toISOString().slice(0, 7);

export async function seed(q: Q) {
  const stores = [
    [1, '白云总院', '贵阳市白云区云峰大道 1 号', '2018-03-01'],
    [2, '观山湖门诊', '贵阳市观山湖区金阳南路 18 号', '2020-06-15'],
    [3, '世纪城门诊', '贵阳市观山湖区世纪城路 66 号', '2021-09-01'],
    [4, '思南门诊', '铜仁市思南县Forward路 8 号', '2022-05-20'],
  ];
  for (const s of stores) await q('INSERT INTO store (id,name,address,open_date) VALUES ($1,$2,$3,$4)', s);

  const staff: any[] = [
    [1, '王建国', '男', '1975-04-12', '13900000001', '院长', 'XY001'],
    [2, '李晓', '女', '1990-08-23', '13900000002', '前台', 'XY002'],
    [3, '赵敏', '女', '1985-11-05', '13900000003', '库管员', 'XY003'],
    [4, '陈静', '女', '1992-02-18', '13900000004', '护士', 'XY004'],
    [5, '林岚', '女', '1984-03-09', '13900000005', '负责人', 'XY005'],
    [6, '何倩', '女', '1986-06-12', '13900000006', '负责人', 'XY006'],
    [7, '孙洁', '女', '1987-09-14', '13900000007', '负责人', 'XY007'],
    [10, '张伟', '男', '1980-01-10', '13900000010', '牙医', 'XY010'],
    [11, '刘芳', '女', '1983-05-16', '13900000011', '牙医', 'XY011'],
    [12, '陈勇', '男', '1978-09-28', '13900000012', '牙医', 'XY012'],
    [13, '周琳', '女', '1988-12-02', '13900000013', '牙医', 'XY013'],
    [14, '吴强', '男', '1991-07-21', '13900000014', '牙医', 'XY014'],
    // 洁牙师：专门执行洗牙/洁牙，走独立号源，不与牙医号源混用
    [20, '何洁', '女', '1993-03-11', '13900000020', '洁牙师', 'XY020'],
    [21, '田甜', '女', '1995-06-22', '13900000021', '洁牙师', 'XY021'],
  ];
  for (const p of staff) await q('INSERT INTO person (id,name,gender,birth_date,phone,role,staff_no,password_hash,account_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [...p, PWD, '已开通']);

  // 一人多角色：王建国 = 院长 + 牙医（可切换）；牙医同时保留牙医角色
  const staffRoles: [number, string][] = [
    [1, '院长'], [1, '牙医'], [2, '前台'], [3, '库管员'], [4, '护士'],
    [5, '负责人'], [6, '负责人'], [7, '负责人'],
    [10, '牙医'], [11, '牙医'], [12, '牙医'], [13, '牙医'], [14, '牙医'],
  ];
  for (const [pid, role] of staffRoles) await q('INSERT INTO staff_role (person_id,role) VALUES ($1,$2)', [pid, role]);

  // 总院由院长负责；其他分院分别设置负责人
  const managers: [number, number, string][] = [
    [1, 1, '院长（总院）'], [2, 5, '观山湖门诊负责人'], [3, 6, '世纪城门诊负责人'], [4, 7, '思南门诊负责人'],
  ];
  for (const m of managers) await q('INSERT INTO store_manager (store_id,person_id,title) VALUES ($1,$2,$3)', m);

  const dentists = [
    [1, '主任医师', '口腔综合', 1, 0.10], // 院长兼出诊
    [10, '主任医师', '种植', 1, 0.12], [11, '副主任医师', '正畸', 1, 0.10],
    [12, '主治医师', '修复', 2, 0.10], [13, '主治医师', '洁牙', 2, 0.08],
    [14, '医师', '儿童口腔', 3, 0.08],
  ];
  for (const d of dentists) await q('INSERT INTO dentist (person_id,title,specialty,store_id,commission_rate) VALUES ($1,$2,$3,$4,$5)', d);
  await q('INSERT INTO nurse (person_id,job_title,license_no) VALUES ($1,$2,$3)', [4, '护士', 'MOCK-N001']);
  // 洁牙师归属门店
  for (const [pid, storeId, title] of [[20, 1, '洁牙师'], [21, 2, '洁牙师']]) {
    await q('INSERT INTO hygienist (person_id,store_id,title,commission_rate) VALUES ($1,$2,$3,$4)', [pid, storeId, title, 0.08]);
  }

  // 具名演示患者：101 李梅（登录页演示账号之一）；其余保持模拟编号，均为模拟数据
  const demoNames: Record<number, string> = { 101: '李梅' };
  for (let i = 0; i < 24; i++) {
    const id = 100 + i;
    const name = demoNames[id] || `模拟患者${String(i + 1).padStart(2, '0')}`;
    await q('INSERT INTO person (id,name,gender,birth_date,phone,role) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, name, i % 2 ? '女' : '男', id === 101 ? '1990-04-12' : '1990-01-01', `1380001${String(i).padStart(4, '0')}`, '患者']);
    await q('INSERT INTO patient (person_id,allergy,allergy_by,medical_history,member_level) VALUES ($1,$2,$3,$4,$5)',
      [id, i % 5 === 0 ? '青霉素过敏' : '无', 2, i % 7 === 0 ? '高血压' : '无', i % 3 === 0 ? '会员' : '普通']);
  }

  const chairs = [
    [1, 1, 'A01'], [2, 1, 'A02'], [9, 1, 'A03'], [3, 2, 'B01'], [4, 2, 'B02'],
    [5, 3, 'C01'], [6, 3, 'C02'], [7, 4, 'D01'], [8, 4, 'D02'],
  ];
  for (const c of chairs) await q('INSERT INTO chair (id,store_id,code,type,kind,status) VALUES ($1,$2,$3,$4,$5,$6)', [...c, '综合治疗椅', '诊疗', '空闲']);
  // 洁牙专用椅位：与诊疗椅位分开，避免牙医号源与洁牙号源抢同一把椅子
  const hygieneChairs = [[30, 1, 'H01'], [31, 1, 'H02'], [32, 2, 'H03'], [33, 3, 'H04']];
  for (const c of hygieneChairs) await q('INSERT INTO chair (id,store_id,code,type,kind,status) VALUES ($1,$2,$3,$4,$5,$6)', [...c, '洁牙椅', '洁牙', '空闲']);

  // 诊疗项目价目：按 2026 年公开参考区间取常见值（模拟数据，实际随地区/政策波动）。
  // id 1-10 保持原义，避免套餐卡（引用 2/3/4）和历史处方（引用 2..7）失效；11 起为按参考区间新增的项目。
  const items: any[] = [
    // 基础检查与预防
    [1, '挂号费', 30, '基础'], [2, '超声波洁牙', 98, '洁牙'], [3, '喷砂洁牙', 198, '洁牙'],
    [4, '舒适洁牙（超声+喷砂）', 398, '洁牙'], [10, '口腔检查', 50, '基础'],
    [11, '儿童涂氟', 69, '预防'], [12, '儿童窝沟封闭', 88, '预防'],
    [13, '全景片拍摄', 120, '检查'], [14, 'CBCT 拍摄', 380, '检查'],
    // 补牙 / 根管 / 拔牙
    [5, '补牙（国产树脂）', 260, '修复'], [15, '补牙（进口树脂）', 320, '修复'],
    [16, '补牙（高档美学树脂）', 600, '修复'],
    [6, '根管治疗（前磨牙）', 1000, '治疗'], [17, '前牙根管治疗', 650, '治疗'], [18, '磨牙根管治疗', 1600, '治疗'],
    [9, '普通拔牙', 180, '外科'], [19, '复杂阻生智齿拔除', 1200, '外科'], [20, '微创拔牙', 650, '外科'],
    // 修复类
    [21, '全瓷牙冠（国产）', 1800, '修复'], [22, '全瓷牙冠（进口氧化锆）', 3500, '修复'],
    [23, '瓷贴面', 2800, '修复'],
    // 种植（单颗分档 + 半口/全口）
    [7, '种植一期', 3980, '种植'], [24, '种植牙（经济型·国产创英）', 3500, '种植'],
    [25, '种植牙（性价比型·韩系登腾）', 4800, '种植'], [26, '种植牙（高端型·瑞士ITI）', 12000, '种植'],
    [27, '半口种植', 18000, '种植'], [28, '全口种植', 38000, '种植'],
    // 正畸（儿童 / 成人 × 矫治器类型分层，参考信义口腔公开价目；同一"矫正"不同方案收费不同）
    [8, '正畸复诊', 500, '正畸'], [29, '传统金属托槽矫正', 9800, '正畸'],
    [30, '金属自锁托槽矫正', 12800, '正畸'], [31, '陶瓷半隐形矫正', 18000, '正畸'],
    [32, '国产隐形矫正（时代天使）', 24000, '正畸'], [33, '进口隐形矫正（隐适美）', 36000, '正畸'],
    [34, '舌侧矫正', 42000, '正畸'], [35, '儿童早期干预矫正', 12000, '正畸'],
    [36, '青少年固定矫正', 9800, '正畸'], [37, '儿童隐形矫正', 22000, '正畸'],
    // 儿童正畸细分（信义口腔公开价）
    [38, '儿童普通托槽矫正', 7000, '正畸'], [39, '儿童国产自锁矫正', 8800, '正畸'],
    [40, '儿童进口自锁矫正', 11800, '正畸'],
    // 成人正畸细分
    [41, '成人普通托槽矫正', 8000, '正畸'], [42, '成人国产自锁矫正', 9800, '正畸'],
    [43, '成人进口自锁矫正', 12800, '正畸'],
    // 隐形矫正按品牌细分
    [44, '隐形矫正（思迈康）', 12800, '正畸'], [45, '隐形矫正（美加）', 15800, '正畸'],
    [46, '隐形矫正（时代天使标准版）', 19800, '正畸'],
    // 正畸保持器
    [47, '透明保持器', 400, '正畸'], [48, 'Hawley 保持器', 800, '正畸'],
    // 种植（按品牌细分，参考信义口腔公开价）
    [49, '种植牙（韩国登腾）', 6800, '种植'], [50, '种植牙（韩国奥齿泰）', 8600, '种植'],
    [51, '种植牙（以色列雅定）', 9800, '种植'], [52, '种植牙（瑞典诺贝尔）', 18000, '种植'],
    // 修复（参考真实价目表）
    [53, '爱尔创亮瓷牙修复', 1300, '修复'], [54, '德国水晶全瓷冠', 2580, '修复'],
    [55, '金属烤瓷牙', 400, '修复'], [56, '贵金属烤瓷牙', 2600, '修复'],
    [57, '美学贴面', 2400, '修复'], [58, '嵌体修复', 1800, '修复'],
    // 内科 / 预防（参考真实价目表）
    [59, '全口涂氟', 80, '预防'], [60, '高端纳米树脂补牙', 260, '修复'],
    [61, '牙周刮治', 200, '治疗'], [62, '复杂智齿拔除', 450, '外科'],
    [63, '局部 CBCT', 150, '检查'], [64, '冷光美白', 1800, '修复'],
  ];
  for (const it of items) await q('INSERT INTO treatment_item (id,name,price,category) VALUES ($1,$2,$3,$4)', it);

  // 套餐卡售价按所含单次项目价给出适度优惠（洁牙类）
  const packages = [
    [1, '低', '超声波洁牙卡', 258, 12, 3], [2, '中', '喷砂洁牙卡', 698, 12, 4], [3, '高', '舒适洁牙卡', 1980, 18, 6],
  ];
  for (const p of packages) await q('INSERT INTO package (id,tier,name,price,valid_months,total_times,status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [...p, '在售']);
  await q('INSERT INTO package_item (package_id,item_id,times) VALUES (1,2,3)');
  await q('INSERT INTO package_item (package_id,item_id,times) VALUES (2,3,4)');
  await q('INSERT INTO package_item (package_id,item_id,times) VALUES (3,4,6)');

  // 优惠券模板：会员指定项目优惠价（新客注册自动发超声波洁牙会员券 68 元，原价 98）
  const couponTemplates = [
    [1, '新客超声波洁牙券', 2, 68, 90, '新客注册'],
    [2, '喷砂洁牙会员券', 3, 158, 90, '新客注册'],
    [3, '舒适洁牙会员券', 4, 298, 90, '会员福利'],
  ];
  for (const t of couponTemplates) await q('INSERT INTO coupon_template (id,name,item_id,discount_price,valid_days,biz_type,status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [...t, '启用']);
  // 给前几位示例患者发券，便于演示；新患者首次登录时由后端自动发券
  for (let i = 0; i < 6; i++) {
    const pid = 100 + i;
    const tid = i % 3 + 1;
    const tmpl: any = couponTemplates.find((t) => t[0] === tid)!;
    await q('INSERT INTO coupon (id,template_id,patient_id,code,status,expire_date) VALUES ($1,$2,$3,$4,$5,$6)',
      [i + 1, tid, pid, `XYCOUPON${String(i + 1).padStart(4, '0')}`, '未使用', day(90)]);
  }

  // 第二个具名演示案例：林小满（13800018888），会员，带就诊记录与券，登录即可看到完整会员视图
  await q('INSERT INTO person (id,name,gender,birth_date,phone,role) VALUES ($1,$2,$3,$4,$5,$6)',
    [130, '林小满', '女', '1992-07-08', '13800018888', '患者']);
  await q('INSERT INTO patient (person_id,allergy,allergy_by,medical_history,member_level) VALUES ($1,$2,$3,$4,$5)',
    [130, '无', 2, '无', '会员']);
  await q('INSERT INTO coupon (id,template_id,patient_id,code,status,expire_date) VALUES ($1,$2,$3,$4,$5,$6)',
    [7, 1, 130, 'XYCOUPON0007', '未使用', day(90)]);
  await q('INSERT INTO coupon (id,template_id,patient_id,code,status,expire_date) VALUES ($1,$2,$3,$4,$5,$6)',
    [8, 2, 130, 'XYCOUPON0008', '未使用', day(90)]);

  let sid = 1;
  for (const [did, , , storeId] of dentists) {
    const storeChairs = chairs.filter((c) => c[1] === storeId);
    const dentistOrder = dentists.filter((x) => x[3] === storeId).findIndex((x) => x[0] === did);
    for (let d = 0; d < 7; d++) {
      for (const slot of ['09:00', '10:00', '14:00', '15:00']) {
        const chairId = storeChairs[dentistOrder % storeChairs.length][0];
        await q('INSERT INTO dentist_schedule (id,dentist_id,store_id,chair_id,work_date,slot,quota,locked) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [sid++, did, storeId, chairId, day(d), slot, 2, 0]);
      }
    }
  }

  // 洁牙专门号源：洁牙师 + 洁牙椅位 + 时段，独立于牙医排班；每天每时段每椅位 2 个号
  let hid = 1;
  for (const [hidPerson, storeId] of [[20, 1], [21, 2]] as [number, number][]) {
    const storeHygieneChairs = hygieneChairs.filter((c) => c[1] === storeId);
    for (let d = 0; d < 7; d++) {
      for (const slot of ['09:00', '10:30', '14:00', '15:30']) {
        const chairId = storeHygieneChairs[(hid % storeHygieneChairs.length)][0];
        await q('INSERT INTO hygiene_schedule (id,hygienist_id,store_id,chair_id,work_date,slot,quota,locked) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [hid++, hidPerson, storeId, chairId, day(d), slot, 2, 0]);
      }
    }
  }

  const materials = [
    [1, '一次性口腔器械盒', '标准装', '盒', 20, 120, 1],
    [2, '洁牙机工作尖', '通用', '支', 10, 35, 1],
    [3, '树脂充填材料', 'A2', '支', 8, 26, 1],
    [4, '种植体', '4.1×10', '枚', 5, 12, 2],
    [5, '消毒液', '500ml', '瓶', 6, 18, 2],
  ];
  for (const m of materials) await q('INSERT INTO material (id,name,spec,unit,safety_stock,current_stock,store_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', m);

  // 成本结构按项目类别区分：种植/正畸材料占比高，洁牙/外科人工占比高，
  // 使"项目收支字典"和利润核算能反映不同项目的真实盈利结构。
  const costRatio: Record<string, [number, number, number]> = {
    '基础': [0.04, 0.25, 0.07], '洁牙': [0.06, 0.32, 0.09],
    '预防': [0.07, 0.29, 0.07], '检查': [0.04, 0.36, 0.09],
    '修复': [0.22, 0.20, 0.07], '治疗': [0.13, 0.29, 0.07],
    '外科': [0.09, 0.32, 0.07], '种植': [0.30, 0.16, 0.06],
    '正畸': [0.25, 0.22, 0.06],
  };
  for (const it of items) {
    const [mr, lr, ar] = costRatio[it[3]] || [0.25, 0.30, 0.10];
    await q('INSERT INTO item_cost (item_id,material_cost,labor_cost,allocation,effective_date) VALUES ($1,$2,$3,$4,$5)',
      [it[0], Number(it[2]) * mr, Number(it[2]) * lr, Number(it[2]) * ar, day(-60)]);
  }
  for (const s of stores) {
    for (const [type, amount] of [['房租', 18000], ['水电', 3200], ['耗材采购', 5400], ['其他', 1200]]) {
      await q('INSERT INTO expense (store_id,month,type,amount,note) VALUES ($1,$2,$3,$4,$5)', [s[0], month(), type, amount, '模拟数据']);
    }
  }

  // 历史就诊与收费：让利润表 / 绩效表一打开就有数据
  let apptId = 1;
  let visitId = 1;
  // 120 条历史就诊覆盖洁牙/补牙/根管/拔牙/牙冠/种植/正畸，使利润与绩效报表达到可演示规模
  const visitItems = [2, 3, 4, 5, 6, 7, 9, 17, 19, 21, 25, 29];
  for (let i = 0; i < 120; i++) {
    const patientId = 100 + (i % 24);
    const dentistId = dentists[i % dentists.length][0];
    const storeId = dentists[i % dentists.length][3];
    const chairId = chairs.find((c) => c[1] === storeId)![0];
    const itemId = visitItems[i % visitItems.length];
    const price = Number(items.find((x) => x[0] === itemId)![2]);
    const apptDate = day(-(i % 20) - 1);
    await q('INSERT INTO appointment (id,patient_id,dentist_id,schedule_id,chair_id,store_id,appt_date,slot,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [apptId, patientId, dentistId, 1, chairId, storeId, apptDate, '09:00', '已完成']);
    await q('INSERT INTO visit_record (id,appointment_id,patient_id,dentist_id,store_id,chair_id,queue_no,complaint,diagnosis,status,arrived_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [visitId, apptId, patientId, dentistId, storeId, chairId, i + 1, '模拟主诉', '模拟诊断', '已完成', `${apptDate} 09:10:00`]);
    await q('INSERT INTO prescription (visit_record_id,total_amount) VALUES ($1,$2)', [visitId, price]);
    await q('INSERT INTO prescription_item (prescription_id,item_id,quantity,usage,amount) VALUES ((SELECT id FROM prescription WHERE visit_record_id=$1),$2,$3,$4,$5)',
      [visitId, itemId, 1, '一次', price]);
    await q('INSERT INTO bill (visit_record_id,patient_id,store_id,amount,discount,payable,payment_method) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [visitId, patientId, storeId, price + 30, 0, price + 30, '微信']);
    if (i % 4 === 0) {
      await q('INSERT INTO followup_reminder (visit_record_id,patient_id,store_id,due_date,send_status) VALUES ($1,$2,$3,$4,$5)',
        [visitId, patientId, storeId, day(30 - i), '待发送']);
    }
    apptId++; visitId++;
  }

  // 林小满的第二条演示数据：一条已完成就诊 + 处方 + 账单（排班生成后再插入，避免外键未就绪）
  const demoApptId = 200, demoVisitId = 200, demoDentist = dentists[1][0], demoStore = dentists[1][3];
  const demoChair = chairs.find((c) => c[1] === demoStore)![0];
  await q('INSERT INTO appointment (id,patient_id,dentist_id,schedule_id,chair_id,store_id,appt_date,slot,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [demoApptId, 130, demoDentist, 1, demoChair, demoStore, day(-6), '10:30', '已完成']);
  await q('INSERT INTO visit_record (id,appointment_id,patient_id,dentist_id,store_id,chair_id,queue_no,complaint,diagnosis,status,arrived_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [demoVisitId, demoApptId, 130, demoDentist, demoStore, demoChair, 3, '牙齿清洁需求', '牙结石，建议洁牙', '已完成', `${day(-6)} 10:40:00`]);
  await q('INSERT INTO prescription (visit_record_id,total_amount) VALUES ($1,$2)', [demoVisitId, 98]);
  await q('INSERT INTO prescription_item (prescription_id,item_id,quantity,usage,amount) VALUES ((SELECT id FROM prescription WHERE visit_record_id=$1),$2,$3,$4,$5)',
    [demoVisitId, 2, 1, '一次', 98]);
  await q('INSERT INTO bill (visit_record_id,patient_id,store_id,amount,discount,payable,payment_method) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [demoVisitId, 130, demoStore, 98, 0, 98, '微信']);

  // 套餐卡与采购单
  await q('INSERT INTO package_card (id,package_id,patient_id,store_id,card_no,expire_date,total_times,remain_times,sold_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [1, 2, 100, 1, 'XYCARD001', day(365), 4, 3, 2]);
  await q('INSERT INTO package_card (id,package_id,patient_id,store_id,card_no,expire_date,total_times,remain_times,sold_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [2, 1, 101, 2, 'XYCARD002', day(365), 3, 0, 2]);
  await q('INSERT INTO purchase_order (id,store_id,order_date,supplier,status,amount,approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [1, 1, day(-3), '模拟医疗器械供应商', '已审批', 2600, 1]);
  await q('INSERT INTO purchase_order_item (purchase_order_id,material_id,quantity,price) VALUES ($1,$2,$3,$4)', [1, 1, 20, 80]);
  await q('INSERT INTO purchase_order_item (purchase_order_id,material_id,quantity,price) VALUES ($1,$2,$3,$4)', [1, 2, 10, 100]);
  await q('INSERT INTO stock_movement (material_id,store_id,move_type,quantity,batch_no,operator_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [1, 1, '入库', 20, 'MOCK-B001', 3]);

  // 示例借调单：张伟从白云总院临时支援观山湖门诊（已批准）
  await q(`INSERT INTO doctor_transfer (id,dentist_id,from_store_id,to_store_id,start_date,end_date,reason,status,applicant_id,approved_by,approved_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [1, 10, 1, 2, day(-1), day(5), '观山湖门诊种植患者增多，短期支援', '已批准', 1, 1, new Date().toISOString()]);

  // 示例治疗计划：演示患者 101（13800010001）的正畸分期计划（成人国产自锁 9800，分 4 期）
  await q(`INSERT INTO treatment_plan (id,patient_id,dentist_id,store_id,total_amount,periods,status,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [1, 101, 11, 1, 9800, 4, '进行中', new Date().toISOString()]);
  const planItems: any[] = [
    [1, 1, 1, 42, day(-10), 2000, '已完成'],
    [2, 1, 2, 8, day(20), 500, '待执行'],
    [3, 1, 3, 8, day(50), 500, '待执行'],
    [4, 1, 4, 47, day(400), 6800, '待执行'],
  ];
  for (const pi of planItems) {
    await q('INSERT INTO treatment_plan_item (id,plan_id,period,item_id,plan_date,estimate,status) VALUES ($1,$2,$3,$4,$5,$6,$7)', pi);
  }

  console.log('[seed] 信义口腔模拟数据已写入');
}
