// 前端公共工具：所有端共用
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const money = (v) => '¥' + Number(v || 0).toFixed(2);
const esc = (s) => String(s ?? '').replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthStr = () => new Date().toISOString().slice(0, 7);
const tag = (s) => {
  const cls = ({ '待就诊': '', '已到院': 'green', '已完成': 'gray', '已取消': 'red', '待接诊': 'orange', '待结算': 'orange',
    '待发送': 'orange', '已发送': 'green', '有效': 'green', '已用完': 'gray', '待审批': 'orange', '已审批': '', '已收货': 'green',
    '待审批': 'orange', '已驳回': 'red', '已结束': 'gray',
    '进行中': 'green', '已终止': 'red', '草稿': 'gray', '在售': 'green', '停售': 'gray',
    '待开通': 'orange', '已开通': 'green', '已停用': 'red' })[s] || 'gray';
  return `<span class="tag ${cls}">${esc(s)}</span>`;
};

// ===== 会话：员工 / 患者各自独立令牌 =====
// 同时写入 localStorage 与 sessionStorage：部分预览面板在页面跳转时会重置 localStorage，
// 双备份可避免登录后跳转工作台时令牌丢失而反复跳回登录页。
// 预览面板的沙箱可能禁止访问某个 storage，必须用安全 getter 逐个尝试，
// 不能直接写 [sessionStorage, localStorage]，否则取值时就会抛错导致页面停在“加载中”。
const safeStores = () => {
  const list = [];
  try { if (window.sessionStorage) list.push(window.sessionStorage); } catch {}
  try { if (window.localStorage) list.push(window.localStorage); } catch {}
  return list;
};
const readSession = (key) => {
  try {
    for (const store of safeStores()) {
      try { const raw = store.getItem(key); if (raw) return JSON.parse(raw); } catch {}
    }
  } catch {}
  return null;
};
const writeSession = (key, s) => {
  const value = s ? JSON.stringify(s) : null;
  for (const store of safeStores()) {
    try { if (value) store.setItem(key, value); else store.removeItem(key); } catch {}
  }
};
const staffSession = () => readSession('xy_staff');
const setStaffSession = (s) => writeSession('xy_staff', s);
const patientSession = () => readSession('xy_patient');
const setPatientSession = (s) => writeSession('xy_patient', s);
// 所有内部跳转都带版本号，避免浏览器沿用旧页面/旧脚本缓存。
const PAGE_VER = 'v=6';
const withVer = (path) => path.includes('?') ? path : `${path}?${PAGE_VER}`;
const goPage = (path) => {
  const p = withVer(path);
  if (location.pathname + location.search !== p) location.replace(p);
};
// 工作台之间跳转：令牌放在 hash（#staffToken=...），预览面板不会截掉 hash，
// 也不会把令牌发到服务器。目标页读取后写回会话存储。
const goStaffPage = (path) => {
  const p = withVer(path);
  const t = staffSession()?.token;
  location.replace(t ? `${p}#staffToken=${encodeURIComponent(t)}` : p);
};
const urlStaffToken = () => {
  try {
    const m = String(location.hash || '').match(/staffToken=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    const q = new URL(location.href).searchParams.get('staffToken');
    return q || '';
  } catch { return ''; }
};
(function adoptStaffToken() {
  const t = urlStaffToken();
  if (!t) return;
  writeSession('xy_staff', { ...(staffSession() || {}), token: t });
  try { history.replaceState({}, '', location.pathname + location.search); } catch {}
})();

async function api(path, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json' };
  const st = staffSession(); const pt = patientSession();
  const staffToken = st?.token || urlStaffToken();
  if (staffToken) headers['x-session-token'] = staffToken;
  if (pt?.token) headers['x-patient-token'] = pt.token;
  // 预览沙箱里 fetch 可能挂起不返回，加超时避免页面永远停在“加载中”。
  let ctrl = null, timer = null;
  try {
    if (typeof AbortController !== 'undefined') {
      ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort(), 6000);
    }
    const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined,
      ...(ctrl ? { signal: ctrl.signal } : {}) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || '请求失败');
    return j.data;
  } catch (e) {
    if (ctrl?.signal.aborted) throw new Error(`请求超时：${path}`);
    throw e;
  } finally { if (timer) clearTimeout(timer); }
}

