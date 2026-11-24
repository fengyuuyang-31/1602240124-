// 患者小程序：验证码登录 → 预约 / 洗牙专门挂号 / 会员优惠券 / 买套餐 / 复诊（登录后只看本人数据）
const TABS = [['home', '首页', '🏠'], ['book', '预约', '📅'], ['clean', '洗牙', '🦷'], ['revisit', '复诊', '🔄'], ['mine', '我的', '👤']];
const PS = { tab: 'home', view: 'login', boot: null, me: null, phone: '', member: null };
const screen = () => $('#screen');
const loggedIn = () => !!PS.me;

function renderTabs() {
  $('#tabbar').innerHTML = TABS.map(([k, label, icon]) =>
    `<button class="tab ${PS.tab === k ? 'active' : ''}" data-tab="${k}"><span class="ti">${icon}</span>${label}</button>`).join('');
  $$('.tab').forEach((b) => b.onclick = () => { PS.tab = b.dataset.tab; render(); });
}

async function ensureBoot() {
  if (!PS.boot) PS.boot = await api('/api/patient/bootstrap');
  return PS.boot;
}

async function render() {
  if (!loggedIn()) return PS.view === 'register' ? renderRegister() : renderLogin();
  renderTabs();
  const el = screen();
  el.innerHTML = '<div class="empty">加载中…</div>';
  try {
    await ({ home: pageHome, book: pageBook, clean: pageClean, revisit: pageRevisit, mine: pageMine })[PS.tab](el);
  } catch (e) { el.innerHTML = `<div class="wx-card"><div class="empty">${esc(e.message)}</div></div>`; }
}

// 患者登录页：手机号 + 模拟验证码（演示 1234）。新用户走下方"新用户注册"。
function renderLogin() {
  $('#tabbar').innerHTML = '';
  screen().innerHTML = `
    <div class="login-wrap">
      <div class="login-logo">🦷</div>
      <div class="login-title">信义口腔 · 患者端</div>
      <div class="login-sub">登录预约，成为会员领洗牙优惠券</div>
      <div class="wx-card login-card">
        <div class="form-row"><label>手机号</label><input id="pl-phone" placeholder="请输入手机号"></div>
        <div class="form-row"><label>验证码</label>
          <div class="flex"><input id="pl-code" placeholder="演示验证码 1234" style="flex:1">
          <button class="btn small ghost" id="pl-send">获取验证码</button></div></div>
        <div class="err" id="pl-err"></div>
        <button class="btn block" id="pl-login" style="width:100%;margin-top:10px">登录</button>
        <div class="login-foot">
          <a href="javascript:;" id="pl-to-register">新用户注册</a>
          <span class="muted">忘记密码？使用验证码登录</span>
        </div>
        <div class="muted" style="text-align:center;margin-top:12px;line-height:1.7">
          演示账号：13800010001（李梅）｜ 13800018888（林小满）<br>验证码统一为 1234
        </div>
      </div>
    </div>`;
  $('#pl-send').onclick = () => toast('演示验证码已发送：1234');
  $('#pl-to-register').onclick = () => { PS.view = 'register'; renderRegister(); };
  $('#pl-login').onclick = async () => {
    $('#pl-err').textContent = '';
    try {
      const r = await api('/api/auth/patient/login', 'POST', {
        phone: $('#pl-phone').value.trim(), code: $('#pl-code').value.trim(),
      });
      enterApp(r);
    } catch (e) { $('#pl-err').textContent = e.message; }
  };
}

