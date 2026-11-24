// 管理网站：费用模块 + 医生绩效模块 + 前台/院长/分院负责人/库管运营（按登录岗位过滤菜单）
// 每个分组带 roles：允许看到的岗位；不填表示所有岗位可见
const GROUPS = [
  { roles: ['院长', '负责人'], g: '院务管理', items: [
    ['mgr-dash', '经营驾驶舱'], ['mgr-schedule', '排班与椅位'], ['mgr-package', '套餐目录'], ['mgr-patient', '患者档案'], ['mgr-db', '数据库结构']] },
  { roles: ['院长', '负责人'], g: '员工与借调', items: [
    ['mgr-transfer', '医生临时借调'], ['mgr-accounts', '账号审批']] },
  { roles: ['院长', '负责人'], g: '费用核算（费用模块）', items: [
    ['fin-items', '项目收支字典'], ['fin-expense', '房租水电等费用'], ['fin-purchase', '医疗产品采购'],
    ['fin-profit', '利润核算'], ['fin-refund', '退款审批']] },
  { roles: ['前台'], g: '前台运营', items: [
    ['op-checkin', '报到签到'], ['op-queue', '候诊队列'], ['op-settle', '收费结算'], ['op-follow', '随访工作台'], ['fin-refund', '退款申请']] },
  { roles: ['院长', '负责人'], g: '连锁绩效（绩效模块）', items: [
    ['perf-rank', '医生绩效排名'], ['perf-store', '门店绩效对比']] },
  { roles: ['库管员'], g: '库房管理', items: [
    ['stock-list', '库存台账'], ['stock-purchase', '采购入库']] },
];
const AD = { page: null, boot: null, me: null };
const amain = () => $('#main');
const month = () => $('#global-month')?.value || monthStr();

async function aboot() { if (!AD.boot) AD.boot = await api('/api/admin/bootstrap'); return AD.boot; }
const storeName = (id) => AD.boot?.stores.find((s) => s.id === id)?.name || '—';

// 当前岗位可见的分组与默认页
const visibleGroups = () => GROUPS.filter((x) => x.roles.includes(AD.me.activeRole));

function renderNav() {
  $('#sidebar').innerHTML = visibleGroups().map((grp) =>
    `<div class="nav-group">${grp.g}</div>${grp.items.map(([k, l]) =>
      `<button class="nav-item ${AD.page === k ? 'active' : ''}" data-page="${k}">${l}</button>`).join('')}`).join('');
  $$('.nav-item').forEach((b) => b.onclick = () => { AD.page = b.dataset.page; render(); });
}

const PAGES = {
  'fin-items': finItems, 'fin-expense': finExpense, 'fin-purchase': finPurchase, 'fin-profit': finProfit, 'fin-refund': finRefund,
  'perf-rank': perfRank, 'perf-store': perfStore,
  'op-checkin': opCheckin, 'op-queue': opQueue, 'op-settle': opSettle, 'op-follow': opFollow,
  'mgr-dash': mgrDash, 'mgr-schedule': mgrSchedule, 'mgr-package': mgrPackage, 'mgr-patient': mgrPatient,
  'mgr-transfer': mgrTransfer, 'mgr-accounts': mgrAccounts,
  'stock-list': stockList, 'stock-purchase': stockPurchase,
  'mgr-db': () => { location.href = '/db.html'; },
};

async function render() {
  renderNav();
  const el = amain();
  el.innerHTML = '<div class="empty">加载中…</div>';
  try { await PAGES[AD.page](el); }
  catch (e) { el.innerHTML = `<div class="panel"><div class="empty">${esc(e.message)}</div></div>`; }
}

const storeSel = (id, all = true) => `<select id="${id}">${all ? '<option value="">全部门店</option>' : ''}
  ${AD.boot.stores.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>`;

// ============ 费用模块 ============

// 1) 项目收支字典：每个项目收费 vs 花了多少钱
async function finItems(el) {
  const boot = await aboot();
  const rows = await api('/api/finance/items');
  el.innerHTML = `<h2>项目收支字典 <span class="module-tag">费用模块</span></h2>
    <div class="subtitle">每个诊疗项目：收费价、成本（材料+人工+分摊）、单位毛利</div>
    <div class="panel">${table(['编号', '项目', '类别', '收费价', '材料成本', '人工成本', '分摊', '单位成本', '单位毛利', '毛利率', ''],
      rows.map((r) => `<tr><td>${r.id}</td><td>${esc(r.name)}</td><td>${esc(r.category || '—')}</td>
        <td>${money(r.charge_price)}</td><td>${money(r.material_cost)}</td><td>${money(r.labor_cost)}</td>
        <td>${money(r.allocation)}</td><td>${money(r.unit_cost)}</td>
        <td style="color:${Number(r.unit_margin) >= 0 ? 'var(--brand)' : 'var(--danger)'}">${money(r.unit_margin)}</td>
        <td>${Number(r.charge_price) ? ((r.unit_margin / r.charge_price) * 100).toFixed(1) + '%' : '—'}</td>
        <td><button class="btn small ghost" data-cost="${r.id}">维护成本</button></td></tr>`))}</div>`;
  $$('[data-cost]').forEach((b) => b.onclick = () => {
    const r = rows.find((x) => x.id === Number(b.dataset.cost));
    modal(`维护成本 · ${r.name}`, `${field('材料成本', 'c-material', r.material_cost, 'number')}
      ${field('人工成本', 'c-labor', r.labor_cost, 'number')}${field('分摊费用', 'c-alloc', r.allocation, 'number')}
      <div class="muted">当前收费价 ${money(r.charge_price)}，成本将用于利润核算</div>`,
      async (body) => {
        await api(`/api/finance/items/${r.id}/cost`, 'PUT', { materialCost: Number($('#c-material', body).value),
          laborCost: Number($('#c-labor', body).value), allocation: Number($('#c-alloc', body).value) });
        toast('项目成本已更新'); await render();
      });
  });
}

