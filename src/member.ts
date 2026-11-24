// 会员 / 优惠券 / 洁牙专门挂号 领域逻辑
// 会员：患者首次登录即成为会员，自动发放新客优惠券（指定项目会员价）。
// 洁牙：与牙痛就诊分开，走洁牙师独立号源；可用券享会员价，或用套餐卡扣次，或到店支付。
import { query, one, tx } from './db.js';

const n = (v: any) => Number(v || 0);
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => localDate();
const addDays = (base: Date, days: number) => localDate(new Date(base.getTime() + days * 86400000));
const nextId = async (q: any, table: string) => n((await q(`SELECT COALESCE(MAX(id),0)+1 AS id FROM ${table}`))[0].id);

// 确保患者已建档、是会员、且领过新客券。返回 person_id。
// 登录时调用：老患者升级会员并补发券，新手机号自动建档 + 会员 + 发券。
export async function ensureMember(phone: string, name?: string, gender?: string, birthDate?: string) {
  return tx(async (q) => {
    let p = (await q('SELECT id FROM person WHERE phone=$1', [phone]))[0];
    if (!p) {
      const pid = await nextId(q, 'person');
      await q('INSERT INTO person (id,name,gender,birth_date,phone,role) VALUES ($1,$2,$3,$4,$5,$6)',
        [pid, name || '患者', gender || '其他', birthDate || null, phone, '患者']);
      await q('INSERT INTO patient (person_id,allergy,member_level) VALUES ($1,$2,$3)', [pid, '无', '会员']);
      p = { id: pid };
    } else {
      // 老患者升级会员
      await q("UPDATE patient SET member_level='会员' WHERE person_id=$1 AND (member_level IS NULL OR member_level<>'会员')", [p.id]);
    }
    const pid = p.id;

    // 幂等发放：每个新客券模板每人只发一次
    const templates = await q("SELECT * FROM coupon_template WHERE biz_type='新客注册' AND status='启用' ORDER BY id");
    for (const t of templates) {
      const exists = (await q('SELECT id FROM coupon WHERE patient_id=$1 AND template_id=$2', [pid, t.id]))[0];
      if (!exists) {
        await q('INSERT INTO coupon (id,template_id,patient_id,code,status,expire_date) VALUES ($1,$2,$3,$4,$5,$6)',
          [await nextId(q, 'coupon'), t.id, pid, `XY${Date.now().toString().slice(-8)}${t.id}`, '未使用', addDays(new Date(), n(t.valid_days) || 90)]);
      }
    }
    return { personId: pid };
  });
}

// 会员信息 + 我的券（含券对应项目与原价，便于前端展示"会员价"）
export async function memberInfo(phone: string) {
  const pat = (await one(`SELECT pe.id AS person_id, pe.name, pa.member_level
    FROM person pe JOIN patient pa ON pa.person_id=pe.id WHERE pe.phone=$1`, [phone]));
  if (!pat) throw new Error('患者档案不存在');
  const coupons = await query(
    `SELECT c.*, ct.name AS template_name, ct.discount_price, ti.name AS item_name, ti.price AS list_price
     FROM coupon c JOIN coupon_template ct ON ct.id=c.template_id
     JOIN treatment_item ti ON ti.id=ct.item_id
     JOIN person pe ON pe.id=c.patient_id
     WHERE pe.phone=$1 ORDER BY c.id DESC`, [phone]);
  return { memberLevel: pat.member_level, name: pat.name, coupons };
}

// 洁牙可约号源（独立号源目录）
export async function listHygieneSchedules(storeId?: number, date?: string) {
  let sql = `SELECT hs.*, pe.name AS hygienist_name, c.code AS chair_code,
    (hs.quota - hs.locked) AS available
    FROM hygiene_schedule hs
    JOIN person pe ON pe.id=hs.hygienist_id
    JOIN chair c ON c.id=hs.chair_id WHERE 1=1`;
  const args: any[] = [];
  if (storeId) { sql += ' AND hs.store_id = $' + (args.push(storeId)); }
  if (date) { sql += ' AND hs.work_date = $' + (args.push(date)); }
  sql += ' ORDER BY hs.work_date, hs.slot';
  return query(sql, args);
}

// 可购买/使用的洁牙项目（category=洁牙）与在售洁牙套餐
export async function hygieneCatalog() {
  const [items, packages] = await Promise.all([
    query("SELECT id,name,price,category FROM treatment_item WHERE category='洁牙' ORDER BY id"),
    query(`SELECT p.*, pi.item_id, pi.times, ti.name AS item_name, ti.price AS list_price
      FROM package p JOIN package_item pi ON pi.package_id=p.id
      JOIN treatment_item ti ON ti.id=pi.item_id
      WHERE p.status='在售' ORDER BY p.id`),
  ]);
  return { items, packages };
}