// 进入工作台前校验员工登录。
// 重要：校验失败只抛错，由当前页面显示提示，不再自动跳回 staff.html——
// 否则 staff.html 的自动登录又会跳回来，两个页面互相跳转造成"屏闪死循环"。
async function requireStaff(allowedRoles, onStage) {
  onStage?.('读取登录会话…');
  const urlToken = urlStaffToken();
  const s = staffSession();
  const token = s?.token || urlToken; // 存储不可用时直接用地址栏令牌校验
  if (!token) throw new Error('未登录，请到工作人员登录页重新登录');
  if (urlToken && !s?.token) writeSession('xy_staff', { token: urlToken });
  onStage?.('请求身份信息…');
  const me = await api('/api/auth/staff/me');
  onStage?.('身份校验完成，加载数据…');
  if (allowedRoles && !allowedRoles.includes(me.activeRole)) {
    throw new Error(`当前身份「${me.activeRole}」不能进入此工作台`);
  }
  return me;
}

function toast(msg, error = false) {
  const root = $('#toast-root');
  if (!root) return;
  root.innerHTML = `<div class="toast ${error ? 'error' : ''}">${esc(msg)}</div>`;
  setTimeout(() => { root.innerHTML = ''; }, 3200);
}

function table(headers, rows) {
  if (!rows.length) return '<div class="empty">暂无数据</div>';
  return `<div style="overflow:auto"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function modal(title, content, onOk, okText = '保存') {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-mask"><div class="modal"><h3>${esc(title)}</h3><div id="modal-body">${content}</div>
    <div class="modal-footer"><button class="btn ghost" id="modal-cancel">取消</button><button class="btn" id="modal-ok">${esc(okText)}</button></div></div></div>`;
  $('#modal-cancel').onclick = () => { root.innerHTML = ''; };
  $('.modal-mask').onclick = (e) => { if (e.target.classList.contains('modal-mask')) root.innerHTML = ''; };
  $('#modal-ok').onclick = async () => {
    try { await onOk($('#modal-body')); root.innerHTML = ''; }
    catch (e) { toast(e.message, true); }
  };
}

const field = (label, id, value = '', type = 'text') =>
  `<div class="form-row"><label>${label}</label><input id="${id}" type="${type}" value="${esc(value)}"></div>`;
const selectField = (label, id, options, selected) =>
  `<div class="form-row"><label>${label}</label><select id="${id}">${options.map((o) =>
    `<option value="${esc(o.v)}" ${String(o.v) === String(selected) ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select></div>`;

// 修改密码弹窗：任一已登录工作台复用（管理端 / 医生端顶部按钮）
function bindChangePassword() {
  const btn = $('#change-pwd');
  if (!btn) return;
  btn.onclick = () => {
    modal('修改密码', `
      <div class="form-row"><label>原密码</label><input id="cp-old" type="password" placeholder="当前密码"></div>
      <div class="form-row"><label>新密码</label><input id="cp-new" type="password" placeholder="设置新密码"></div>
      <div class="form-row"><label>确认新密码</label><input id="cp-new2" type="password" placeholder="再次输入新密码"></div>
      <div class="hint" style="margin-top:8px">修改成功后旧密码立即失效，并会向绑定手机号发送通知短信。</div>`,
    async (body) => {
      const oldPassword = $('#cp-old', body).value;
      const newPassword = $('#cp-new', body).value;
      const confirmPassword = $('#cp-new2', body).value;
      if (!oldPassword || !newPassword) throw new Error('请填写原密码和新密码');
      if (newPassword !== confirmPassword) throw new Error('两次输入的新密码不一致');
      await api('/api/auth/staff/change-password', 'POST', { oldPassword, newPassword, confirmPassword });
      toast('密码修改成功，下次登录请使用新密码');
    }, '确认修改');
  };
}