// 2) 房租水电等期间费用
async function finExpense(el) {
  const boot = await aboot();
  const rows = await api(`/api/finance/expenses?month=${month()}`);
  const byType = {};
  rows.forEach((r) => { byType[r.type] = (byType[r.type] || 0) + Number(r.amount); });
  el.innerHTML = `<h2>房租水电等期间费用 <span class="module-tag">费用模块</span></h2>
    <div class="subtitle">按门店、月份归集；利润核算时从收入中扣除</div>
    <div class="panel"><div class="toolbar">${storeSel('fe-store')}
      <button class="btn" id="fe-add">+ 录入费用</button></div>
      <div class="formula">本月期间费用合计：${money(rows.reduce((s, r) => s + Number(r.amount), 0))}</div>
      ${table(['编号', '门店', '类型', '金额', '月份', '备注', ''], rows.map((r) =>
        `<tr><td>${r.id}</td><td>${esc(r.store_name)}</td><td>${esc(r.type)}</td><td>${money(r.amount)}</td>
         <td>${r.month}</td><td>${esc(r.note || '—')}</td>
         <td><button class="btn small ghost" data-eid="${r.id}">删除</button></td></tr>`))}</div>
    <div class="panel"><h3>按类型汇总</h3>${table(['费用类型', '金额'], Object.entries(byType).map(([k, v]) =>
      `<tr><td>${esc(k)}</td><td>${money(v)}</td></tr>`))}</div>`;
  $('#fe-add').onclick = () => modal('录入期间费用', `${selectField('门店', 'ex-store', boot.stores.map((s) => ({ v: s.id, t: s.name })))}
    ${selectField('费用类型', 'ex-type', ['房租', '水电', '耗材采购', '其他'].map((t) => ({ v: t, t })))}
    ${field('金额', 'ex-amount', '', 'number')}${field('月份', 'ex-month', month())}`,
    async (b) => {
      await api('/api/finance/expenses', 'POST', { storeId: Number($('#ex-store', b).value), type: $('#ex-type', b).value,
        amount: Number($('#ex-amount', b).value), month: $('#ex-month', b).value });
      toast('费用已录入'); await render();
    });
  $$('[data-eid]').forEach((b) => b.onclick = async () => {
    await api('/api/finance/expenses/' + b.dataset.eid, 'DELETE'); toast('已删除'); await render();
  });
}