// 创建洁牙预约：用券（会员价）或用套餐卡扣次，或到店支付；号源占用与牙医号源完全独立
export async function createHygieneAppointment(input: any) {
  return tx(async (q) => {
    const { phone, scheduleId, itemId, couponId, packageCardId } = input;
    const pat = (await q('SELECT person_id FROM patient JOIN person ON person.id=patient.person_id WHERE person.phone=$1', [phone]))[0];
    if (!pat) throw new Error('患者档案不存在');
    const pid = pat.person_id;

    const sched = (await q('SELECT * FROM hygiene_schedule WHERE id=$1', [scheduleId]))[0];
    if (!sched) throw new Error('该洁牙时段不存在');
    if (n(sched.locked) >= n(sched.quota)) throw new Error('该时段洁牙号源已满，请选择其他时段');

    const item = (await q('SELECT * FROM treatment_item WHERE id=$1', [itemId]))[0];
    if (!item) throw new Error('洁牙项目不存在');

    // 结算方式判定：券 or 套餐卡 or 到店支付（三选一）
    let payAmount = n(item.price);
    let payment = '到店支付';
    let usedCouponId: number | null = null;
    let usedCardId: number | null = null;

    if (couponId) {
      const cp = (await q(`SELECT c.*, ct.item_id, ct.discount_price FROM coupon c
        JOIN coupon_template ct ON ct.id=c.template_id WHERE c.id=$1 AND c.patient_id=$2`, [couponId, pid]))[0];
      if (!cp) throw new Error('优惠券不存在或不属于当前患者');
      if (cp.status !== '未使用') throw new Error('优惠券已使用或已过期');
      if (cp.expire_date && cp.expire_date < today()) throw new Error('优惠券已过期');
      if (n(cp.item_id) !== n(itemId)) throw new Error('该优惠券不适用于所选洁牙项目');
      payAmount = n(cp.discount_price);
      payment = '优惠券';
      usedCouponId = couponId;
    } else if (packageCardId) {
      const card = (await q('SELECT * FROM package_card WHERE id=$1 AND patient_id=$2', [packageCardId, pid]))[0];
      if (!card) throw new Error('套餐卡不存在或不属于当前患者');
      if (card.status !== '有效' || n(card.remain_times) <= 0) throw new Error('套餐卡无剩余次数');
      if (card.expire_date && card.expire_date < today()) throw new Error('套餐卡已过期');
      // 校验套餐所含项目覆盖本次洁牙
      const covered = (await q('SELECT 1 FROM package_item WHERE package_id=$1 AND item_id=$2', [card.package_id, itemId]))[0];
      if (!covered) throw new Error('所选洁牙项目不在该套餐范围内');
      payAmount = 0;
      payment = '套餐抵扣';
      usedCardId = packageCardId;
    }

    // CAS 占号，防止并发超卖
    await q('UPDATE hygiene_schedule SET locked=locked+1 WHERE id=$1 AND locked<quota', [sched.id]);
    const check = (await q('SELECT locked FROM hygiene_schedule WHERE id=$1', [sched.id]))[0];
    if (n(check.locked) !== n(sched.locked) + 1) throw new Error('并发预约冲突，请重试');

    const appt = await q(`INSERT INTO hygiene_appointment
      (id,patient_id,hygienist_id,schedule_id,chair_id,store_id,item_id,appt_date,slot,coupon_id,package_card_id,pay_amount,payment,channel,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [await nextId(q, 'hygiene_appointment'), pid, sched.hygienist_id, sched.id, sched.chair_id, sched.store_id,
        itemId, sched.work_date, sched.slot, usedCouponId, usedCardId, payAmount, payment, '患者端', '待就诊']);

    if (usedCouponId) await q("UPDATE coupon SET status='已使用', used_at=CURRENT_TIMESTAMP, used_biz=$1 WHERE id=$2", [`洁牙预约#${appt[0].id}`, usedCouponId]);
    if (usedCardId) {
      await q('UPDATE package_card SET remain_times = remain_times - 1 WHERE id=$1', [usedCardId]);
      const card = (await q('SELECT remain_times FROM package_card WHERE id=$1', [usedCardId]))[0];
      if (n(card.remain_times) <= 0) await q("UPDATE package_card SET status='已用完' WHERE id=$1", [usedCardId]);
    }
    return { appointment: appt[0], payAmount, payment, notification: '洁牙预约成功通知已请求（模拟推送）' };
  });
}

// 取消洁牙预约：释放号源，退回券与套餐次数
export async function cancelHygieneAppointment(id: number, phone: string) {
  return tx(async (q) => {
    const appt = (await q(`SELECT ha.*, pe.phone FROM hygiene_appointment ha
      JOIN person pe ON pe.id=ha.patient_id WHERE ha.id=$1`, [id]))[0];
    if (!appt) throw new Error('洁牙预约不存在');
    if (appt.phone !== phone) throw new Error('无权取消他人的预约');
    if (appt.status !== '待就诊') throw new Error('仅待就诊的洁牙预约可取消');
    if (appt.appt_date < today()) throw new Error('预约日期已过，不可自助取消');
    await q("UPDATE hygiene_appointment SET status='已取消' WHERE id=$1", [id]);
    const sched = (await q('SELECT locked FROM hygiene_schedule WHERE id=$1', [appt.schedule_id]))[0];
    await q('UPDATE hygiene_schedule SET locked=$1 WHERE id=$2', [Math.max(0, n(sched?.locked) - 1), appt.schedule_id]);
    if (appt.coupon_id) await q("UPDATE coupon SET status='未使用', used_at=NULL, used_biz=NULL WHERE id=$1", [appt.coupon_id]);
    if (appt.package_card_id) {
      await q("UPDATE package_card SET remain_times = remain_times + 1, status='有效' WHERE id=$1", [appt.package_card_id]);
    }
    return { ok: true, notification: '取消成功通知已请求（模拟推送）' };
  });
}

// 我的洁牙预约
export async function myHygieneAppointments(phone: string) {
  return query(`SELECT ha.*, pe.name AS hygienist_name, s.name AS store_name,
    ti.name AS item_name, c.code AS chair_code
    FROM hygiene_appointment ha
    JOIN person pe ON pe.id=ha.hygienist_id
    JOIN store s ON s.id=ha.store_id
    JOIN treatment_item ti ON ti.id=ha.item_id
    LEFT JOIN chair c ON c.id=ha.chair_id
    JOIN person own ON own.id=ha.patient_id
    WHERE own.phone=$1 ORDER BY ha.appt_date DESC, ha.id DESC LIMIT 100`, [phone]);
}

// 购买洁牙套餐（模拟支付）：可用券抵扣固定优惠额，支付后生成套餐卡
export async function buyPackage(input: any) {
  return tx(async (q) => {
    const { phone, packageId, storeId, couponId } = input;
    const pat = (await q('SELECT person_id FROM patient JOIN person ON person.id=patient.person_id WHERE person.phone=$1', [phone]))[0];
    if (!pat) throw new Error('患者档案不存在');
    const pid = pat.person_id;

    const pkg = (await q("SELECT * FROM package WHERE id=$1 AND status='在售'", [packageId]))[0];
    if (!pkg) throw new Error('套餐不存在或已停售');
    let discount = 0;
    let usedCouponId: number | null = null;
    if (couponId) {
      const cp = (await q(`SELECT c.*, ct.discount_price, ct.item_id FROM coupon c
        JOIN coupon_template ct ON ct.id=c.template_id WHERE c.id=$1 AND c.patient_id=$2`, [couponId, pid]))[0];
      if (!cp) throw new Error('优惠券不存在或不属于当前患者');
      if (cp.status !== '未使用') throw new Error('优惠券已使用或已过期');
      // 买套餐时，券抵扣 = 所含单项原价 - 券会员价（一次性优惠）
      const listPrice = n((await q('SELECT price FROM treatment_item WHERE id=$1', [cp.item_id]))[0]?.price);
      discount = Math.max(0, listPrice - n(cp.discount_price));
      usedCouponId = couponId;
    }
    const listPrice = n(pkg.price);
    const payAmount = Math.max(0, listPrice - discount);

    // 生成套餐卡
    const cardId = await nextId(q, 'package_card');
    const validMonths = n(pkg.valid_months) || 12;
    const expire = addDays(new Date(), validMonths * 30);
    await q(`INSERT INTO package_card (id,package_id,patient_id,store_id,card_no,expire_date,total_times,remain_times,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cardId, pkg.id, pid, storeId || 1, `XYCARD${Date.now().toString().slice(-10)}`, expire, n(pkg.total_times), n(pkg.total_times), '有效']);

    const orderId = await nextId(q, 'package_order');
    await q(`INSERT INTO package_order (id,patient_id,package_id,store_id,coupon_id,list_price,discount,pay_amount,package_card_id,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [orderId, pid, pkg.id, storeId || 1, usedCouponId, listPrice, discount, payAmount, cardId, '已支付']);
    if (usedCouponId) await q("UPDATE coupon SET status='已使用', used_at=CURRENT_TIMESTAMP, used_biz=$1 WHERE id=$2", [`套餐订单#${orderId}`, usedCouponId]);

    return { orderId, cardId, listPrice, discount, payAmount, notification: '模拟支付成功，套餐卡已生成' };
  });
}

// 我的套餐订单
export async function myPackageOrders(phone: string) {
  return query(`SELECT po.*, pk.name AS package_name, s.name AS store_name
    FROM package_order po JOIN package pk ON pk.id=po.package_id
    JOIN store s ON s.id=po.store_id
    JOIN person pe ON pe.id=po.patient_id
    WHERE pe.phone=$1 ORDER BY po.id DESC`, [phone]);
}
