import { api } from '../api.js';
import { toast, showLoading, escapeHtml } from '../utils.js';

// ===== Admin =====
async function renderAdmin(body) {
  showLoading(body);
  try {
    const [usersData, rolesData, notifData, envsData] = await Promise.all([
      api('/admin/users').catch(()=>({users:[]})),
      api('/admin/roles').catch(()=>({roles:[]})),
      api('/admin/notification-config').catch(()=>({aaru_domain:'',env_webhooks:{}})),
      api('/environments').catch(()=>({envs:[]})),
    ]);
    const users = usersData.users||[];
    const roles = rolesData.roles||[];
    const notifCfg = notifData;
    const envs = envsData.envs||[];

    function accessDisplay(val) {
      if (!val) return '<span style="color:var(--text-muted)">未配置</span>';
      if (val === '*') return '<span style="color:#16a34a">全部</span>';
      return escapeHtml(val);
    }
    function envDisplay(u) {
      const hasApprove = (u.roles||[]).some(r => r.name === 'admin' || r.name === 'operator');
      if (!hasApprove) return '<span style="color:var(--text-muted)">-</span>';
      return accessDisplay(u.allowed_envs);
    }

    body.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
      <div class="card"><div class="card-header"><div class="card-title">用户管理</div><button class="btn btn-sm btn-primary" onclick="showBatchImportUsers()">📥 批量导入</button></div>
        <table class="data-table"><thead><tr><th>用户名</th><th>邮箱</th><th>角色</th><th>可用竖井</th><th>可用环境</th></tr></thead><tbody>${users.map(u=>`<tr>
          <td><strong>${escapeHtml(u.username)}</strong></td>
          <td>${escapeHtml(u.email||'')}</td>
          <td>${(u.roles||[]).map(r=>`<span class="status-badge status-pending">${escapeHtml(r.name)}</span>`).join(' ')||'<span style="color:var(--text-muted)">无</span>'} <a href="#" class="text-link" style="font-size:11px" onclick="editUserRoles(${u.id},'${escapeHtml(u.username)}',${JSON.stringify((u.roles||[]).map(r=>r.id))});return false">编辑</a></td>
          <td>${accessDisplay(u.allowed_silos)} <a href="#" class="text-link" style="font-size:11px" onclick="editUserAccess(${u.id},'${escapeHtml(u.username)}','${escapeHtml(u.allowed_silos||'')}','${escapeHtml(u.allowed_envs||'')}');return false">编辑</a></td>
          <td>${envDisplay(u)}</td>
        </tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">暂无用户</td></tr>'}</tbody></table>
      </div>
      <div class="card"><div class="card-header"><div class="card-title">角色管理</div><button class="btn btn-sm btn-primary" onclick="showCreateRole()">+ 新建角色</button></div>
        <table class="data-table"><thead><tr><th>角色名</th><th>描述</th><th>权限</th></tr></thead><tbody>${roles.map(r=>`<tr>
          <td><strong>${escapeHtml(r.name)}</strong></td>
          <td>${escapeHtml(r.description||'')}</td>
          <td>${(r.permissions||[]).map(p=>`<span class="status-badge status-completed">${escapeHtml(p.action)}</span>`).join(' ')||'-'}</td>
        </tr>`).join('')||'<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">暂无角色</td></tr>'}</tbody></table>
      </div>
    </div>
    <div class="card" style="margin-top:24px">
      <div class="card-header"><div class="card-title">🔔 机器人通知配置</div></div>
      <div class="card-body">
        <div class="form-group" style="max-width:400px;margin-bottom:16px">
          <label class="form-label">Aaru 域名（用于生成审批链接）</label>
          <input class="form-control" id="notif-domain" value="${escapeHtml(notifCfg.aaru_domain||'')}" placeholder="https://aaru.example.com">
        </div>
        <div style="font-size:13px;font-weight:600;margin-bottom:8px">环境 Webhook 配置</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">为环境配置 CCWork 机器人 Webhook 地址后，当发布进入该环境的审批节点时将自动发送通知。</div>
        <table class="data-table">
          <thead><tr><th>环境</th><th>Webhook URL</th></tr></thead>
          <tbody>${envs.map(e=>{
            const envCode = e.Env || e.name || e.Name || '';
            const envName = e.name || e.Name || envCode;
            const url = (notifCfg.env_webhooks||{})[envCode] || '';
            return `<tr>
              <td><strong>${escapeHtml(envName)}</strong><br><span style="font-size:11px;color:var(--text-muted)">${escapeHtml(envCode)}</span></td>
              <td><input class="form-control notif-webhook-input" data-env="${escapeHtml(envCode)}" value="${escapeHtml(url)}" placeholder="https://..." style="font-size:12px"></td>
            </tr>`;
          }).join('')||'<tr><td colspan="2" style="color:var(--text-muted)">无环境数据</td></tr>'}</tbody>
        </table>
        <div style="margin-top:12px;text-align:right">
          <button class="btn btn-primary" onclick="saveNotifConfig()">保存通知配置</button>
        </div>
      </div>
    </div>`;
  } catch(e) { body.innerHTML = '<div class="empty-state"><p>加载失败: '+escapeHtml(e.message)+'</p></div>'; }
}

async function editUserAccess(userId, username, curSilos, curEnvs) {
  // 获取竖井列表（从 DevOps API /du-list 提取唯一 silo）
  let siloOptions = [];
  try {
    const data = await api('/du-list');
    const siloSet = new Set();
    (data.deploy_units||[]).forEach(d => { if (d.silo) siloSet.add(d.silo); });
    siloOptions = [...siloSet].sort();
  } catch(e) {}

  // 获取环境列表（从 DMDB /environments）
  let envOptions = [];
  try {
    const data = await api('/environments');
    envOptions = (data.envs||[]).map(e => e.Env || e.name || e.Name || '').filter(Boolean);
  } catch(e) {}

  const overlay = document.createElement('div');
  overlay.className = 'diff-modal-overlay';
  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });
  const modal = document.createElement('div');
  modal.className = 'diff-modal';
  modal.style.maxWidth = '500px';

  function renderCheckboxes(options, selected, label) {
    const selectedSet = new Set(selected === '*' ? options : (selected ? selected.split(',').map(s=>s.trim()) : []));
    const isAll = selected === '*';
    const items = options.map(o =>
      `<label style="display:inline-flex;align-items:center;gap:4px;margin:4px 8px 4px 0;font-size:13px">
        <input type="checkbox" value="${escapeHtml(o)}" ${selectedSet.has(o)?'checked':''}> ${escapeHtml(o)}
      </label>`
    ).join('');
    return `<div style="margin-bottom:16px">
      <label style="font-weight:600;font-size:13px;margin-bottom:8px;display:block">${label}</label>
      <label style="display:inline-flex;align-items:center;gap:4px;margin-bottom:8px;font-size:13px">
        <input type="checkbox" id="acc-all-${label}" ${isAll?'checked':''} onchange="this.closest('.diff-modal').querySelectorAll('.acc-${label} input[type=checkbox]').forEach(c=>c.checked=this.checked)"> 全部（*）
      </label>
      <div class="acc-${label}" style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px">${items}</div>
    </div>`;
  }

  modal.innerHTML = `
    <div class="diff-modal-header"><h3>配置权限 - ${escapeHtml(username)}</h3><button class="diff-modal-close" onclick="this.closest('.diff-modal-overlay').remove()">✕</button></div>
    <div class="diff-modal-body" style="padding:16px">
      ${renderCheckboxes(siloOptions, curSilos, '可用竖井')}
      ${renderCheckboxes(envOptions, curEnvs, '可用环境')}
      <div style="text-align:right;margin-top:16px">
        <button class="btn btn-secondary" onclick="this.closest('.diff-modal-overlay').remove()">取消</button>
        <button class="btn btn-primary" onclick="saveUserAccess(${userId},this)">保存</button>
      </div>
    </div>`;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

async function saveUserAccess(userId, btn) {
  const modal = btn.closest('.diff-modal');
  function collectValues(cls, isAllId) {
    const allCb = modal.querySelector('#'+isAllId);
    if (allCb && allCb.checked) return '*';
    const vals = [];
    modal.querySelectorAll('.'+cls+' input[type=checkbox]:checked').forEach(c => vals.push(c.value));
    return vals.join(',');
  }
  const silos = collectValues('acc-可用竖井', 'acc-all-可用竖井');
  const envs = collectValues('acc-可用环境', 'acc-all-可用环境');
  try {
    await api('/admin/users/'+userId+'/access', { method:'PUT', body:JSON.stringify({allowed_silos:silos, allowed_envs:envs}) });
    toast('权限已更新','success');
    modal.closest('.diff-modal-overlay').remove();
    loadPage('admin');
  } catch(e) { toast(e.message,'error'); }
}

async function editUserRoles(userId, username, currentRoleIds) {
  // 获取所有角色
  let allRoles = [];
  try {
    const data = await api('/admin/roles');
    allRoles = data.roles || [];
  } catch(e) { toast('获取角色列表失败','error'); return; }

  const currentSet = new Set(currentRoleIds);
  const overlay = document.createElement('div');
  overlay.className = 'diff-modal-overlay';
  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });
  const modal = document.createElement('div');
  modal.className = 'diff-modal';
  modal.style.maxWidth = '400px';

  const checkboxes = allRoles.map(r =>
    `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px">
      <input type="checkbox" value="${r.id}" ${currentSet.has(r.id)?'checked':''}>
      <span><strong>${escapeHtml(r.name)}</strong> <span style="color:var(--text-muted);font-size:11px">${escapeHtml(r.description||'')}</span></span>
    </label>`
  ).join('');

  modal.innerHTML = `
    <div class="diff-modal-header"><h3>编辑角色 - ${escapeHtml(username)}</h3><button class="diff-modal-close" onclick="this.closest('.diff-modal-overlay').remove()">✕</button></div>
    <div class="diff-modal-body" style="padding:16px">
      <div style="max-height:300px;overflow-y:auto">${checkboxes}</div>
      <div style="text-align:right;margin-top:16px">
        <button class="btn btn-secondary" onclick="this.closest('.diff-modal-overlay').remove()">取消</button>
        <button class="btn btn-primary" onclick="saveUserRoles(${userId},this)">保存</button>
      </div>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

async function saveUserRoles(userId, btn) {
  const modal = btn.closest('.diff-modal');
  const roleIds = [];
  modal.querySelectorAll('input[type=checkbox]:checked').forEach(cb => roleIds.push(parseInt(cb.value)));
  try {
    await api('/admin/users/'+userId+'/roles', { method:'PUT', body:JSON.stringify({role_ids:roleIds}) });
    toast('角色已更新','success');
    modal.closest('.diff-modal-overlay').remove();
    loadPage('admin');
  } catch(e) { toast(e.message,'error'); }
}

function showBatchImportUsers() {
  const overlay = document.createElement('div');
  overlay.className = 'diff-modal-overlay';
  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });
  const modal = document.createElement('div');
  modal.className = 'diff-modal';
  modal.style.maxWidth = '700px';
  modal.innerHTML = `
    <div class="diff-modal-header"><h3>📥 批量导入用户</h3><button class="diff-modal-close" onclick="this.closest('.diff-modal-overlay').remove()">✕</button></div>
    <div class="diff-modal-body" style="padding:16px">
      <div style="margin-bottom:12px">
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">粘贴JSON 或 上传文件，格式如下：</p>
        <pre style="background:#f4f4f5;padding:8px;border-radius:6px;font-size:11px;overflow-x:auto">[
  {"username":"zhangsan","role":"developer","allowed_silos":"payment-silo"},
  {"username":"lisi","role":"operator","allowed_silos":"*","allowed_envs":"staging,prod"},
  {"username":"wangwu","role":"viewer"}
]</pre>
      </div>
      <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
        <input type="file" id="batch-import-file" accept=".json" style="font-size:12px" onchange="batchImportFileLoad(this)">
        <span style="font-size:11px;color:var(--text-muted)">或直接粘贴↓</span>
      </div>
      <textarea id="batch-import-json" rows="12" style="width:100%;font-family:monospace;font-size:12px;border:1px solid var(--border);border-radius:6px;padding:8px" placeholder='[{"username":"...","role":"developer","allowed_silos":"..."}]'></textarea>
      <div style="margin-top:8px;font-size:11px;color:var(--text-muted)">
        role: admin / developer / operator / viewer &nbsp;|&nbsp; allowed_silos/envs: * 或逗号分隔 &nbsp;|&nbsp; 已存在用户自动跳过
      </div>
      <div id="batch-import-result" style="margin-top:12px"></div>
      <div style="text-align:right;margin-top:16px">
        <button class="btn btn-secondary" onclick="this.closest('.diff-modal-overlay').remove()">取消</button>
        <button class="btn btn-primary" onclick="batchImportSubmit(this)">导入</button>
      </div>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function batchImportFileLoad(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('batch-import-json').value = e.target.result;
  };
  reader.readAsText(file);
}