// 3) 医疗产品采购
async function finPurchase(el) {
  const boot = await aboot();
  const rows = await api('/api/finance/purchases');
  el.innerHTML = `<h2>医疗产品采购 <span class="module-tag">费用模块</span></h2>
    <div class="subtitle">低库存预警 → 采购申请 → 负责人或院长审批 → 验收入库，形成支出</div>
    <div class="panel"><div class="toolbar">${storeSel('fp-store', false)}
      <button class="btn" id="fp-new">+ 新建采购申请</button></div>
      ${table(['单号', '门店', '日期', '供应商', '金额', '状态', '明细', '操作'], rows.map((p) =>
        `<tr><td>#${p.id}</td><td>${esc(p.store_name)}</td><td>${p.order_date}</td><td>${esc(p.supplier)}</td>
         <td>${money(p.amount)}</td><td>${tag(p.status)}</td>
         <td><button class="btn small ghost" data-items="${p.id}">查看</button></td>
         <td>${p.status === '待审批' ? `<button class="btn small" data-approve="${p.id}">审批</button>` : ''}
             ${p.status === '已审批' ? `<button class="btn small" data-receive="${p.id}">收货入库</button>` : ''}</td></tr>`))}</div>`;
  $('#fp-new').onclick = () => modal('新建采购申请', `${selectField('门店', 'po-store', boot.stores.map((s) => ({ v: s.id, t: s.name })))}
    ${field('供应商', 'po-supplier', '模拟医疗器械供应商')}
    <div class="section-title">采购明细（耗材 / 数量 / 单价）</div>
    ${boot.materials.slice(0, 3).map((m, i) => `<div class="flex" style="margin-bottom:8px"><span style="width:150px">${esc(m.name)}</span>
      <input type="number" class="po-qty" value="${i === 0 ? 5 : 0}" style="width:80px" data-material="${m.id}">
      <input type="number" class="po-price" value="80" style="width:90px"></div>`).join('')}`,
    async (b) => {
      const items = $$('.po-qty', b).map((inp) => ({ materialId: Number(inp.dataset.material), quantity: Number(inp.value),
        price: Number($('.po-price', inp.parentElement).value) })).filter((x) => x.quantity > 0);
      await api('/api/finance/purchases', 'POST', { storeId: Number($('#po-store', b).value), supplier: $('#po-supplier', b).value, items });
      toast('采购申请已提交'); await render();
    }, '提交申请');
  $$('[data-approve]').forEach((b) => b.onclick = async () => { await api(`/api/finance/purchases/${b.dataset.approve}/approve`, 'POST', { operatorId: 1 }); toast('已审批'); await render(); });
  $$('[data-receive]').forEach((b) => b.onclick = async () => { await api(`/api/finance/purchases/${b.dataset.receive}/receive`, 'POST', { operatorId: 3 }); toast('已验收入库'); await render(); });
  $$('[data-items]').forEach((b) => b.onclick = async () => {
    const items = await api(`/api/finance/purchases/${b.dataset.items}/items`);
    modal('采购单明细', table(['耗材', '规格', '数量', '单价', '金额'], items.map((it) =>
      `<tr><td>${esc(it.material_name)}</td><td>${esc(it.spec || '—')}</td><td>${it.quantity}</td>
       <td>${money(it.price)}</td><td>${money(it.quantity * it.price)}</td></tr>`)), async () => {}, '关闭');
  });
}

// 4) 利润核算
async function finProfit(el) {
  await aboot();
  const sid = $('#profit-store')?.value || '';
  const rows = await api(`/api/finance/profit?storeId=${sid}&month=${month()}`);
  el.innerHTML = `<h2>利润核算 <span class="module-tag">费用模块</span></h2>
    <div class="subtitle">利润 = 项目收入 − 项目成本 − 期间费用（房租水电等）</div>
    <div class="panel"><div class="toolbar">${storeSel('profit-store')}
      <button class="btn" id="profit-query">生成报表</button></div>
      <div class="formula">利润 = 收入 ${money(rows.income)} − 项目成本 ${money(rows.itemCost)} − 期间费用 ${money(rows.expense)} = ${money(rows.profit)}</div>
      <div class="kpi-row">
        <div class="kpi income"><div class="l">项目收入</div><div class="v">${money(rows.income)}</div></div>
        <div class="kpi cost"><div class="l">项目成本</div><div class="v">${money(rows.itemCost)}</div></div>
        <div class="kpi"><div class="l">期间费用</div><div class="v">${money(rows.expense)}</div></div>
        <div class="kpi"><div class="l">毛利</div><div class="v">${money(rows.gross)}</div></div>
        <div class="kpi profit"><div class="l">净利润</div><div class="v">${money(rows.profit)}</div></div>
      </div></div>
    <div class="panel"><h3>按项目收支</h3>${table(['项目', '收入', '成本', '毛利'], rows.byItem.map((i) =>
      `<tr><td>${esc(i.name)}</td><td>${money(i.income)}</td><td>${money(i.cost)}</td><td>${money(i.gross)}</td></tr>`))}</div>
    <div class="panel"><h3>期间费用明细</h3>${table(['类型', '金额'], rows.expenses.map((e) =>
      `<tr><td>${esc(e.type)}</td><td>${money(e.amount)}</td></tr>`))}</div>`;
  $('#profit-query').onclick = () => render();
}

