// 牙医工作站：我的候诊、病历处方、治疗计划
const DN = { page: 'queue', boot: null, dentistId: 0 };
const NAV = [['queue', '我的候诊'], ['rx', '病历与处方'], ['plans', '治疗计划'], ['stats', '我的统计']];
const dmain = () => $('#main');

async function dBoot() { if (!DN.boot) DN.boot = await api('/api/dentist/bootstrap'); return DN.boot; }

function dRenderNav() {
  const me = DN.boot?.dentists.find((d) => d.person_id === DN.dentistId);
  $('#sidebar').innerHTML = `<div class="muted" style="padding:6px 14px 12px">当前登录医生</div>
    <div class="panel" style="padding:10px 12px;margin:0 0 14px">
      <b style="font-size:14px">${me ? esc(me.name) : '加载中…'}</b>
      <div class="muted">${me ? esc(me.title || '') + ' · ' + esc(me.specialty || '') + ' · ' + esc(me.store_name) : ''}</div>
    </div>
    ${NAV.map(([k, l]) => `<button class="nav-item ${DN.page === k ? 'active' : ''}" data-page="${k}">${l}</button>`).join('')}`;
  $$('.nav-item').forEach((b) => b.onclick = () => { DN.page = b.dataset.page; dRender(); });
}

async function dRender() {
  dRenderNav();
  const el = dmain();
  el.innerHTML = '<div class="empty">加载中…</div>';
  try { await ({ queue: dQueue, rx: dRx, plans: dPlans, stats: dStats })[DN.page](el); }
  catch (e) { el.innerHTML = `<div class="panel"><div class="empty">${esc(e.message)}</div></div>`; }
}

async function dQueue(el) {
  const boot = await dBoot();
  if (!DN.dentistId) DN.dentistId = boot.dentists[0].person_id;
  const rows = await api(`/api/dentist/queue?dentistId=${DN.dentistId}`);
  el.innerHTML = `<h2>我的候诊队列</h2><div class="subtitle">书写病历、开具处方；处方金额由项目价目自动计算</div>
    <div class="panel">${table(['序号', '患者', '性别', '过敏史', '主诉', '椅位', '状态', ''], rows.map((r) =>
      `<tr><td>${r.queue_no}</td><td>${esc(r.patient_name)}</td><td>${esc(r.gender || '—')}</td>
       <td class="${r.allergy && r.allergy !== '无' ? 'badge-warn' : ''}">${esc(r.allergy || '—')}</td>
       <td>${esc(r.complaint || '—')}</td><td>${esc(r.chair_code || '待分配')}</td><td>${tag(r.status)}</td>
       <td><button class="btn small" data-treat="${r.id}">接诊开方</button></td></tr>`))}</div>`;
  $$('[data-treat]').forEach((b) => b.onclick = () => openRx(rows.find((x) => x.id === Number(b.dataset.treat))));
}

function openRx(v) {
  const checks = DN.boot.items.map((i) =>
    `<label style="display:inline-flex;gap:5px;align-items:center;margin:5px 14px 5px 0"><input type="checkbox" class="rx-item" value="${i.id}"> ${esc(i.name)} ${money(i.price)}</label>`).join('');
  modal(`接诊 · ${v.patient_name}`, `${field('主诉', 'rx-complaint', v.complaint || '')}
    ${field('检查', 'rx-exam')}${field('诊断', 'rx-diagnosis')}${field('医嘱', 'rx-advice')}
    ${field('复诊间隔（天）', 'rx-days', '90', 'number')}
    <div class="section-title">处方项目（数量默认 1）</div><div>${checks}</div>`,
    async (body) => {
      const items = $$('.rx-item', body).filter((x) => x.checked).map((x) => ({ itemId: Number(x.value), quantity: 1 }));
      if (!items.length) throw new Error('请至少选择一个处方项目');
      const r = await api(`/api/dentist/visits/${v.id}/record`, 'POST', {
        complaint: $('#rx-complaint', body).value, exam: $('#rx-exam', body).value,
        diagnosis: $('#rx-diagnosis', body).value, advice: $('#rx-advice', body).value,
        recallDays: Number($('#rx-days', body).value) || 90, items });
      toast(`病历已保存，处方金额 ${money(r.total)}；过敏提示：${r.allergyAlert}`); await dRender();
    }, '保存病历并开方');
}