async function batchImportSubmit(btn) {
  const ta = document.getElementById('batch-import-json');
  const resultEl = document.getElementById('batch-import-result');
  let users;
  try {
    users = JSON.parse(ta.value);
    if (!Array.isArray(users)) throw new Error('JSON 必须是数组');
  } catch(e) {
    resultEl.innerHTML = `<div style="color:#ef4444;font-size:12px">JSON 解析失败: ${escapeHtml(e.message)}</div>`;
    return;
  }
  btn.disabled = true;
  btn.textContent = '导入中...';
  try {
    const data = await api('/admin/users/batch', { method:'POST', body:JSON.stringify({users}) });
    const created = data.created||[];
    const skipped = data.skipped||[];
    let html = '';
    if (created.length) html += `<div style="color:#16a34a;font-size:12px">✅ 已创建: ${created.join(', ')}</div>`;
    if (skipped.length) html += `<div style="color:#f59e0b;font-size:12px">⏭️ 已跳过(已存在): ${skipped.join(', ')}</div>`;
    if (!created.length && !skipped.length) html = '<div style="color:var(--text-muted);font-size:12px">无有效数据</div>';
    resultEl.innerHTML = html;
    if (created.length) loadPage('admin');
  } catch(e) {
    resultEl.innerHTML = `<div style="color:#ef4444;font-size:12px">❌ ${escapeHtml(e.message)}</div>`;
  }
  btn.disabled = false;
  btn.textContent = '导入';
}