// 5) 退款管理：申请（前台）+ 审批（负责人/院长），额度与幂等由服务端保证
async function finRefund(el) {
  const isApprover = AD.me.activeRole === '院长' || AD.me.activeRole === '负责人';
  const [bills, list] = await Promise.all([
    api('/api/refund/bills'), api('/api/refund/list'),
  ]);
  el.innerHTML = `<h2>退款管理 <span class="module-tag">费用模块</span></h2>
    <div class="subtitle">退款以原收费单实收为上限，累计退款不可超额；重复提交自动识别；需负责人或院长审批</div>
    <div class="panel"><h3>发起退款申请</h3>
      <div class="toolbar">
        <select id="rf-bill">${bills.map((b) => `<option value="${b.id}">#${b.id} ${esc(b.patient_name)} · ${esc(b.store_name)} · ${money(b.payable)}（${esc(String(b.paid_at).slice(0, 10))}）</option>`).join('')}</select>
        <input id="rf-amount" type="number" placeholder="退款金额" style="width:120px">
        <input id="rf-reason" placeholder="退款原因" style="width:180px">
        <button class="btn" id="rf-apply">提交申请</button>
      </div>
    </div>
    <div class="panel"><h3>退款记录（${list.length}）</h3>
      ${table(['单号', '收费单', '患者', '金额', '原因', '状态', '审批意见', '操作'], list.map((r) =>
        `<tr><td>#${r.id}</td><td>#${r.bill_id}</td><td>${esc(r.patient_name)}</td><td>${money(r.amount)}</td>
         <td>${esc(r.reason)}</td><td>${tag(r.status)}</td>
         <td>${esc((r.approvals || []).join('；') || '—')}</td>
         <td>${isApprover && r.status === '待审批' ? `<button class="btn small" data-rfa="${r.id}">通过</button>
             <button class="btn small ghost" data-rfr="${r.id}">驳回</button>` : '—'}</td></tr>`))}
    </div>`;
  $('#rf-apply').onclick = async () => {
    try {
      const r = await api('/api/refund/apply', 'POST', {
        billId: Number($('#rf-bill').value), amount: Number($('#rf-amount').value),
        reason: $('#rf-reason').value.trim(),
      });
      toast(r.message); await render();
    } catch (e) { toast(e.message, true); }
  };
  $$('[data-rfa]').forEach((b) => b.onclick = async () => {
    try { await api(`/api/refund/${b.dataset.rfa}/approve`, 'POST', { approve: true }); toast('退款已通过'); await render(); }
    catch (e) { toast(e.message, true); }
  });
  $$('[data-rfr]').forEach((b) => b.onclick = async () => {
    try { await api(`/api/refund/${b.dataset.rfr}/approve`, 'POST', { approve: false }); toast('已登记驳回'); await render(); }
    catch (e) { toast(e.message, true); }
  });
}

// ============ 绩效模块 ============

async function perfRank(el) {
  await aboot();
  const rows = await api(`/api/performance/ranking?storeId=${$('#perf-store')?.value || ''}&month=${month()}`);
  el.innerHTML = `<h2>医生绩效排名 <span class="module-tag">绩效模块</span></h2>
    <div class="subtitle">连锁范围统计，可按门店筛选；绩效 = 项目收入 × 提成比例（+ 售卡）</div>
    <div class="panel"><div class="toolbar">${storeSel('perf-store')}<button class="btn" id="perf-query">生成排名</button></div>
    ${table(['排名', '牙医', '所属门店', '接诊人次', '项目收入', '售卡数', '绩效金额'], rows.map((r, i) =>
      `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(storeName(r.storeId))}</td>
       <td>${r.visits}</td><td>${money(r.income)}</td><td>${r.cardSales}</td><td>${money(r.performance)}</td></tr>`))}</div>`;
  $('#perf-query').onclick = () => render();
}

async function perfStore(el) {
  const rows = await api(`/api/performance/stores?month=${month()}`);
  el.innerHTML = `<h2>门店绩效对比 <span class="module-tag">绩效模块</span></h2>
    <div class="subtitle">按门店聚合医生绩效，横向对比连锁各店</div>
    <div class="panel">${table(['门店', '牙医数', '接诊人次', '项目收入', '售卡数', '绩效合计'],
      rows.map((r) => `<tr><td>${esc(r.storeName)}</td><td>${r.dentists}</td><td>${r.visits}</td>
        <td>${money(r.income)}</td><td>${r.cardSales}</td><td>${money(r.performance)}</td></tr>`))}</div>`;
}

// ============ 前台运营 ============

async function opCheckin(el) {
  const boot = await aboot();
  el.innerHTML = `<h2>报到签到</h2><div class="subtitle">电子签到并分配椅位与候诊序号</div><div class="grid2">
    <div class="panel"><h3>按预约签到</h3>${field('患者手机号', 'ci-phone')}${field('或预约编号', 'ci-id', '', 'number')}
      ${selectField('门店', 'ci-store', boot.stores.map((s) => ({ v: s.id, t: s.name })))}
      <button class="btn" id="ci-ok">办理签到</button></div>
    <div class="panel"><h3>初诊直接到院</h3>${field('手机号', 'wi-phone')}
      ${selectField('门店', 'wi-store', boot.stores.map((s) => ({ v: s.id, t: s.name })))}
      ${selectField('接诊牙医', 'wi-dentist', boot.dentists.map((d) => ({ v: d.person_id, t: d.name })))}
      <button class="btn ghost" id="wi-ok">创建就诊记录</button></div></div>`;
  $('#ci-ok').onclick = async () => {
    const r = await api('/api/admin/checkin', 'POST', { phone: $('#ci-phone').value.trim(),
      appointmentId: Number($('#ci-id').value) || undefined, storeId: Number($('#ci-store').value) });
    toast(`签到成功，候诊序号 ${r.visit.queue_no}`);
  };
  $('#wi-ok').onclick = async () => {
    const r = await api('/api/admin/walkin', 'POST', { phone: $('#wi-phone').value.trim(),
      storeId: Number($('#wi-store').value), dentistId: Number($('#wi-dentist').value) });
    toast(`已创建就诊 #${r.id}，候诊序号 ${r.queue_no}`);
  };
}