// 新用户注册：手机号 + 验证码 + 姓名 + 性别 + 年龄，注册即成为会员并自动登录
function renderRegister() {
  $('#tabbar').innerHTML = '';
  screen().innerHTML = `
    <div class="login-wrap">
      <div class="login-logo">🦷</div>
      <div class="login-title">新用户注册</div>
      <div class="login-sub">注册即成为会员，自动获赠洗牙优惠券</div>
      <div class="wx-card login-card">
        <div class="form-row"><label>手机号</label><input id="rg-phone" placeholder="请输入 11 位手机号"></div>
        <div class="form-row"><label>验证码</label>
          <div class="flex"><input id="rg-code" placeholder="演示验证码 1234" style="flex:1">
          <button class="btn small ghost" id="rg-send">获取验证码</button></div></div>
        <div class="form-row"><label>姓名</label><input id="rg-name" placeholder="请输入姓名"></div>
        <div class="form-row"><label>性别</label>
          <select id="rg-gender"><option value="女">女</option><option value="男">男</option><option value="其他">其他</option></select></div>
        <div class="form-row"><label>年龄</label><input id="rg-age" type="number" min="1" max="120" placeholder="请输入年龄"></div>
        <div class="err" id="rg-err"></div>
        <button class="btn block" id="rg-submit" style="width:100%;margin-top:10px">注册并登录</button>
        <div class="login-foot">
          <a href="javascript:;" id="rg-to-login">已有账号？返回登录</a>
        </div>
      </div>
    </div>`;
  $('#rg-send').onclick = () => toast('演示验证码已发送：1234');
  $('#rg-to-login').onclick = () => { PS.view = 'login'; renderLogin(); };
  $('#rg-submit').onclick = async () => {
    $('#rg-err').textContent = '';
    try {
      const r = await api('/api/auth/patient/register', 'POST', {
        phone: $('#rg-phone').value.trim(), code: $('#rg-code').value.trim(),
        name: $('#rg-name').value.trim(), gender: $('#rg-gender').value, age: $('#rg-age').value,
      });
      enterApp(r);
      toast(r.message || '注册成功');
    } catch (e) { $('#rg-err').textContent = e.message; }
  };
}

// 登录/注册成功后进入主界面
function enterApp(r) {
  setPatientSession(r);
  PS.me = r; PS.phone = r.phone; PS.tab = 'home'; PS.view = 'login';
  toast(`欢迎，${r.name}`);
  return render();
}

// 首页
async function pageHome(el) {
  const boot = await ensureBoot();
  el.innerHTML = `
    <div class="banner"><div class="b1">信义口腔 · 连锁预约</div>
      <div class="b2">健康从每一颗牙开始</div><div class="b3">${boot.stores.length} 家门店</div></div>
    <div class="quick">
      <div class="q" data-go="book"><div class="qi">📅</div><div class="ql">预约挂号</div></div>
      <div class="q" data-go="clean"><div class="qi">🦷</div><div class="ql">洗牙预约</div></div>
      <div class="q" data-go="clean"><div class="qi">🎟️</div><div class="ql">买洗牙套餐</div></div>
      <div class="q" data-go="mine"><div class="qi">💳</div><div class="ql">会员优惠券</div></div>
      <div class="q" data-go="revisit"><div class="qi">🔄</div><div class="ql">复诊</div></div>
      <div class="q" data-go="mine"><div class="qi">🎫</div><div class="ql">我的套餐</div></div>
    </div>
    <div class="wx-card"><div class="flex" style="justify-content:space-between">
      <h3 style="margin:0">我的预约</h3><button class="btn small ghost" id="home-logout">退出登录</button></div>
      <div class="muted" style="margin:6px 0 10px">${esc(PS.me.name)} · ${esc(PS.phone)}</div>
      <div id="home-appts"></div></div>`;
  $$('.q').forEach((q) => q.onclick = () => { PS.tab = q.dataset.go; render(); });
  $('#home-logout').onclick = async () => {
    await api('/api/auth/patient/logout', 'POST', {});
    setPatientSession(null); PS.me = null; PS.phone = ''; await render();
  };
  const load = async () => {
    const rows = await api('/api/patient/appointments?phone=' + encodeURIComponent(PS.phone));
    $('#home-appts').innerHTML = rows.length ? rows.slice(0, 4).map((r) =>
      `<div class="list-row"><div class="t"><span>${esc(r.store_name)} · ${esc(r.dentist_name)}</span>${tag(r.status)}</div>
       <div class="d">${r.appt_date} ${r.slot} ｜ 编号 #${r.id}</div></div>`).join('') : '<div class="muted">暂无预约记录</div>';
  };
  await load();
}