async function dRx(el) {
  const rows = await api(`/api/dentist/prescriptions?dentistId=${DN.dentistId}`);
  el.innerHTML = `<h2>病历与处方</h2><div class="subtitle">该牙医开具的历史处方，点击任意一行查看患者信息与处方明细</div>
    <div class="panel">${table(['处方号', '患者', '就诊号', '金额', '开方时间', ''], rows.map((r) =>
      `<tr class="clickable" data-rx="${r.id}" style="cursor:pointer"><td>#${r.id}</td><td>${esc(r.patient_name)}</td><td>#${r.visit_id}</td><td>${money(r.total_amount)}</td>
       <td>${String(r.created_at).slice(0, 16).replace('T', ' ')}</td><td><button class="btn small ghost">查看详情</button></td></tr>`))}</div>`;
  $$('[data-rx]').forEach((tr) => tr.onclick = () => openRxDetail(Number(tr.dataset.rx)));
}

async function openRxDetail(id) {
  try {
    const r = await api(`/api/dentist/prescriptions/${id}`);
    const info = `<div class="rx-detail-grid">
      <div><span class="muted">处方号</span><b>#${r.id}</b></div>
      <div><span class="muted">患者</span><b>${esc(r.patient_name)}</b></div>
      <div><span class="muted">性别 / 出生</span><b>${esc(r.gender || '—')} ${esc(r.birth_date || '')}</b></div>
      <div><span class="muted">过敏史</span><b class="${r.allergy && r.allergy !== '无' ? 'badge-warn' : ''}">${esc(r.allergy || '无')}</b></div>
      <div><span class="muted">既往病史</span><b>${esc(r.medical_history || '无')}</b></div>
      <div><span class="muted">门店</span><b>${esc(r.store_name || '—')}</b></div>
      <div><span class="muted">就诊号 / 到院</span><b>#${r.visit_id} ${String(r.arrived_at || '').slice(0, 16).replace('T', ' ')}</b></div>
      <div><span class="muted">处方金额</span><b>${money(r.total_amount)}</b></div>
    </div>
    <div class="section-title">主诉 / 检查 / 诊断 / 医嘱</div>
    <div class="rx-note"><b>主诉：</b>${esc(r.complaint || '—')}<br><b>检查：</b>${esc(r.exam || '—')}<br>
      <b>诊断：</b>${esc(r.diagnosis || '—')}<br><b>医嘱：</b>${esc(r.advice || '—')}</div>
    <div class="section-title">处方明细</div>
    ${table(['项目', '类别', '数量', '单价金额'], (r.items || []).map((it) =>
      `<tr><td>${esc(it.item_name)}</td><td>${esc(it.category || '—')}</td><td>${it.quantity}</td><td>${money(it.amount)}</td></tr>`))}`;
    modal(`处方 #${r.id} · ${r.patient_name}`, info, async () => {}, '关闭');
  } catch (e) { toast(e.message, true); }
}