async function opQueue(el) {
  const rows = await api('/api/admin/visits?status=待接诊');
  el.innerHTML = `<h2>候诊队列</h2><div class="subtitle">候诊大屏队列（模拟自动更新）</div>
    <div class="panel">${table(['就诊号', '患者', '牙医', '门店', '椅位', '序号', '状态'], rows.map((r) =>
      `<tr><td>#${r.id}</td><td>${esc(r.patient_name)}</td><td>${esc(r.dentist_name || '待分配')}</td>
       <td>${esc(r.store_name)}</td><td>${esc(r.chair_id || '待分配')}</td><td>${r.queue_no}</td><td>${tag(r.status)}</td></tr>`))}</div>`;
}

async function opSettle(el) {
  const boot = await aboot();
  const rows = await api('/api/admin/visits?status=待结算');
  const cards = await api('/api/admin/cards');
  el.innerHTML = `<h2>收费结算</h2><div class="subtitle">应收 = 挂号费 + 处方金额，支持套餐抵扣</div>
    <div class="panel">${table(['就诊号', '患者', '门店', '状态', ''], rows.map((r) =>
      `<tr><td>#${r.id}</td><td>${esc(r.patient_name)}</td><td>${esc(r.store_name)}</td><td>${tag(r.status)}</td>
       <td><button class="btn small" data-settle="${r.id}">结算</button></td></tr>`))}</div>`;
  $$('[data-settle]').forEach((b) => b.onclick = () => {
    const v = rows.find((x) => x.id === Number(b.dataset.settle));
    const usable = cards.filter((c) => c.patient_id === v.patient_id && c.status === '有效' && c.remain_times > 0);
    modal(`结算 · 就诊 #${v.id}`, `${selectField('收款方式', 's-method', ['微信', '现金', '支付宝'].map((t) => ({ v: t, t })))}
      ${selectField('套餐卡抵扣', 's-card', [{ v: '', t: '不使用' }, ...usable.map((c) => ({ v: c.id, t: `${c.card_no} 余${c.remain_times}次` }))])}`,
      async (body) => {
        const bill = await api(`/api/admin/visits/${v.id}/settle`, 'POST', { paymentMethod: $('#s-method', body).value,
          packageCardId: Number($('#s-card', body).value) || null });
        toast(`结算成功，应收 ${money(bill.payable)}`); await render();
      }, '确认收款');
  });
}

async function opFollow(el) {
  const rows = await api('/api/admin/followups');
  el.innerHTML = `<h2>随访工作台</h2><div class="subtitle">到期提醒自动推送，前台按待办清单电话回访</div>
    <div class="panel">${table(['患者', '电话', '门店', '到期日', '推送状态', '回访结果', ''], rows.map((r) =>
      `<tr><td>${esc(r.patient_name)}</td><td>${esc(r.phone)}</td><td>${esc(r.store_name)}</td><td>${r.due_date}</td>
       <td>${tag(r.send_status)}</td><td>${esc(r.callback_result || '—')}</td>
       <td><button class="btn small ghost" data-call="${r.id}">登记回访</button></td></tr>`))}</div>`;
  $$('[data-call]').forEach((b) => b.onclick = () => modal('登记回访结果',
    `${selectField('回访结果', 'cb-result', ['已预约复诊', '到院复诊', '暂不需要', '流失'].map((t) => ({ v: t, t })))}`,
    async (body) => { await api(`/api/admin/followups/${b.dataset.call}/result`, 'POST', { result: $('#cb-result', body).value }); toast('回访已登记'); await render(); }));
}

// ============ 院长管理 ============

async function mgrDash(el) {
  const boot = await aboot();
  const d = boot.dashboard;
  el.innerHTML = `<h2>经营驾驶舱</h2><div class="subtitle">汇总关键经营指标</div>
    <div class="kpi-row">
      ${[['门店数', d.stores], ['患者数', d.patients], ['牙医数', d.dentists], ['待就诊预约', d.appointments],
         ['待接诊', d.visits], ['低库存预警', d.lowStock], ['待发复诊提醒', d.due]].map(([k, v]) =>
        `<div class="kpi"><div class="l">${k}</div><div class="v">${v}</div></div>`).join('')}</div>
    <div class="panel" style="margin-top:16px"><h3>快捷入口</h3>
      <div class="flex"><button class="btn ghost" id="q-profit">查看利润核算</button>
      <button class="btn ghost" id="q-perf">查看医生绩效</button>
      <button class="btn ghost" id="q-worker">运行复诊提醒任务</button></div></div>`;
  $('#q-profit').onclick = () => { AD.page = 'fin-profit'; render(); };
  $('#q-perf').onclick = () => { AD.page = 'perf-rank'; render(); };
  $('#q-worker').onclick = async () => { const r = await api('/api/admin/worker/run', 'POST', {}); toast(`已处理 ${r.processed} 条复诊提醒`); };
}