// 预约挂号
async function pageBook(el) {
  const boot = await ensureBoot();
  el.innerHTML = `
    <div class="wx-title">预约挂号</div>
    <div class="wx-card"><div class="flex" style="margin-bottom:10px">
      <select id="bk-store" style="flex:1"><option value="">全部门店</option>${boot.stores.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <input type="date" id="bk-date" value="${todayStr()}" style="width:140px"></div>
      <button class="btn small" id="bk-query" style="width:100%">查询号源</button>
      <div id="bk-list" style="margin-top:10px"></div></div>`;
  const load = async () => {
    const storeId = $('#bk-store').value; const date = $('#bk-date').value;
    const rows = await api(`/api/patient/schedules?storeId=${storeId}&date=${date}`);
    $('#bk-list').innerHTML = rows.length ? rows.map((r) => {
      const store = boot.stores.find((s) => s.id === r.store_id);
      const full = Number(r.available) <= 0;
      return `<div class="slot ${full ? 'full' : ''}"><div class="info"><b>${esc(r.dentist_name)}</b>
        <div>${esc(store?.name)} ｜ ${r.slot} ｜ 椅位 ${esc(r.chair_code)} ｜ 剩 ${r.available}/${r.quota}</div></div>
        <button class="btn small" data-book="${r.id}" ${full ? 'disabled' : ''}>${full ? '已满' : '预约'}</button></div>`;
    }).join('') : '<div class="muted">该日期暂无号源，试试其他日期</div>';
    $$('[data-book]').forEach((b) => b.onclick = () => {
      const s = rows.find((x) => x.id === Number(b.dataset.book));
      modal('确认预约', `<div class="muted" style="margin-bottom:8px">预约手机号：${esc(PS.phone)}（${esc(PS.me.name)}）</div>
        ${selectField('就诊项目', 'bk-item', boot.items.map((i) => ({ v: i.id, t: `${i.name} ${money(i.price)}` })))}
        <div class="muted">${esc(s.dentist_name)} ｜ ${s.work_date} ${s.slot} ｜ ${esc(boot.stores.find((x) => x.id === s.store_id)?.name)}</div>`,
        async (body) => {
          await api('/api/patient/appointments', 'POST', { phone: PS.phone, name: PS.me.name,
            project: $('#bk-item', body).value, storeId: s.store_id, dentistId: s.dentist_id, date: s.work_date, slot: s.slot });
          toast('预约成功，已模拟推送通知'); await load();
        }, '提交预约');
    });
  };
  $('#bk-query').onclick = load; await load();
}