async function dPlans(el) {
  const boot = await dBoot();
  const rows = await api(`/api/dentist/plans?dentistId=${DN.dentistId}`);
  el.innerHTML = `<h2>治疗计划</h2><div class="subtitle">正畸、种植等长疗程分次治疗</div>
    <div class="panel"><button class="btn" id="dp-new">新建治疗计划</button>
    ${table(['计划号', '患者', '门店', '总费用', '期数', '状态', ''], rows.map((r) =>
      `<tr><td>#${r.id}</td><td>${esc(r.patient_name)}</td><td>${esc(r.store_name)}</td><td>${money(r.total_amount)}</td>
       <td>${r.periods}</td><td>${tag(r.status)}</td><td><button class="btn small ghost" data-plan="${r.id}">明细</button></td></tr>`))}</div>`;
  $('#dp-new').onclick = () => {
    const opts = boot.items.map((i) => `<option value="${i.id}" data-price="${i.price}">${esc(i.name)} · ${money(i.price)}</option>`).join('');
    const rowHtml = (idx) => `<div class="plan-row flex" style="margin-bottom:8px;gap:6px;align-items:center">
      <input type="number" min="1" value="${idx}" class="p-period" style="width:56px" title="期次">
      <select class="p-item" style="min-width:200px;flex:1">${opts}</select>
      <input type="date" class="p-date"><input type="number" class="p-est" value="0" style="width:92px" title="预计金额">
      <button type="button" class="btn small ghost p-del">删除</button></div>`;
    modal('新建治疗计划', `${field('患者手机号', 'dp-phone-in', '', 'text')}
      ${field('患者姓名（新患者）', 'dp-name')}
      ${selectField('门店', 'dp-store', boot.dentists.filter((d) => d.person_id === DN.dentistId).map((d) => ({ v: d.store_id, t: d.store_name })))}
      <div class="hint" style="margin:6px 0">按类别选择诊疗项目；正畸、种植等不同方案收费不同，金额可调整。</div>
      <div class="section-title">计划项（期次 / 项目 / 日期 / 预计金额）</div>
      <div id="plan-rows">${rowHtml(1)}</div>
      <button type="button" class="btn small ghost" id="plan-add" style="margin-top:6px">+ 添加一期</button>`,
      async (body) => {
        const items = $$('.plan-row', body).map((row, idx) => {
          const sel = $('.p-item', row); const opt = sel.options[sel.selectedIndex];
          return { period: Number($('.p-period', row).value) || idx + 1,
            itemId: Number(sel.value), planDate: $('.p-date', row).value || null,
            estimate: Number($('.p-est', row).value) || 0, itemName: opt.text };
        });
        if (!items.length) throw new Error('请至少添加一期计划');
        const phone = $('#dp-phone-in', body).value.trim();
        if (!phone) throw new Error('请填写患者手机号');
        const patients = await api('/api/admin/patients?phone=' + encodeURIComponent(phone));
        let patientId;
        if (patients.length) patientId = patients[0].person_id;
        else {
          if (!$('#dp-name', body).value.trim()) throw new Error('新患者请填写姓名');
          const p = await api('/api/admin/patients', 'POST', { phone, name: $('#dp-name', body).value.trim() });
          patientId = p.id;
        }
        await api('/api/dentist/plans', 'POST', { patientId, dentistId: DN.dentistId,
          storeId: Number($('#dp-store', body).value), items });
        toast('治疗计划已保存'); await dRender();
      }, '保存计划');
    // 绑定动态加行 / 删行 / 项目联动金额
    const rowsBox = $('#plan-rows'); const addBtn = $('#plan-add');
    const bindRow = (row) => {
      $('.p-item', row).onchange = (e) => { $('.p-est', row).value = e.target.options[e.target.selectedIndex].dataset.price || 0; };
      $('.p-del', row).onclick = () => { if ($$('.plan-row', rowsBox).length > 1) row.remove(); else toast('至少保留一期', true); };
    };
    $$('.plan-row', rowsBox).forEach(bindRow);
    addBtn.onclick = () => { const n = $$('.plan-row', rowsBox).length + 1; rowsBox.insertAdjacentHTML('beforeend', rowHtml(n)); bindRow(rowsBox.lastElementChild); };
  };
  $$('[data-plan]').forEach((b) => b.onclick = async () => {
    const items = await api(`/api/dentist/plans/${b.dataset.plan}`);
    const total = items.reduce((s, it) => s + Number(it.estimate || 0), 0);
    modal('治疗计划期次明细', `${table(['期次', '项目', '计划日期', '预计金额', '状态'], items.map((it) =>
      `<tr><td>${it.period}</td><td>${esc(it.item_name)}</td><td>${esc(it.plan_date || '—')}</td>
       <td>${money(it.estimate)}</td><td>${tag(it.status)}</td></tr>`))}
      <div class="section-title">合计 ${money(total)}</div>`,
      async () => {}, '关闭');
  });
}

async function dStats(el) {
  const r = await api(`/api/dentist/stats?dentistId=${DN.dentistId}`);
  el.innerHTML = `<h2>我的统计</h2><div class="subtitle">当月接诊量</div>
    <div class="cards"><div class="card"><div class="label">统计月份</div><div class="value" style="font-size:18px">${r.month}</div></div>
    <div class="card"><div class="label">本月接诊人次</div><div class="value">${r.visits}</div></div></div>`;
}

(async function init() {
  try {
    const me = await requireStaff(['牙医']);
    DN.dentistId = me.personId; // 固定为登录医生，不能替他人开方
    document.querySelector('#who').textContent = `${me.name} · 牙医`;
    const sw = $('#switch-role');
    if (me.roles.includes('院长')) {
      sw.style.display = ''; sw.textContent = '切换为院长身份';
      sw.onclick = async () => { await api('/api/auth/staff/switch-role', 'POST', { role: '院长' }); goStaffPage('/admin.html'); };
    }
    $('#logout').onclick = async () => { await api('/api/auth/staff/logout', 'POST', {}); setStaffSession(null); goPage('/staff.html'); };
    bindChangePassword();
    await dBoot();
    await dRender();
  } catch (e) {
    $('#main').innerHTML = `<div class="panel"><div class="empty">${esc(e.message)}<br>
      <a href="/staff.html" style="color:var(--brand)">返回工作人员登录</a></div></div>`;
  }
})();
