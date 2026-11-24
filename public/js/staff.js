// 工作人员登录 / 注册：登录后按激活身份跳转对应工作台
const goto = (role) => {
  goStaffPage(role === '牙医' ? '/dentist.html' : '/admin.html');
};

// 注意：这里刻意不做"已登录自动跳转"。
// 之前 staff 页自动跳工作台、工作台校验失败又跳回 staff，两个页面互相跳导致屏闪死循环。
// 现在 staff 页始终显示登录表单，只有用户主动提交登录才跳转。

$$('#seg button').forEach((b) => b.onclick = () => {
  $$('#seg button').forEach((x) => x.classList.toggle('active', x === b));
  const reg = b.dataset.mode === 'register';
  $('#login-form').style.display = reg ? 'none' : '';
  $('#reg-form').style.display = reg ? '' : 'none';
});

$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  $('#lg-err').textContent = '';
  try {
    const r = await api('/api/auth/staff/login', 'POST', {
      account: $('#lg-account').value.trim(), password: $('#lg-pwd').value,
    });
    setStaffSession(r);
    toast(`欢迎，${r.name}（${r.activeRole}）`);
    setTimeout(() => goto(r.activeRole), 400);
  } catch (err) { $('#lg-err').textContent = err.message; }
};

$('#reg-form').onsubmit = async (e) => {
  e.preventDefault();
  $('#rg-err').textContent = '';
  const pwd = $('#rg-pwd').value, pwd2 = $('#rg-pwd2').value;
  if (pwd !== pwd2) {
    $('#rg-err').style.color = 'var(--danger)';
    $('#rg-err').textContent = '两次输入的密码不一致，请重新输入';
    return;
  }
  try {
    const r = await api('/api/auth/staff/register', 'POST', {
      name: $('#rg-name').value.trim(), phone: $('#rg-phone').value.trim(),
      role: $('#rg-role').value, password: pwd, confirmPassword: pwd2,
    });
    $('#rg-err').style.color = 'var(--brand)';
    $('#rg-err').textContent = r.message + `（系统工号 ${r.staffNo}；短信：${r.sms.content}）`;
    $('#reg-form').reset();
  } catch (err) { $('#rg-err').style.color = 'var(--danger)'; $('#rg-err').textContent = err.message; }
};