async function mgrSchedule(el) {
  const boot = await aboot();
  const rows = await api('/api/admin/schedules');
  el.innerHTML = `<h2>排班与椅位</h2><div class="subtitle">号源 = 排班 × 椅位；同一牙医同一时段唯一，跨诊所不可冲突</div>
    <div class="panel"><button class="btn" id="sc-new">+ 新增排班</button>
      ${table(['编号', '门店', '牙医', '椅位', '日期', '时段', '号源', '已锁定'], rows.slice(0, 60).map((r) =>
        `<tr><td>${r.id}</td><td>${esc(storeName(r.store_id))}</td><td>${esc(r.dentist_name)}</td>
         <td>${esc(r.chair_code)}</td><td>${r.work_date}</td><td>${r.slot}</td><td>${r.quota}</td><td>${r.locked}</td></tr>`))}</div>`;
  $('#sc-new').onclick = () => modal('新增排班',
    `${selectField('牙医', 'sc-dentist', boot.dentists.map((d) => ({ v: d.person_id, t: d.name })))}
     ${selectField('门店', 'sc-store', boot.stores.map((s) => ({ v: s.id, t: s.name })))}
     ${selectField('椅位', 'sc-chair', boot.chairs.map((c) => ({ v: c.id, t: `${c.code} · ${c.store_name}` })))}
     ${field('日期', 'sc-date', todayStr(), 'date')}${field('时段', 'sc-slot', '09:00')}${field('号源上限', 'sc-quota', '1', 'number')}`,
    async (b) => {
      await api('/api/admin/schedules', 'POST', { dentistId: Number($('#sc-dentist', b).value), storeId: Number($('#sc-store', b).value),
        chairId: Number($('#sc-chair', b).value), date: $('#sc-date', b).value, slot: $('#sc-slot', b).value, quota: Number($('#sc-quota', b).value) });
      toast('排班已发布'); await render();
    });
}

async function mgrPackage(el) {
  const boot = await aboot();
  const rows = await api('/api/admin/packages');
  el.innerHTML = `<h2>套餐目录</h2><div class="subtitle">同一档位同时只允许一个在售套餐；已售卡不受目录调价影响</div>
    <div class="panel"><button class="btn" id="pkg-new">+ 新增套餐</button>
      ${table(['编号', '档位', '名称', '价格', '有效月数', '总次数', '状态', ''], rows.map((p) =>
        `<tr><td>${p.id}</td><td>${p.tier}</td><td>${esc(p.name)}</td><td>${money(p.price)}</td>
         <td>${p.valid_months}</td><td>${p.total_times}</td><td>${tag(p.status)}</td>
         <td><button class="btn small ghost" data-sell="${p.id}">售卡</button></td></tr>`))}</div>`;
  $('#pkg-new').onclick = () => {
    modal('新增套餐', `${selectField('档位', 'p-tier', ['低', '中', '高'].map((t) => ({ v: t, t })))}
      ${field('名称', 'p-name')}${field('价格', 'p-price', '', 'number')}
      ${field('有效月数', 'p-months', 12, 'number')}${field('总次数', 'p-times', 3, 'number')}`,
      async (b) => {
        await api('/api/admin/packages', 'POST', { tier: $('#p-tier', b).value, name: $('#p-name', b).value,
          price: Number($('#p-price', b).value), validMonths: Number($('#p-months', b).value), totalTimes: Number($('#p-times', b).value) });
        toast('套餐已创建'); await render();
      });
  };
  $$('[data-sell]').forEach((b) => b.onclick = () => {
    modal('销售套餐卡', `${field('患者手机号', 'sc-phone')}${selectField('门店', 'sc-store', boot.stores.map((s) => ({ v: s.id, t: s.name })))}`,
      async (bd) => {
        const r = await api('/api/admin/cards', 'POST', { phone: $('#sc-phone', bd).value.trim(),
          packageId: Number(b.dataset.sell), storeId: Number($('#sc-store', bd).value), soldBy: 2 });
        toast(`售卡成功，卡号 ${r.card_no}`);
      });
  });
}