// 洗牙专门挂号：与牙痛就诊预约分开，走洁牙师独立号源；可用会员券享优惠价 / 用套餐卡扣次 / 到店支付
async function pageClean(el) {
  const boot = await ensureBoot();
  el.innerHTML = `
    <div class="wx-title">洗牙 · 洁牙中心</div>
    <div class="muted" style="margin-bottom:10px">独立洁牙师号源，与牙痛就诊分开预约；会员可享优惠价</div>
    <div class="seg"><button class="active" data-cseg="book">预约洗牙</button><button data-cseg="buy">购买套餐</button><button data-cseg="mine">我的洗牙</button></div>
    <div id="clean-body"></div>`;
  let member = null, catalog = null;
  try { member = await api('/api/patient/member'); catalog = await api('/api/patient/hygiene/catalog'); }
  catch (e) { toast(e.message, true); }

  const usableCoupons = () => (member?.coupons || []).filter((c) => c.status === '未使用');

  // 预约洗牙：查洁牙号源
  const drawBook = async (body) => {
    body.innerHTML = `
      <div class="wx-card"><div class="flex" style="margin-bottom:10px">
        <select id="cl-store" style="flex:1"><option value="">全部门店</option>${boot.stores.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
        <input type="date" id="cl-date" value="${todayStr()}" style="width:140px"></div>
        <button class="btn small" id="cl-query" style="width:100%">查询洁牙号源</button>
        <div id="cl-list" style="margin-top:10px"></div></div>`;
    const load = async () => {
      const rows = await api(`/api/patient/hygiene/schedules?storeId=${$('#cl-store').value}&date=${$('#cl-date').value}`);
      $('#cl-list').innerHTML = rows.length ? rows.map((r) => {
        const store = boot.stores.find((s) => s.id === r.store_id);
        const full = Number(r.available) <= 0;
        return `<div class="slot ${full ? 'full' : ''}"><div class="info"><b>${esc(r.hygienist_name)} · 洁牙师</b>
          <div>${esc(store?.name)} ｜ ${r.slot} ｜ 洁牙椅 ${esc(r.chair_code)} ｜ 剩 ${r.available}/${r.quota}</div></div>
          <button class="btn small" data-clbook="${r.id}" ${full ? 'disabled' : ''}>${full ? '已满' : '预约'}</button></div>`;
      }).join('') : '<div class="muted">该日期暂无洁牙号源，试试其他日期</div>';
      $$('[data-clbook]').forEach((b) => b.onclick = () => {
        const s = rows.find((x) => x.id === Number(b.dataset.clbook));
        const coupons = usableCoupons();
        const cards = PS.myCards || [];
        const payOpts = [{ v: '', t: '到店支付（按原价）' }]
          .concat(cards.filter((c) => Number(c.remain_times) > 0).map((c) => ({ v: 'card:' + c.id, t: `用套餐卡：${c.package_name}（剩 ${c.remain_times} 次）` })))
          .concat(coupons.map((c) => ({ v: 'coupon:' + c.id, t: `用券：${c.template_name}（会员价 ${money(c.discount_price)}，原价 ${money(c.list_price)}）` })));
        modal('预约洗牙', `<div class="muted" style="margin-bottom:8px">预约手机号：${esc(PS.phone)}（${esc(PS.me.name)}）</div>
          ${selectField('洁牙项目', 'cl-item', (catalog.items || []).map((i) => ({ v: i.id, t: `${i.name} ${money(i.price)}` })))}
          ${selectField('支付方式', 'cl-pay', payOpts)}
          <div class="muted">${esc(s.hygienist_name)} · 洁牙师 ｜ ${s.work_date} ${s.slot} ｜ ${esc(boot.stores.find((x) => x.id === s.store_id)?.name)}</div>`,
          async (bd) => {
            const pay = $('#cl-pay', bd).value;
            const payload = { scheduleId: s.id, itemId: Number($('#cl-item', bd).value) };
            if (pay.startsWith('coupon:')) payload.couponId = Number(pay.split(':')[1]);
            if (pay.startsWith('card:')) payload.packageCardId = Number(pay.split(':')[1]);
            const res = await api('/api/patient/hygiene/appointments', 'POST', payload);
            toast(`洗牙预约成功 · ${res.payment}${res.payAmount ? ' ' + money(res.payAmount) : ''}`);
            member = await api('/api/patient/member');
            PS.myCards = await api('/api/patient/cards');
            await load();
          }, '确认预约');
      });
    };
    $('#cl-query').onclick = load; await load();
  };

  // 购买套餐
  const drawBuy = (body) => {
    body.innerHTML = `<div class="wx-card"><h3>洗牙次数套餐</h3>
      <div class="muted" style="margin-bottom:8px">会员购买更划算，可用优惠券再抵扣</div>
      <div id="pkg-list"></div></div>`;
    const pkgs = catalog.packages || [];
    $('#pkg-list').innerHTML = pkgs.length ? pkgs.map((p) =>
      `<div class="list-row"><div class="t"><span>${esc(p.name)}（${esc(p.item_name)}）</span><b>${money(p.price)}</b></div>
       <div class="d">共 ${p.times} 次 ｜ 单次原价 ${money(p.list_price)} ｜ 有效期 ${p.valid_months} 个月</div>
       <button class="btn small" data-buy="${p.id}" style="margin-top:8px">立即购买</button></div>`).join('') : '<div class="muted">暂无在售套餐</div>';
    $$('[data-buy]').forEach((b) => b.onclick = () => {
      const p = pkgs.find((x) => x.id === Number(b.dataset.buy));
      const coupons = usableCoupons();
      modal('购买套餐 · 模拟支付', `<div class="muted" style="margin-bottom:8px">套餐：${esc(p.name)} ｜ 标价 ${money(p.price)}</div>
        ${selectField('使用优惠券', 'buy-coupon', [{ v: '', t: '不使用优惠券' }].concat(coupons.map((c) =>
          ({ v: c.id, t: `${c.template_name}（抵扣 ${money(Number(c.list_price) - Number(c.discount_price))}）` }))))}
        <div class="section-title">模拟支付：仅演示，不产生真实扣款</div>`,
        async (bd) => {
          const cid = $('#buy-coupon', bd).value;
          const payload = { packageId: p.id, storeId: p.store_id || 1 };
          if (cid) payload.couponId = Number(cid);
          const res = await api('/api/patient/packages/buy', 'POST', payload);
          toast(`支付成功 ${money(res.payAmount)}，套餐卡已生成`);
          member = await api('/api/patient/member');
          PS.myCards = await api('/api/patient/cards');
          drawBuy(body);
        }, '确认支付');
    });
  };

  // 我的洗牙预约
  const drawMine = async (body) => {
    body.innerHTML = '<div class="wx-card" id="cl-mine"><div class="empty">加载中…</div></div>';
    const rows = await api('/api/patient/hygiene/appointments');
    $('#cl-mine').innerHTML = `<h3>我的洗牙预约</h3>` + (rows.length ? rows.map((r) =>
      `<div class="list-row"><div class="t"><span>${esc(r.item_name)} · ${esc(r.hygienist_name)}</span>${tag(r.status)}</div>
       <div class="d">${r.appt_date} ${r.slot} ｜ ${esc(r.store_name)} ｜ 椅位 ${esc(r.chair_code || '—')}</div>
       <div class="d">支付：${esc(r.payment)} ${r.pay_amount ? money(r.pay_amount) : ''} ｜ 编号 #${r.id}</div>
       ${r.status === '待就诊' ? `<button class="btn small ghost" data-clcancel="${r.id}" style="margin-top:8px">取消预约</button>` : ''}</div>`).join('')
      : '<div class="muted">暂无洗牙预约</div>');
    $$('[data-clcancel]').forEach((b) => b.onclick = async () => {
      if (!confirm('确认取消该洗牙预约？号源与优惠券将退回')) return;
      await api(`/api/patient/hygiene/appointments/${b.dataset.clcancel}/cancel`, 'POST', {});
      toast('已取消，号源与券已退回');
      member = await api('/api/patient/member');
      drawMine(body);
    });
  };

  const switchSeg = async (seg) => {
    $$('[data-cseg]').forEach((b) => b.classList.toggle('active', b.dataset.cseg === seg));
    const body = $('#clean-body');
    await ({ book: drawBook, buy: drawBuy, mine: drawMine })[seg](body);
  };
  $$('[data-cseg]').forEach((b) => b.onclick = () => switchSeg(b.dataset.cseg));
  // 预加载我的套餐卡，供预约页"用套餐卡扣次"选项
  PS.myCards = await api('/api/patient/cards');
  await switchSeg('book');
}