function showCreateRole() {
  const name = prompt('输入角色名:');
  if (!name) return;
  api('/admin/roles', { method:'POST', body:JSON.stringify({name, description:''}) })
    .then(()=>{ toast('角色已创建','success'); loadPage('admin'); })
    .catch(e=>toast(e.message,'error'));
}

async function saveNotifConfig() {
  const domain = document.getElementById('notif-domain')?.value?.trim() || '';
  const webhooks = {};
  document.querySelectorAll('.notif-webhook-input').forEach(input => {
    const env = input.dataset.env;
    const url = input.value.trim();
    if (env && url) webhooks[env] = url;
  });
  try {
    await api('/admin/notification-config', { method:'PUT', body:JSON.stringify({ aaru_domain: domain, env_webhooks: webhooks }) });
    toast('通知配置已保存','success');
  } catch(e) { toast(e.message,'error'); }
}

// Expose for inline onclick
window.renderAdmin = renderAdmin;
window.editUserAccess = editUserAccess;
window.saveUserAccess = saveUserAccess;
window.editUserRoles = editUserRoles;
window.saveUserRoles = saveUserRoles;
window.showBatchImportUsers = showBatchImportUsers;
window.batchImportFileLoad = batchImportFileLoad;
window.batchImportSubmit = batchImportSubmit;
window.showCreateRole = showCreateRole;
window.saveNotifConfig = saveNotifConfig;

export { renderAdmin };
