// 数据库结构查看：40 张表、字段、映射说明、样例数据
const DB = { tables: [], group: '全部', current: null, info: null };

async function init() {
  await requireStaff(); // 仅工作人员可查看；未登录由下方提示引导
  const [tables, info] = await Promise.all([api('/api/db/tables'), api('/api/db/info')]);
  DB.tables = tables; DB.info = info;
  renderSidebar(); renderTables();
}

function renderSidebar() {
  const groups = ['全部', ...DB.info.groups];
  $('#sidebar').innerHTML = `<div class="nav-group">数据分组</div>${groups.map((g) =>
    `<button class="nav-item ${DB.group === g ? 'active' : ''}" data-group="${g}">${g}
      <span class="muted">${g === '全部' ? DB.tables.length : DB.tables.filter((t) => t.group === g).length}</span></button>`).join('')}
    <div class="nav-group">映射规则</div>
    <div class="muted" style="padding:0 14px;line-height:1.9;font-size:12px">类→表<br>属性→列<br>泛化→父类主键作子类主键<br>关联→外键<br>组合→非空外键<br>多对多→关联表</div>`;
  $$('.nav-item').forEach((b) => b.onclick = () => { DB.group = b.dataset.group; renderSidebar(); renderTables(); });
}

function renderTables() {
  const list = DB.tables.filter((t) => DB.group === '全部' || t.group === DB.group);
  $('#main').innerHTML = `<h2>数据库结构</h2>
    <div class="subtitle">引擎：${esc(DB.info.engine)} ｜ 共 ${DB.info.tableCount} 张表 ｜ 点击表名查看字段与模拟数据</div>
    <div class="grid2">${list.map((t) => `<div class="panel" style="margin:0">
      <h3 style="display:flex;justify-content:space-between;align-items:center">
        <span>${esc(t.cn)}</span><span class="muted" style="font-size:12px">${esc(t.name)}</span></h3>
      <div class="muted" style="line-height:1.7">${esc(t.note)}</div>
      <div class="flex" style="margin-top:12px"><span class="tag">${t.columns.length} 字段</span>
        <span class="tag" style="background:#e8f4ff;color:#2b7fc4">${esc(t.group)}</span>
        <button class="btn small" data-open="${t.name}" style="margin-left:auto">查看结构</button></div>
    </div>`).join('')}</div>`;
  $$('[data-open]').forEach((b) => b.onclick = () => openTable(b.dataset.open));
}

async function openTable(name) {
  const t = DB.tables.find((x) => x.name === name);
  const data = await api('/api/db/data/' + name);
  const cols = table(['字段', '类型'], t.columns.map((c) =>
    `<tr><td>${esc(c.name)}</td><td>${esc(c.type)}</td></tr>`));
  const rows = table(['#', ...t.columns.slice(0, 8).map((c) => c.name)],
    data.rows.slice(0, 20).map((r, i) => `<tr><td>${i + 1}</td>${t.columns.slice(0, 8).map((c) => `<td>${esc(r[c.name] ?? '—')}</td>`).join('')}</tr>`));
  modal(`${t.cn} (${t.name}) · 共 ${data.total} 条`,
    `<div class="section-title">字段结构</div>${cols}
     <div class="section-title">模拟数据（前 20 条）</div>${rows}
     <div class="section-title">建表语句（DDL）</div>
     <pre style="background:#f6f8fb;border-radius:8px;padding:12px;overflow:auto;font-size:11px;white-space:pre-wrap">${esc(t.ddl)}</pre>`,
    async () => {}, '关闭');
  $('.modal').style.width = 'min(900px,100%)';
}

init().catch((e) => {
  $('#main').innerHTML = `<div class="panel"><div class="empty">
    <h2>需要工作人员身份</h2>
    <p>${esc(e.message)}</p>
    <p><a class="btn" href="/staff.html">前往工作人员登录 →</a></p>
  </div></div>`;
});