// 复诊：提醒 + 一键复诊
async function pageRevisit(el) {
  el.innerHTML = `<div class="wx-title">复诊管理</div>
    <div class="muted" style="margin-bottom:10px">${esc(PS.me.name)} · ${esc(PS.phone)} 的复诊信息</div>
    <div class="seg"><button class="active" data-seg="remind">复诊提醒</button><button data-seg="done">就诊记录</button></div>
    <div class="wx-card" id="rv-body"></div>`;
  let data = null;
  const load = async () => {
    data = await api('/api/patient/revisits?phone=' + encodeURIComponent(PS.phone));
    draw('remind');
  };
  const draw = (seg) => {
    $$('[data-seg]').forEach((b) => b.classList.toggle('active', b.dataset.seg === seg));
    const body = $('#rv-body');
    if (seg === 'remind') {
      body.innerHTML = data.reminders.length ? data.reminders.map((r) =>
        `<div class="list-row"><div class="t"><span>${esc(r.patient_name)} · ${esc(r.store_name)}</span>${tag(r.send_status)}</div>
         <div class="d">复诊到期：${r.due_date} ｜ 原接诊牙医：${esc(r.dentist_name || '—')}</div>
         <div class="d">回访：${esc(r.callback_result || '待回访')}</div>
         <button class="btn small" data-rv="${r.id}" style="margin-top:8px">一键预约复诊</button></div>`).join('')
        : '<div class="muted">暂无复诊提醒</div>';
      $$('[data-rv]').forEach((b) => b.onclick = async () => {
        const r = data.reminders.find((x) => x.id === Number(b.dataset.rv));
        const boot = await ensureBoot();
        modal('预约复诊', `<div class="muted" style="margin-bottom:8px">预约手机号：${esc(PS.phone)}</div>
          ${selectField('接诊牙医', 'rvbk-dentist', boot.dentists.map((d) => ({ v: d.person_id, t: `${d.name} · ${d.specialty}` })))}
          <div class="form-row"><label>复诊日期</label><input id="rvbk-date" type="date" value="${todayStr()}"></div>
          ${field('时段', 'rvbk-slot', '10:00')}
          ${selectField('复诊项目', 'rvbk-item', boot.items.map((i) => ({ v: i.id, t: i.name })))}`,
          async (bd) => {
            await api('/api/patient/revisits/book', 'POST', { phone: PS.phone,
              dentistId: Number($('#rvbk-dentist', bd).value), date: $('#rvbk-date', bd).value,
              slot: $('#rvbk-slot', bd).value, storeId: r.store_id, project: $('#rvbk-item', bd).value });
            toast('复诊预约成功'); await load();
          }, '确认预约复诊');
      });
    } else {
      body.innerHTML = data.visits.length ? data.visits.map((v) =>
        `<div class="list-row"><div class="t"><span>${esc(v.store_name)} · ${esc(v.dentist_name)}</span>${tag(v.status)}</div>
         <div class="d">就诊 #${v.id} ｜ 诊断：${esc(v.diagnosis || '—')} ｜ 复诊间隔 ${v.recall_interval_days} 天</div></div>`).join('')
        : '<div class="muted">暂无已完成就诊</div>';
    }
  };
  $$('[data-seg]').forEach((b) => b.onclick = () => draw(b.dataset.seg));
  await load();
}