async function mgrPatient(el) {
  await aboot();
  const rows = await api('/api/admin/patients');
  el.innerHTML = `<h2>患者档案</h2><div class="subtitle">全部为模拟患者数据</div>
    <div class="panel"><button class="btn" id="pat-new">+ 新建患者</button>
      ${table(['编号', '姓名', '性别', '电话', '过敏史', '病史', '会员等级'], rows.map((p) =>
        `<tr><td>${p.person_id}</td><td>${esc(p.name)}</td><td>${esc(p.gender || '—')}</td><td>${esc(p.phone)}</td>
         <td class="${p.allergy && p.allergy !== '无' ? 'badge-warn' : ''}">${esc(p.allergy || '—')}</td>
         <td>${esc(p.medical_history || '—')}</td><td>${esc(p.member_level)}</td></tr>`))}</div>`;
  $('#pat-new').onclick = () => modal('新建患者', `${field('姓名', 'np-name')}${field('手机号', 'np-phone')}
    ${selectField('性别', 'np-gender', ['男', '女', '其他'].map((g) => ({ v: g, t: g })))}
    ${field('过敏史', 'np-allergy', '无')}`,
    async (b) => {
      await api('/api/admin/patients', 'POST', { name: $('#np-name', b).value, phone: $('#np-phone', b).value,
        gender: $('#np-gender', b).value, allergy: $('#np-allergy', b).value });
      toast('患者已建档'); await render();
    });
}

// ============ 库房 ============

async function stockList(el) {
  await aboot();
  el.innerHTML = `<h2>库存台账</h2><div class="subtitle">低于安全库存自动预警</div>
    <div class="panel">${table(['编号', '品项', '规格', '单位', '当前库存', '安全库存', '门店', ''], AD.boot.materials.map((m) =>
      `<tr><td>${m.id}</td><td>${esc(m.name)}</td><td>${esc(m.spec)}</td><td>${esc(m.unit)}</td>
       <td class="${m.current_stock < m.safety_stock ? 'badge-warn' : ''}">${m.current_stock}</td>
       <td>${m.safety_stock}</td><td>${esc(m.store_name)}</td>
       <td><button class="btn small ghost" data-issue="${m.id}">领用</button></td></tr>`))}</div>`;
  $$('[data-issue]').forEach((b) => b.onclick = () => {
    const m = AD.boot.materials.find((x) => x.id === Number(b.dataset.issue));
    modal(`领用 · ${m.name}`, `${field('数量', 'is-qty', '1', 'number')}${field('关联患者编号', 'is-patient', '', 'number')}`,
      async (body) => {
        const r = await api('/api/admin/stock/issue', 'POST', { materialId: m.id, storeId: m.store_id,
          quantity: Number($('#is-qty', body).value), patientId: Number($('#is-patient', body).value) || null, operatorId: 4 });
        toast(r.lowStock ? '领用成功，已触发低库存预警' : '领用成功'); await render();
      });
  });
}

async function stockPurchase(el) { await finPurchase(el); }

// ============ 医生临时借调（负责人 / 院长）============

async function mgrTransfer(el) {
  const boot = await aboot();
  const rows = await api('/api/transfer/list');
  const dentists = await api('/api/transfer/dentists');
  el.innerHTML = `<h2>医生临时借调 <span class="module-tag">负责人 / 院长</span></h2>
    <div class="subtitle">短期跨门店支援：申请 → 负责人或院长任一通过即生效 → 自动在目标门店生成排班；两方均不通过才驳回</div>
    <div class="panel"><div class="toolbar"><button class="btn" id="tf-new">+ 发起借调</button></div>
      ${table(['单号', '牙医', '原门店', '目标门店', '起止日期', '事由', '状态', '审批意见', '操作'], rows.map((r) =>
        `<tr><td>#${r.id}</td><td>${esc(r.dentist_name)}</td><td>${esc(r.from_store)}</td>
         <td>${esc(r.to_store)}</td><td>${r.start_date} ~ ${r.end_date}</td><td>${esc(r.reason || '—')}</td>
         <td>${tag(r.status)}</td><td>${esc((r.approvals || []).join('；') || '—')}</td>
         <td>${r.status === '待审批' ? `<button class="btn small" data-ap="${r.id}">通过</button>
             <button class="btn small ghost" data-rj="${r.id}">不通过</button>` : ''}
             ${r.status === '已批准' ? `<button class="btn small ghost" data-fin="${r.id}">结束借调</button>` : ''}</td></tr>`))}</div>`;
  $('#tf-new').onclick = () => modal('发起临时借调',
    `${selectField('牙医', 'tf-dentist', dentists.map((d) => ({ v: d.person_id, t: `${d.name}（${d.store_name}）` })))}
     ${selectField('目标门店', 'tf-to', boot.stores.map((s) => ({ v: s.id, t: s.name })))}
     ${field('开始日期', 'tf-start', todayStr(), 'date')}${field('结束日期', 'tf-end', todayStr(), 'date')}
     ${field('事由', 'tf-reason', '短期支援')}
     <div class="muted">原门店自动取牙医所属门店；目标门店排班将在审批通过后自动生成。</div>`,
    async (b) => {
      const d = dentists.find((x) => x.person_id === Number($('#tf-dentist', b).value));
      await api('/api/transfer/apply', 'POST', { dentistId: d.person_id, fromStoreId: d.store_id,
        toStoreId: Number($('#tf-to', b).value), startDate: $('#tf-start', b).value, endDate: $('#tf-end', b).value,
        reason: $('#tf-reason', b).value, applicantId: AD.me.personId });
      toast('借调申请已提交'); await render();
    }, '提交申请');
  $$('[data-ap]').forEach((b) => b.onclick = async () => {
    const r = await api(`/api/transfer/${b.dataset.ap}/approve`, 'POST', { approve: true });
    toast(`审批通过，生成排班 ${r.schedulesCreated} 条`); await render();
  });
  $$('[data-rj]').forEach((b) => b.onclick = async () => {
    const r = await api(`/api/transfer/${b.dataset.rj}/approve`, 'POST', { approve: false });
    toast(r.message); await render();
  });
  $$('[data-fin]').forEach((b) => b.onclick = async () => {
    await api(`/api/transfer/${b.dataset.fin}/finish`, 'POST', {});
    toast('借调已结束，未锁定排班已释放'); await render();
  });
}