// 我的
async function pageMine(el) {
  el.innerHTML = `<div class="wx-title">我的</div>
    <div class="muted" style="margin-bottom:10px">${esc(PS.me.name)} · ${esc(PS.phone)}</div>
    <div class="wx-card" id="me-member-card"><h3>会员与优惠券</h3><div id="me-member"></div></div>
    <div class="wx-card"><h3>我的套餐卡</h3><div id="me-cards"></div></div>
    <div class="wx-card"><h3>我的治疗计划（点击查看期次）</h3><div id="me-plans"></div></div>`;
  const load = async () => {
    const p = PS.phone;
    const [member, cards, plans] = await Promise.all([
      api('/api/patient/member'),
      api('/api/patient/cards'),
      api('/api/patient/plans'),
    ]);
    const usable = (member.coupons || []).filter((c) => c.status === '未使用');
    $('#me-member').innerHTML = `
      <div class="member-badge">👑 ${esc(member.memberLevel)}会员 · ${esc(member.name)}</div>
      <div class="muted" style="margin:6px 0 10px">可用优惠券 ${usable.length} 张（洗牙预约或买套餐可用）</div>
      ${member.coupons.length ? member.coupons.map((c) =>
        `<div class="coupon ${c.status === '已使用' ? 'used' : ''}"><div class="cv">
           <span class="csym">¥</span>${money(c.discount_price)}</div>
         <div class="ci"><b>${esc(c.template_name)}</b>
           <div>${esc(c.item_name)} ｜ 原价 ${money(c.list_price)}</div>
           <div class="muted">${c.status === '未使用' ? '有效期至 ' + c.expire_date : c.status}</div></div></div>`).join('')
        : '<div class="muted">暂无优惠券</div>'}`;
    $('#me-cards').innerHTML = cards.length ? cards.map((c) =>
      `<div class="list-row"><div class="t"><span>${esc(c.package_name)} ${esc(c.card_no)}</span>${tag(c.status)}</div>
       <div class="d">剩余 ${c.remain_times}/${c.total_times} 次 ｜ 有效期至 ${c.expire_date}</div></div>`).join('') : '<div class="muted">暂无套餐卡</div>';
    $('#me-plans').innerHTML = plans.length ? plans.map((pl) =>
      `<div class="list-row clickable" data-plan="${pl.id}" style="cursor:pointer">
        <div class="t"><span>计划 #${pl.id} · ${esc(pl.dentist_name)}</span>${tag(pl.status)}</div>
        <div class="d">共 ${pl.periods} 期 ｜ 总费用 ${money(pl.total_amount)} ｜ 点击查看期次明细 ›</div></div>`).join('')
      : '<div class="muted">暂无治疗计划</div>';
    $$('[data-plan]').forEach((row) => row.onclick = () => openPlanDetail(Number(row.dataset.plan)));
  };
  await load();
}

// 查看治疗计划期次明细
async function openPlanDetail(id) {
  try {
    const r = await api(`/api/patient/plans/${id}`);
    const total = r.items.reduce((s, it) => s + Number(it.estimate || 0), 0);
    modal(`治疗计划 #${id}`, `${table(['期次', '项目', '计划日期', '预计金额', '状态'], r.items.map((it) =>
      `<tr><td>${it.period}</td><td>${esc(it.item_name)}</td><td>${esc(it.plan_date || '—')}</td>
       <td>${money(it.estimate)}</td><td>${tag(it.status)}</td></tr>`))}
      <div class="section-title">合计 ${money(total)}</div>`,
      async () => {}, '关闭');
  } catch (e) { toast(e.message, true); }
}

// 初始化：已有登录则校验后进入小程序，否则显示登录页
(async function init() {
  const s = patientSession();
  const tabFromHash = (location.hash || '').replace('#', '');
  if (['home', 'book', 'clean', 'revisit', 'mine'].includes(tabFromHash)) PS.tab = tabFromHash;
  if (s?.token) {
    try {
      PS.me = await api('/api/auth/patient/me');
      PS.phone = PS.me.phone;
      await ensureBoot();
      await render();
      return;
    } catch { setPatientSession(null); }
  }
  await render();
})();