// ============ 账号审批（负责人 / 院长）============

async function mgrAccounts(el) {
  const [pending, all] = await Promise.all([
    api('/api/auth/staff/pending'), api('/api/auth/staff/list'),
  ]);
  el.innerHTML = `<h2>账号审批 <span class="module-tag">负责人 / 院长</span></h2>
    <div class="subtitle">员工注册后为「待审批」；分院负责人或院长任一方通过即开通，两方均不通过才拒绝。账号开通后才能登录</div>
    <div class="panel"><h3>待审批（${pending.length}）</h3>
      ${table(['姓名', '手机号', '工号', '岗位', '角色', '审批意见', '申请时间', '操作'], pending.map((p) =>
        `<tr><td>${esc(p.name)}</td><td>${esc(p.phone)}</td><td>${esc(p.staff_no)}</td>
         <td>${esc(p.role)}</td><td>${esc(p.roles || '—')}</td>
         <td>${esc((p.approvals || []).join('；') || '—')}</td>
         <td>${esc(String(p.created_at).slice(0, 10))}</td>
         <td><button class="btn small" data-ok="${p.id}">通过</button>
             <button class="btn small ghost" data-no="${p.id}">不通过</button></td></tr>`))}</div>
    <div class="panel"><h3>全部员工</h3>
      ${table(['工号', '姓名', '手机号', '岗位', '拥有角色', '状态'], all.map((p) =>
        `<tr><td>${esc(p.staff_no)}</td><td>${esc(p.name)}</td><td>${esc(p.phone)}</td>
         <td>${esc(p.role)}</td><td>${esc(p.roles || '—')}</td><td>${tag(p.account_status)}</td></tr>`))}</div>`;
  $$('[data-ok]').forEach((b) => b.onclick = async () => {
    const r = await api('/api/auth/staff/approve', 'POST', { id: Number(b.dataset.ok), status: '已开通' });
    toast(r.message); await render();
  });
  $$('[data-no]').forEach((b) => b.onclick = async () => {
    const r = await api('/api/auth/staff/approve', 'POST', { id: Number(b.dataset.no), status: '已停用' });
    toast(r.message); await render();
  });
}

// ============ 初始化 ============

(async function init() {
  const main = amain();
  const stage = (text) => { main.innerHTML = `<div class="panel"><div class="empty">${esc(text)}</div></div>`; };
  stage('正在校验登录状态…');
  const timer = setTimeout(() => {
    main.innerHTML = '<div class="panel"><div class="empty">加载超时，请重新登录。<br><a href="/staff.html" style="color:var(--brand)">返回工作人员登录</a></div></div>';
  }, 9000);
  try {
    AD.me = await requireStaff(['院长', '负责人', '前台', '库管员'], stage);
    if (!AD.me) return;
    stage('正在加载经营数据…');
    $('#who').textContent = `${AD.me.name} · ${AD.me.activeRole}`;
    const switchable = AD.me.roles.filter((r) => r !== '护士');
    if (switchable.length > 1) {
      const btn = $('#switch-role');
      const target = switchable.find((r) => r !== AD.me.activeRole) || switchable[0];
      btn.style.display = '';
      btn.textContent = `切换为${target === '牙医' ? '医生' : target}身份`;
      btn.onclick = async () => {
        await api('/api/auth/staff/switch-role', 'POST', { role: target });
        goStaffPage(target === '牙医' ? '/dentist.html' : '/admin.html');
      };
    }
    $('#logout').onclick = async () => { await api('/api/auth/staff/logout', 'POST', {}); setStaffSession(null); goPage('/staff.html'); };
    bindChangePassword();
    $('#global-month').value = monthStr();
    $('#global-month').onchange = () => render();
    AD.page = visibleGroups()[0]?.items[0][0] || 'mgr-dash';
    stage('正在渲染页面…');
    await render();
    clearTimeout(timer);
  } catch (e) {
    clearTimeout(timer);
    amain().innerHTML = `<div class="panel"><div class="empty">页面初始化失败：${esc(e.message)}<br>
      <a href="/staff.html" style="color:var(--brand)">返回工作人员登录</a></div></div>`;
  }
})();
