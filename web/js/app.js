const API = '/api';
let currentUser = null;

async function api(url, opts = {}) {
  const res = await fetch(API + url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (res.status === 401) { window.location.href = '/auth/login'; return null; }
  if (!res.ok) { const e = await res.json().catch(()=>({error:res.statusText})); throw new Error(e.error||res.statusText); }
  return res.json();
}

function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function showLoading(container) {
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>加载中...</p></div>';
}

function statusHTML(status) {
  const names = {draft:'草稿',in_progress:'进行中',approved:'已通过',rejected:'已驳回',completed:'已完成',failed:'失败',rolled_back:'已回滚',pending:'待处理',skipped:'已跳过'};
  return `<span class="status-badge status-${status}">${names[status]||status}</span>`;
}

async function checkAuth() {
  try {
    const data = await api('/current-user');
    if (!data) return;
    currentUser = data;
    document.getElementById('user-name').textContent = data.username;
    document.getElementById('user-avatar').textContent = (data.username||'A')[0].toUpperCase();
    const roles = (data.roles||[]).map(r=>r.name).join(', ');
    document.getElementById('user-role').textContent = roles || '无角色';
  } catch(e) { window.location.href = '/auth/login'; }
}

async function logout() {
  await fetch(API + '/logout', { method:'POST', credentials:'same-origin' });
  window.location.href = '/auth/login';
}

function setPage(name, title, subtitle) {
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const nav = document.querySelector(`.nav-item[data-page="${name}"]`);
  if (nav) nav.classList.add('active');
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = subtitle || '';
}

async function loadPage(page, param) {
  const body = document.getElementById('content-body');
  const actions = document.getElementById('header-actions');
  actions.innerHTML = '';

  switch(page) {
    case 'releases': setPage('releases','发布管理','管理应用发布流水线'); renderReleaseList(body,actions); break;
    case 'create-release': setPage('releases','新建发布','创建新的发布单'); renderCreateRelease(body,actions); break;
    case 'release-detail': setPage('releases','发布详情','查看发布流水线进度'); renderReleaseDetail(body,param); break;
    case 'deploy-units': setPage('deploy-units','部署单元','浏览各环境的部署单元'); renderDeployUnits(body); break;
    case 'approvals': setPage('approvals','审批中心','处理待审批的发布'); renderApprovals(body); break;
    case 'blueprints': loadPageBlueprintList(body); break;
    case 'admin': setPage('admin','权限管理','管理用户角色和权限'); renderAdmin(body); break;
    default: loadPage('releases');
  }
}

// ===== Releases =====
async function renderReleaseList(body, actions) {
  actions.innerHTML = '<button class="btn btn-primary" onclick="loadPage(\'create-release\')">+ 新建发布</button>';
  showLoading(body);
  try {
    const data = await api('/releases');
    const releases = data.releases || [];
    if (releases.length === 0) {
      body.innerHTML = '<div class="empty-state"><svg width="40" height="40" viewBox="0 0 40 40" fill="none"><rect x="6" y="6" width="28" height="28" rx="4" stroke="#d1d5db" stroke-width="1.5"/><path d="M14 20h12M20 14v12" stroke="#d1d5db" stroke-width="1.5"/></svg><p>暂无发布单，创建一个开始吧</p><button class="btn btn-primary" onclick="loadPage(\'create-release\')">+ 新建发布</button></div>';
      return;
    }
    const page = data.page || 1;
    const total = data.total || 0;
    body.innerHTML = `<div class="card"><table class="data-table"><thead><tr><th>标题</th><th>部署单元</th><th>版本</th><th>环境</th><th>状态</th><th>创建者</th><th>时间</th><th>操作</th></tr></thead><tbody>${releases.map(r=>`<tr>
      <td><a href="#" onclick="loadPage('release-detail',${r.id});return false" style="color:var(--accent);font-weight:500">${escapeHtml(r.title)}</a></td>
      <td>${escapeHtml(r.deploy_unit_code||'')}</td>
      <td><code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-size:12px">${escapeHtml(r.version||'')}</code></td>
      <td>${escapeHtml(r.stages?.map(s=>s.env_name||s.env_code).join(', ')||'')}</td>
      <td>${statusHTML(r.status)}</td>
      <td>${escapeHtml(r.created_by?.username||'')}</td>
      <td>${fmtTime(r.created_at)}</td>
      <td class="action-group">${r.status==='draft'?'<button class="btn btn-sm btn-primary" onclick="startRelease('+r.id+')">开始发布</button>':''}${r.status==='in_progress'||r.status==='completed'?'<button class="btn btn-sm btn-secondary" onclick="loadPage(\'release-detail\','+r.id+')">查看</button>':''}${r.status==='completed'||r.status==='in_progress'?'<button class="btn btn-sm btn-danger" onclick="rollbackRelease('+r.id+')">回滚</button>':''}</td>
    </tr>`).join('')}</tbody></table></div>`;
  } catch(e) { body.innerHTML = '<div class="empty-state"><p>加载失败: '+escapeHtml(e.message)+'</p></div>'; }
}

async function startRelease(id) {
  try {
    await api('/releases/'+id+'/start', { method:'POST' });
    toast('发布已启动','success');
    loadPage('releases');
  } catch(e) { toast(e.message,'error'); }
}

async function rollbackRelease(id) {
  if (!confirm('确认回滚此发布？')) return;
  try {
    await api('/releases/'+id+'/rollback', { method:'POST' });
    toast('已回滚','success');
    loadPage('releases');
  } catch(e) { toast(e.message,'error'); }
}

async function renderReleaseDetail(body, id) {
  showLoading(body);
  try {
    const r = await api('/releases/'+id);
    if (!r) return;
    const stages = r.stages||[];
    const pipelineHTML = stages.length ? `<div class="card" style="margin-bottom:24px"><div class="card-header"><div class="card-title">发布流水线</div></div><div class="card-body"><div class="pipeline">${stages.map((s,i)=>`
      <div class="pipeline-stage ${s.status}">
        <div class="pipeline-node">${s.status==='approved'||s.status==='completed'?'✓':s.status==='rejected'?'✕':(i+1)}</div>
        <div class="pipeline-label">${escapeHtml(s.env_name||s.env_code)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${statusHTML(s.status)}</div>
      </div>
      ${i<stages.length-1?`<div class="pipeline-line ${stages[i].status==='approved'||stages[i].status==='completed'?'approved':''}"></div>`:''}
    `).join('')}</div></div></div>` : '';

    body.innerHTML = `<div class="release-detail-header">
      <div class="release-info">
        <h2>${escapeHtml(r.title)}</h2>
        <div class="release-meta">
          <div class="release-meta-item"><span>部署单元</span><span>${escapeHtml(r.deploy_unit_code||'')}</span></div>
          <div class="release-meta-item"><span>应用名称</span><span>${escapeHtml(r.deploy_unit_name||'')}</span></div>
          <div class="release-meta-item"><span>版本</span><span><code style="background:#f4f4f5;padding:2px 6px;border-radius:4px">${escapeHtml(r.version||'')}</code></span></div>
          <div class="release-meta-item"><span>状态</span><span>${statusHTML(r.status)}</span></div>
          <div class="release-meta-item"><span>创建者</span><span>${escapeHtml(r.created_by?.username||'')}</span></div>
          <div class="release-meta-item"><span>创建时间</span><span>${fmtTime(r.created_at)}</span></div>
        </div>
      </div>
      <div>${r.status==='draft'?'<button class="btn btn-primary" onclick="startRelease('+r.id+')">开始发布</button>':''}${r.status==='in_progress'||r.status==='completed'?'<button class="btn btn-danger" onclick="rollbackRelease('+r.id+')">回滚</button>':''}</div>
    </div>
    ${pipelineHTML}
    <div class="card"><div class="card-header"><div class="card-title">阶段详情</div></div><div class="card-body">${renderStageTable(stages)}</div></div>`;
  } catch(e) { body.innerHTML = '<div class="empty-state"><p>加载失败: '+escapeHtml(e.message)+'</p></div>'; }
}

function renderStageTable(stages) {
  return `<table class="data-table"><thead><tr><th>环境</th><th>顺序</th><th>状态</th><th>审批人</th><th>备注</th><th>操作</th></tr></thead><tbody>${stages.map(s=>`<tr>
    <td><strong>${escapeHtml(s.env_name||s.env_code)}</strong></td><td>${s.promotion_order+1}</td>
    <td>${statusHTML(s.status)}</td>
    <td>${escapeHtml(s.approved_by?.username||'-')}</td>
    <td>${escapeHtml(s.comment||'-')}</td>
    <td class="action-group">${s.status==='in_progress'?'<button class="btn btn-sm btn-success" onclick="approveStage('+s.id+')">通过</button><button class="btn btn-sm btn-danger" onclick="rejectStage('+s.id+')">驳回</button>':''}${s.status==='pending'?'<button class="btn btn-sm btn-primary" onclick="promoteStage('+s.id+')">部署到此环境</button>':''}</td>
  </tr>`).join('')}</tbody></table>`;
}

async function approveStage(id) {
  const comment = prompt('审批备注（可选）:') || '';
  try { await api('/stages/'+id+'/approve', { method:'POST', body:JSON.stringify({comment}) }); toast('已通过','success'); loadPage('releases'); }
  catch(e) { toast(e.message,'error'); }
}
async function rejectStage(id) {
  const comment = prompt('驳回原因（必填）:');
  if (!comment) { toast('请填写驳回原因','error'); return; }
  try { await api('/stages/'+id+'/reject', { method:'POST', body:JSON.stringify({comment}) }); toast('已驳回','info'); loadPage('releases'); }
  catch(e) { toast(e.message,'error'); }
}
async function promoteStage(id) {
  if (!confirm('确认将此发布推进到此环境？')) return;
  try { await api('/stages/'+id+'/promote', { method:'POST' }); toast('已推进','success'); loadPage('releases'); }
  catch(e) { toast(e.message,'error'); }
}


async function renderCreateRelease(body, actions) {
  showLoading(body);
  try {
    const [envsData, silosData, bpsData] = await Promise.all([
      api('/environments').catch(()=>({envs:[]})),
      api('/silos').catch(()=>({silos:[]})),
      api('/blueprints').catch(()=>({blueprints:[]}))
    ]);
    const envs = envsData.envs||[];
    const silos = silosData.silos||[];
    const bps = bpsData.blueprints||[];

    body.innerHTML = `<div class="card" style="max-width:700px"><div class="card-header"><div class="card-title">新建发布</div></div><div class="card-body">
      <form id="create-form" onsubmit="submitRelease(event)">
        <div class="form-group"><label class="form-label">标题</label><input class="form-control" name="title" required placeholder="例: v2.1.0 发版"></div>
        <div class="form-group"><label class="form-label">竖井（Silo）</label><select class="form-control" name="silo" onchange="loadDUsBySilo(this.value)">
          <option value="">选择竖井</option>${silos.map(s=>`<option value="${escapeHtml(s.biz_serial)}">${escapeHtml(s.name||s.biz_serial)}</option>`).join('')}
        </select></div>
        <div class="form-group"><label class="form-label">环境（查询部署单元用）</label><select class="form-control" name="env" onchange="loadDUsByEnv(this.value)">
          <option value="">选择环境</option>${envs.map(e=>`<option value="${escapeHtml(e.Env)}">${escapeHtml(e.name)}</option>`).join('')}
        </select></div>
        <div class="form-group"><label class="form-label">部署单元</label><select class="form-control" name="deploy_unit_code" required><option value="">先选择环境或竖井</option></select></div>
        <div class="form-group"><label class="form-label">版本</label><input class="form-control" name="version" required placeholder="例: 2.1.0.RELEASE"></div>
        <div class="form-group"><label class="form-label">晋级蓝图（可选）</label><select class="form-control" name="blueprint_id">
          <option value="">不使用蓝图（自定义下方环境列表）</option>${bps.map(b=>`<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('')}
        </select></div>
        <div class="form-group"><label class="form-label">发布目标环境（当不使用蓝图时选择）</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;padding:8px 0" id="env-checkboxes">${envs.map((e,i)=>`
            <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:13px">
              <input type="checkbox" name="env_code" value="${escapeHtml(e.Env)}" checked>
              ${escapeHtml(e.name)}
            </label>
          `).join('')}</div>
        </div>
        <button type="submit" class="btn btn-primary">创建发布</button>
        <button type="button" class="btn btn-secondary" onclick="loadPage(\'releases\')" style="margin-left:8px">取消</button>
      </form>
    </div></div>`;
  } catch(e) { body.innerHTML = '<div class="empty-state"><p>加载失败: '+escapeHtml(e.message)+'</p></div>'; }
}

async function submitRelease(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = '创建中...';
  const bpidRaw = f.get('blueprint_id');
  const bpid = bpidRaw ? parseInt(bpidRaw) : null;
  const envCheckboxes = document.querySelectorAll('input[name="env_code"]:checked');
  const environments = Array.from(envCheckboxes).map(cb => cb.value);
  try {
    await api('/releases', {
      method:'POST',
      body:JSON.stringify({
        title: f.get('title'),
        deploy_unit_code: f.get('deploy_unit_code'),
        version: f.get('version'),
        blueprint_id: bpid||null,
        environments: environments,
      })
    });
    toast('发布单创建成功','success');
    loadPage('releases');
  } catch(err) { toast(err.message,'error'); btn.disabled = false; btn.textContent = '创建发布'; }
}

// ===== Deploy Units Browse =====
let duSelectedCode = null;
let duSiloOptions = [];   // derived from DevOps API
let duSystemOptions = []; // derived from DevOps API
let duCache = {};         // code -> DevOpsDUItem
let duAll = [];           // all DUs from API
let duSnapshots = [];     // last compared snapshots

async function renderDeployUnits(body) {
  showLoading(body);
  try {
    // Fetch all DUs from DevOps API to derive filter options (no DMDB)
    const allData = await api('/du-list');
    duAll = allData.deploy_units||[];

    // Extract unique silos and systems from DU list
    const siloSet = new Set();
    const sysSet = new Set();
    duAll.forEach(d => {
      if (d.silo) siloSet.add(d.silo);
      if (d.system) sysSet.add(d.system);
    });
    duSiloOptions = [...siloSet].sort();
    duSystemOptions = [...sysSet].sort();

    body.innerHTML = `<div id="du-grid" style="display:grid;grid-template-columns:1fr 2fr;gap:20px;height:calc(100vh - 140px)">
      <div style="display:flex;flex-direction:column;min-height:0;min-width:0">
        <div class="card" style="flex:1;display:flex;flex-direction:column;min-height:0;min-width:0">
          <div class="card-header"><div class="card-title">部署单元列表</div></div>
          <div class="filter-bar" style="padding:12px 20px">
            <select class="form-control" id="du-silo" onchange="loadDUList()"><option value="">全部竖井</option>${duSiloOptions.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select>
            <select class="form-control" id="du-system" onchange="loadDUList()"><option value="">全部系统</option>${duSystemOptions.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select>
          </div>
          <div id="du-list" style="flex:1;overflow-y:auto;padding:0 20px 20px"><div class="loading-state"><div class="spinner"></div></div></div>
        </div>
      </div>
      <div style="min-height:0;min-width:0">
        <div class="card" style="height:100%;display:flex;flex-direction:column;min-width:0;overflow:hidden">
          <div class="card-header"><div class="card-title" id="du-detail-title">部署单元详情</div></div>
          <div id="du-detail" style="flex:1;overflow-y:auto;padding:20px;min-width:0"><div class="empty-state"><p>点击左侧部署单元查看详情</p></div></div>
        </div>
      </div>
    </div>`;
    renderDUList(duAll);
  } catch(e) { body.innerHTML = '<div class="empty-state"><p>加载失败: '+escapeHtml(e.message)+'</p></div>'; }
}

function renderDUList(dus) {
  const container = document.getElementById('du-list');
  if (!container) return;
  // Update cache
  duCache = {};
  (dus||[]).forEach(d => { duCache[d.code] = d; });
  if (!dus||dus.length===0) { container.innerHTML = '<div class="empty-state"><p>无匹配的部署单元</p></div>'; return; }
  container.innerHTML = dus.map(d=>{
    const sel = d.code===duSelectedCode?'selected':'';
    return `<div class="du-list-item ${sel}" onclick="loadDUDetail('${escapeHtml(d.code)}')" data-code="${escapeHtml(d.code)}">
      <div class="du-item-code">${escapeHtml(d.code)}</div>
      <div class="du-item-meta">Silo: ${escapeHtml(d.silo||'-')} / System: ${escapeHtml(d.system||'-')}</div>
    </div>`;
  }).join('');
}

window.loadDUList = function() {
  const silo = document.getElementById('du-silo')?.value||'';
  const system = document.getElementById('du-system')?.value||'';
  let dus = duAll;
  if (silo) dus = dus.filter(d => d.silo === silo);
  if (system) dus = dus.filter(d => d.system === system);
  renderDUList(dus);
};

window.loadDUDetail = async function(code) {
  duSelectedCode = code;
  const grid = document.getElementById('du-grid');
  if (grid) grid.style.gridTemplateColumns = '1fr 2fr';
  const title = document.getElementById('du-detail-title');
  const detail = document.getElementById('du-detail');
  if (title) title.textContent = code;
  if (detail) showLoading(detail);

  // Highlight selected item
  document.querySelectorAll('.du-list-item').forEach(el=>{
    el.classList.toggle('selected', el.dataset.code===code);
  });

  const d = duCache[code];
  if (!d) {
    if (detail) detail.innerHTML = '<div class="empty-state"><p>未找到该部署单元</p></div>';
    return;
  }

  // Build basic info section
  let html = `<div class="du-detail-card">
    <div class="du-detail-field"><label>部署单元编码</label><span><code>${escapeHtml(d.code)}</code></span></div>
    <div class="du-detail-field"><label>所属竖井 (Silo)</label><span>${escapeHtml(d.silo||'-')}</span></div>
    <div class="du-detail-field"><label>所属系统 (System)</label><span>${escapeHtml(d.system||'-')}</span></div>
    <div class="du-detail-field"><label>代码仓库</label><span style="word-break:break-all;font-size:12px">${escapeHtml(d.repo||'-')}</span></div>
  </div>`;

  // Fetch version comparison from DMDB
  try {
    const data = await api('/deploy-units/'+encodeURIComponent(code)+'/compare');
    duSnapshots = data.snapshots||[];
    if (duSnapshots.length > 0) {
      const f = s => k => (s.fields||{})[k]||'-';
      html += `<div style="margin-top:20px;display:flex;align-items:center;justify-content:space-between">
        <h4 style="font-size:13px;font-weight:600;padding-bottom:8px">各环境版本对比</h4>
        <button class="btn btn-sm btn-primary" onclick="showDUCompareDetail()">详细比对</button>
      </div>
        <table class="data-table du-compare-table">
          <thead><tr><th>环境</th><th>制品版本</th><th>节点数</th></tr></thead>
          <tbody>${duSnapshots.map(s=>`<tr>
            <td><strong>${escapeHtml(s.env_name||s.env)}</strong><br><span style="font-size:10px;color:var(--text-muted)">${escapeHtml(s.env)}</span></td>
            <td><code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-size:12px">${escapeHtml(f(s)('ArtifactVersion'))}</code></td>
            <td>${escapeHtml(f(s)('NodeCount'))}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    } else {
      html += `<div style="margin-top:20px"><div class="empty-state"><p>未在任何DMDB环境中找到此部署单元</p></div></div>`;
    }
  } catch(e) {
    html += `<div style="margin-top:20px"><div class="empty-state"><p>获取版本对比失败: ${escapeHtml(e.message)}</p></div></div>`;
  }

  if (detail) detail.innerHTML = html;
};

let duSelectedEnvs = []; // currently enabled env indices

window.showDUCompareDetail = function() {
  const grid = document.getElementById('du-grid');
  if (grid) grid.style.gridTemplateColumns = '240px 1fr';
  const detail = document.getElementById('du-detail');
  const title = document.getElementById('du-detail-title');
  if (!detail) return;
  if (duSnapshots.length === 0) {
    detail.innerHTML = '<div class="empty-state"><p>无对比数据</p></div>';
    return;
  }

  const code = duSelectedCode || '';
  if (title) title.textContent = code + ' - 详细比对';

  // All envs selected by default
  duSelectedEnvs = duSnapshots.map((_, i) => i);

  // Build env selector bar + table container, then render table
  detail.innerHTML = `<div id="du-compare-toolbar" style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px">
      <span style="color:var(--text-muted);margin-right:4px">环境:</span>
      ${duSnapshots.map((e,i)=>`<label class="du-env-chip" id="du-env-chip-${i}">
        <input type="checkbox" checked onchange="toggleCompareEnv(${i})">
        <span>${escapeHtml(e.env_name||e.env)}</span>
      </label>`).join('')}
    </div>
    <button class="btn btn-sm btn-secondary" onclick="loadDUDetail('${escapeHtml(code)}')">返回概览</button>
  </div>
  <div id="du-compare-table-wrap" style="overflow-x:auto;width:100%"></div>`;
  renderCompareTable();
};

window.toggleCompareEnv = function(idx) {
  const chip = document.getElementById('du-env-chip-'+idx);
  const checked = chip.querySelector('input').checked;
  if (checked) {
    duSelectedEnvs.push(idx);
    duSelectedEnvs.sort((a,b)=>a-b);
  } else {
    duSelectedEnvs = duSelectedEnvs.filter(i=>i!==idx);
  }
  renderCompareTable();
};

function renderCompareTable() {
  const wrap = document.getElementById('du-compare-table-wrap');
  if (!wrap) return;
  const selected = duSelectedEnvs.map(i=>duSnapshots[i]);
  if (selected.length < 2) {
    wrap.innerHTML = '<div class="empty-state"><p>请至少选择2个环境进行比对</p></div>';
    return;
  }

  const skipKeys = new Set(['id','Env','classCode','biz_serial','SiloCode','System']);
  const allKeys = new Set();
  selected.forEach(s => Object.keys(s.fields||{}).forEach(k => { if (!skipKeys.has(k)) allKeys.add(k); }));

  const diffFields = [...allKeys].filter(key => {
    const vals = selected.map(s=>String((s.fields||{})[key]||''));
    return new Set(vals).size > 1;
  });

  if (diffFields.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><p>所选环境配置完全一致，无差异</p></div>';
    return;
  }

  const val = (s, key) => {
    const raw = String((s.fields||{})[key]||'-');
    return raw.split(' ').map(escapeHtml).join('<span style="background:#fde68a">&nbsp;</span>');
  };

  wrap.innerHTML = `<div style="margin-bottom:8px;font-size:12px;color:var(--text-muted)">${selected.length} 个环境 / ${diffFields.length} 个差异项</div>
    <table class="data-table du-compare-table" style="min-width:600px;table-layout:auto">
      <thead><tr><th style="min-width:120px">配置项</th>${selected.map(e=>`<th>${escapeHtml(e.env_name||e.env)}<br><span style="font-weight:400;font-size:10px;color:var(--text-muted)">${escapeHtml(e.env)}</span></th>`).join('')}</tr></thead>
      <tbody>${diffFields.map(key=>`<tr class="du-diff-row">
        <td><strong style="font-size:12px;word-break:break-all">${escapeHtml(key)}</strong></td>
        ${selected.map(s=>`<td style="font-size:12px;word-break:break-all;max-width:300px;white-space:pre-wrap">${val(s,key)}</td>`).join('')}
      </tr>`).join('')}</tbody>
    </table>`;
}

// ===== Approvals =====
async function renderApprovals(body) {
  showLoading(body);
  try {
    const data = await api('/approvals/pending');
    const stages = data.stages||[];
    if (stages.length===0) { body.innerHTML = '<div class="empty-state"><svg width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M12 22l6 6 10-10" stroke="#d1d5db" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="20" r="14" stroke="#d1d5db" stroke-width="2" fill="none"/></svg><p>暂无待审批的发布</p></div>'; return; }
    body.innerHTML = `<div class="card"><div class="card-header"><div class="card-title">待审批 (${stages.length})</div></div>
      <table class="data-table"><thead><tr><th>发布单</th><th>环境</th><th>部署单元</th><th>版本</th><th>申请时间</th><th>操作</th></tr></thead><tbody>${stages.map(s=>`<tr>
        <td><a href="#" onclick="loadPage('release-detail',${s.release_id});return false" style="color:var(--accent)">#${s.release_id}</a></td>
        <td>${escapeHtml(s.env_name||s.env_code)}</td>
        <td>-</td><td>-</td>
        <td>${fmtTime(s.created_at)}</td>
        <td class="action-group">
          <button class="btn btn-sm btn-success" onclick="approveStage(${s.id})">通过</button>
          <button class="btn btn-sm btn-danger" onclick="rejectStage(${s.id})">驳回</button>
        </td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch(e) { body.innerHTML = '<div class="empty-state"><p>加载失败: '+escapeHtml(e.message)+'</p></div>'; }
}

// ===== Admin =====
async function renderAdmin(body) {
  showLoading(body);
  try {
    const [usersData, rolesData] = await Promise.all([
      api('/admin/users').catch(()=>({users:[]})),
      api('/admin/roles').catch(()=>({roles:[]}))
    ]);
    const users = usersData.users||[];
    const roles = rolesData.roles||[];

    body.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
      <div class="card"><div class="card-header"><div class="card-title">用户管理</div><button class="btn btn-sm btn-primary" onclick="showCreateRole()">+ 新建角色</button></div>
        <table class="data-table"><thead><tr><th>用户名</th><th>邮箱</th><th>角色</th></tr></thead><tbody>${users.map(u=>`<tr>
          <td><strong>${escapeHtml(u.username)}</strong></td>
          <td>${escapeHtml(u.email||'')}</td>
          <td>${(u.roles||[]).map(r=>`<span class="status-badge status-pending">${escapeHtml(r.name)}</span>`).join(' ')||'<span style="color:var(--text-muted)">无</span>'}</td>
        </tr>`).join('')||'<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">暂无用户</td></tr>'}</tbody></table>
      </div>
      <div class="card"><div class="card-header"><div class="card-title">角色管理</div><button class="btn btn-sm btn-primary" onclick="showCreateRole()">+ 新建角色</button></div>
        <table class="data-table"><thead><tr><th>角色名</th><th>描述</th><th>权限</th></tr></thead><tbody>${roles.map(r=>`<tr>
          <td><strong>${escapeHtml(r.name)}</strong></td>
          <td>${escapeHtml(r.description||'')}</td>
          <td>${(r.permissions||[]).map(p=>`<span class="status-badge status-completed">${escapeHtml(p.action)}</span>`).join(' ')||'-'}</td>
        </tr>`).join('')||'<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">暂无角色</td></tr>'}</tbody></table>
      </div>
    </div>`;
  } catch(e) { body.innerHTML = '<div class="empty-state"><p>加载失败: '+escapeHtml(e.message)+'</p></div>'; }
}

function showCreateRole() {
  const name = prompt('输入角色名:');
  if (!name) return;
  api('/admin/roles', { method:'POST', body:JSON.stringify({name, description:''}) })
    .then(()=>{ toast('角色已创建','success'); loadPage('admin'); })
    .catch(e=>toast(e.message,'error'));
}

// ===== Util =====
function escapeHtml(s) {
  if (s==null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtTime(t) {
  if (!t) return '-';
  try { return new Date(t).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }
  catch(e) { return String(t); }
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  loadPage('releases');
});

// ===== Blueprint Management =====
let dagState = { nodes: [], edges: [], nextId: 100, selectedNode: null, selectedEdge: null };

async function loadPageBlueprintList(body) {
  showLoading(body);
  try {
    const data = await api('/blueprints');
    const bps = data.blueprints || [];
    document.getElementById('header-actions').innerHTML = '<button class="btn btn-primary" onclick="loadPageBlueprintEditor()">+ 新建蓝图</button>';
    setPage('blueprints', '晋级蓝图管理', '管理环境晋级策略（DAG）');
    if (bps.length === 0) {
      body.innerHTML = '<div class="empty-state"><p>暂无晋级蓝图</p><button class="btn btn-primary" onclick="loadPageBlueprintEditor()">+ 新建蓝图</button></div>';
      return;
    }
    body.innerHTML = bps.map(b=>`<div class="blueprint-list-item" onclick="loadPageBlueprintEditor(${b.id})" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
      <div><strong>${escapeHtml(b.name)}</strong><br><span style="font-size:12px;color:var(--text-muted)">${escapeHtml(b.description||'')}</span></div>
      <div style="font-size:12px;color:var(--text-muted);text-align:right">${b.node_count} 节点 · ${b.edge_count} 边<button class="btn btn-danger btn-xs" onclick="event.stopPropagation();deleteBlueprint(${b.id})" style="margin-left:12px">删除</button></div>
    </div>`).join('');
  } catch(e) { body.innerHTML = '<div class="empty-state"><p>加载失败</p></div>'; }
}

async function loadPageBlueprintEditor(bpId) {
  const body = document.getElementById('content-body');
  const actions = document.getElementById('header-actions');
  showLoading(body);

  let bp = null;
  if (bpId) {
    try { bp = await api('/blueprints/'+bpId); } catch(e) {}
  }

  // Load envs for node selector
  let envs = [];
  try { const d = await api('/environments'); envs = d.envs||[]; } catch(e) {}

  // Load roles for gate config
  let roles = [];
  try { const d = await api('/admin/roles'); roles = d.roles||[]; } catch(e) {}

  setPage('blueprints', bpId ? '编辑蓝图: '+escapeHtml(bp?.name||'') : '新建蓝图', '基于DAG的环境晋级策略编辑器');
  actions.innerHTML = `
    <button class="btn btn-primary" onclick="saveBlueprint(${bpId||0})">保存蓝图</button>
    <button class="btn btn-secondary" onclick="loadPageBlueprintList()">返回列表</button>`;

  // Init DAG state
  if (bp) {
    dagState.nodes = (bp.nodes||[]).map(n=> ({...n, id:n.id, env_code:n.env_code, env_name:n.env_name||n.env_code, pos_x:n.pos_x, pos_y:n.pos_y, gate_type:n.gate_type||'manual', approve_role_id:n.approve_role_id, webhook_token:n.webhook_token||''}));
    dagState.edges = (bp.edges||[]).map(e=>({...e, id:e.id, from_node_id:e.from_node_id, to_node_id:e.to_node_id}));
    dagState.nextId = Math.max(100, ...dagState.nodes.map(n=>n.id)+1);
  } else {
    dagState = { nodes: [], edges: [], nextId: 100, selectedNode: null, selectedEdge: null };
  }

  body.innerHTML = `<div style="display:grid;grid-template-columns:1fr 300px;gap:16px;height:calc(100vh - 140px)">
    <div style="min-width:0;overflow:hidden">
      <div style="margin-bottom:8px;display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" onclick="addDagNode()">+ 添加节点</button>
        <button class="btn btn-secondary btn-sm" onclick="autoLayout()">自动排版</button>
        <span style="font-size:11px;color:var(--text-muted);line-height:28px;margin-left:8px">Shift+点击两节点创建边 | 双击边删除 | 拖拽节点移动</span>
      </div>
      <div class="dag-editor" id="dag-canvas" style="flex:1;height:calc(100% - 36px)">
        <svg class="dag-svg" id="dag-svg">
          <defs><marker id="arrowhead" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto"><polygon points="0 0, 6 2.5, 0 5" fill="#6b7280"/></marker></defs>
        </svg>
      </div>
    </div>
    <div class="dag-panel" style="overflow-y:auto">
      <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">蓝图配置</h3>
      <div class="form-group"><label class="form-label">名称</label><input class="form-control" id="bp-name" value="${escapeHtml(bp?.name||'')}"></div>
      <div class="form-group"><label class="form-label">描述</label><input class="form-control" id="bp-desc" value="${escapeHtml(bp?.description||'')}"></div>
      <hr style="margin:12px 0">
      <div id="node-config" style="font-size:12px;color:var(--text-muted)">点击画布中的节点进行配置</div>
    </div>
  </div>`;

  renderDAG();
  setupDAGMouse();
}

function renderDAG() {
  const svg = document.getElementById('dag-svg');
  if (!svg) return;
  const canvas = document.getElementById('dag-canvas');
  // Compute content bounds from all nodes, with padding
  let minX = 0, minY = 0, maxX = canvas.clientWidth, maxY = canvas.clientHeight;
  if (dagState.nodes.length > 0) {
    minX = Math.min(...dagState.nodes.map(n=>n.pos_x));
    minY = Math.min(...dagState.nodes.map(n=>n.pos_y));
    maxX = Math.max(...dagState.nodes.map(n=>n.pos_x + (n._w||80)));
    maxY = Math.max(...dagState.nodes.map(n=>n.pos_y + 30));
    const pad = 120;
    minX = Math.min(0, minX - pad);
    minY = Math.min(0, minY - pad);
    maxX = Math.max(canvas.clientWidth, maxX + pad);
    maxY = Math.max(canvas.clientHeight, maxY + pad);
  }
  const vw = maxX - minX, vh = maxY - minY;
  svg.setAttribute('viewBox', `${minX} ${minY} ${vw} ${vh}`);
  svg.setAttribute('width', vw);
  svg.setAttribute('height', vh);

  dagState.nodes.forEach(n => {
    const label = n.env_name || n.env_code || '';
    n._w = Math.max(70, Math.min(200, label.length * 9 + 28));
  });

  const boxes = {};
  dagState.nodes.forEach(n => { boxes[n.id] = { x: n.pos_x, y: n.pos_y, w: n._w, h: 30 }; });

  // Count how many edges share the same (from) or (to) per node
  const outCount = {}, inCount = {}, outSeq = {}, inSeq = {};
  dagState.nodes.forEach(n => { outCount[n.id]=0; inCount[n.id]=0; outSeq[n.id]=0; inSeq[n.id]=0; });
  dagState.edges.forEach(e => { outCount[e.from_node_id]++; inCount[e.to_node_id]++; });

  // Build edges sorted to keep consistent order
  const sorted = [...dagState.edges].sort((a,b) => a.from_node_id - b.from_node_id || a.to_node_id - b.to_node_id);

  // Assign sequence index per edge for spreading along the exit/entry edge
  const edgeOutIdx = {}, edgeInIdx = {};
  sorted.forEach(e => {
    edgeOutIdx[e.id] = outSeq[e.from_node_id]++;
    edgeInIdx[e.id] = inSeq[e.to_node_id]++;
  });

  function spreadY(nodeId, side, idx, total) {
    const b = boxes[nodeId]; if(!b) return b?b.y:0;
    if (total <= 1) return b.y + b.h/2;
    const pad = 6;
    const usable = b.h - pad*2;
    const step = usable / (total - 1);
    return b.y + pad + idx * step;
  }

  const edgesHTML = sorted.map(e => {
    const from = boxes[e.from_node_id], to = boxes[e.to_node_id];
    if(!from||!to) return '';
    // All outputs from right edge, all inputs to left edge
    const sx = from.x + from.w;
    const sy = spreadY(e.from_node_id, 'out', edgeOutIdx[e.id], outCount[e.from_node_id]);
    const ex = to.x;
    const ey = spreadY(e.to_node_id, 'in', edgeInIdx[e.id], inCount[e.to_node_id]);
    const hOff = Math.max(40, Math.min(120, Math.abs(ex - sx) * 0.55));
    const sel = dagState.selectedEdge===e.id;
    return `<path class="dag-edge" data-edge-id="${e.id}" d="M${sx},${sy} C${sx+hOff},${sy} ${ex-hOff},${ey} ${ex},${ey}" stroke-width="${sel?2.5:1.5}" stroke="${sel?'#2563eb':'#6b7280'}"/>`;
  }).join('');

  svg.innerHTML = `<defs><marker id="arrowhead" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto"><polygon points="0 0, 6 2.5, 0 5" fill="#6b7280"/></marker></defs>
    ${edgesHTML}
    ${dagState.nodes.map(n=>`
      <g class="dag-node ${dagState.selectedNode===n.id?'selected':''}" data-node-id="${n.id}" transform="translate(${n.pos_x},${n.pos_y})">
        <rect width="${n._w}" height="30" rx="4"/>
        <text x="${n._w/2}" y="19">${escapeHtml(n.env_name||n.env_code)}</text>
      </g>
    `).join('')}`;
  updateNodeConfig();
}

function updateNodeConfig() {
  const panel = document.getElementById('node-config');
  if (!panel) return;
  if (!dagState.selectedNode) {
    if (dagState.selectedEdge) {
      const ed = dagState.edges.find(e=>e.id===dagState.selectedEdge);
      const from = dagState.nodes.find(n=>n.id===ed?.from_node_id);
      const to = dagState.nodes.find(n=>n.id===ed?.to_node_id);
      if (from && to) {
        panel.innerHTML = '<h4 style="font-size:13px;font-weight:600;margin-bottom:8px">选中边</h4><p style="font-size:13px;margin-bottom:12px">'+escapeHtml(from.env_name||from.env_code)+' → '+escapeHtml(to.env_name||to.env_code)+'</p><button class="btn btn-danger btn-sm" onclick="deleteDagEdge('+dagState.selectedEdge+')">删除此边</button>';
      } else {
        panel.innerHTML = '<span style="color:var(--text-muted)">点击画布中的节点进行配置<br><br><strong>操作:</strong><br>· 拖拽空白平移画布<br>· 点击节点选中<br>· Shift+点击两个节点创建边<br>· 点击边选中后右侧删除</span>';
      }
    } else {
      panel.innerHTML = '<span style="color:var(--text-muted)">点击画布中的节点进行配置<br><br><strong>操作:</strong><br>· 拖拽空白平移画布<br>· 点击节点选中<br>· Shift+点击两个节点创建边<br>· 点击边选中后右侧删除</span>';
    }
    return;
  }

  const n = dagState.nodes.find(x=>x.id===dagState.selectedNode);
  if (!n) return;
  const webhookUrl = n.webhook_token ? `http://localhost:8080/api/hooks/promote/__STAGE_ID__?token=${escapeHtml(n.webhook_token)}` : '(保存后生成)';
  panel.innerHTML = `
    <h4 style="font-size:13px;font-weight:600;margin-bottom:8px">节点: ${escapeHtml(n.env_name||n.env_code)}</h4>
    <div class="form-group"><label class="form-label">环境</label><select class="form-control" onchange="updateNodeProp(\'env\',this.value)"><option value="">选择</option>${envCache.map(e=>`<option value="${escapeHtml(e.Env)}" ${e.Env===n.env_code?'selected':''}>${escapeHtml(e.name)}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">晋级门槛类型</label><select class="form-control" onchange="updateNodeProp(\'gate_type\',this.value)">
      <option value="manual" ${n.gate_type==='manual'?'selected':''}>人工审批</option>
      <option value="auto" ${n.gate_type==='auto'?'selected':''}>无条件晋级</option>
      <option value="api_hook" ${n.gate_type==='api_hook'?'selected':''}>API Hook（外部系统回调）</option>
    </select></div>
    ${n.gate_type==='manual'?`<div class="form-group"><label class="form-label">审批角色（自动创建）</label><code style="display:block;padding:8px;background:#f0fdf4;border-radius:4px;font-size:12px">approver-${escapeHtml(n.env_code||'??')}</code><span style="font-size:11px;color:var(--text-muted)">角色将自动创建并拥有approve权限。在权限管理页面为此角色添加用户。</span></div>`:''}${n.gate_type==='auto'?`<div class="form-group"><span style="font-size:12px;color:#059669">该阶段父环境审批通过后自动晋级，无需人工干预。</span></div>`:''}
    ${n.gate_type==='api_hook'?`<div class="form-group"><label class="form-label">Webhook URL（外部系统调用此地址晋级）</label><code style="display:block;padding:8px;background:#f5f5f4;border-radius:4px;font-size:11px;word-break:break-all;margin-bottom:8px">${webhookUrl}</code><span style="font-size:11px;color:var(--text-muted)">发布启动后，将 __STAGE_ID__ 替换为实际的stage id。外部系统调用此URL即可自动将该阶段从pending推进到in_progress。</span></div>`:''}
    <button class="btn btn-danger btn-sm" onclick="deleteDagNode(${n.id})" style="margin-top:8px">删除此节点</button>`;
}

// Env/role cache for dropdowns
let envCache = [], roleCache = [];

window.updateNodeProp = function(key, val) {
  const node = dagState.nodes.find(n=>n.id===dagState.selectedNode);
  if (!node) return;
  node[key] = val;
  if (key === 'env') {
    const e = envCache.find(x=>x.Env===val);
    if (e) node.env_name = e.name;
    node.env_code = val;
  }
  renderDAG();
};

window.addDagNode = function() {
  const n = { id: dagState.nextId++, env_code: '', env_name: '新节点', pos_x: dagState.nodes.length*110+30, pos_y: dagState.nodes.length*45+50, gate_type: 'manual', approve_role_id: null, webhook_token: '' };
  dagState.nodes.push(n);
  dagState.selectedNode = n.id;
  renderDAG();
};

window.deleteDagNode = function(id) {
  dagState.nodes = dagState.nodes.filter(n=>n.id!==id);
  dagState.edges = dagState.edges.filter(e=>e.from_node_id!==id && e.to_node_id!==id);
  dagState.selectedNode = null;
  renderDAG();
};

window.deleteDagEdge = function(id) {
  dagState.edges = dagState.edges.filter(e=>e.id!==id);
  dagState.selectedEdge = null;
  renderDAG();
};

function autoLayout() {
  if (dagState.nodes.length === 0) return;
  // Topological sort to assign layers
  const inDeg = {}, adj = {};
  dagState.nodes.forEach(n => { inDeg[n.id]=0; adj[n.id]=[]; });
  dagState.edges.forEach(e => { adj[e.from_node_id].push(e.to_node_id); inDeg[e.to_node_id]++; });
  const q = [];
  dagState.nodes.forEach(n => { if(inDeg[n.id]===0) q.push(n.id); });
  const layer = {};
  let maxLayer = 0;
  while (q.length) {
    const u = q.shift();
    for (const v of adj[u]) {
      inDeg[v]--;
      layer[v] = Math.max(layer[v]||0, (layer[u]||0)+1);
      maxLayer = Math.max(maxLayer, layer[v]);
      if (inDeg[v]===0) q.push(v);
    }
  }
  // Count nodes per layer
  const layerNodes = {};
  dagState.nodes.forEach(n => { const l=layer[n.id]||0; if(!layerNodes[l]) layerNodes[l]=[]; layerNodes[l].push(n); });
  // Position nodes
  const layerX = 40, colW = 260, rowH = 50;
  for (let l=0; l<=maxLayer; l++) {
    const ns = layerNodes[l]||[];
    const startY = 40 + Math.max(0, (maxLayer*rowH - ns.length*rowH)/2);
    ns.forEach((n,i) => { n.pos_x = layerX + l*colW; n.pos_y = startY + i*rowH; });
  }
  renderDAG();
  toast('自动排版完成','info');
}

function svgPoint(e) {
  const svg = document.getElementById('dag-svg');
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function setupDAGMouse() {
  const svg = document.getElementById('dag-svg');
  const canvas = document.getElementById('dag-canvas');
  if (!svg || !canvas) return;
  let dragging = null, lastClickNode = null, offsetX = 0, offsetY = 0;
  let panning = false, panStartX = 0, panStartY = 0, panScrollX = 0, panScrollY = 0;

  svg.addEventListener('mousedown', e => {
    const nodeEl = e.target.closest('.dag-node');
    const edgeEl = e.target.closest('.dag-edge');

    // Edge click
    if (edgeEl && !e.shiftKey) {
      const eid = parseInt(edgeEl.dataset.edgeId);
      dagState.selectedEdge = dagState.selectedEdge===eid ? null : eid;
      dagState.selectedNode = null;
      renderDAG();
      return;
    }
    if (e.detail === 2 && edgeEl) {
      const eid = parseInt(edgeEl.dataset.edgeId);
      dagState.edges = dagState.edges.filter(ed=>ed.id!==eid);
      dagState.selectedEdge = null;
      renderDAG();
      return;
    }

    if (!nodeEl) {
      // Start panning on empty space
      dagState.selectedNode = null; dagState.selectedEdge = null;
      panning = true;
      panStartX = e.clientX; panStartY = e.clientY;
      panScrollX = canvas.scrollLeft; panScrollY = canvas.scrollTop;
      renderDAG();
      return;
    }

    const id = parseInt(nodeEl.dataset.nodeId);
    if (e.shiftKey && lastClickNode && lastClickNode !== id) {
      if (!dagState.edges.some(ed=>ed.from_node_id===lastClickNode&&ed.to_node_id===id)) {
        dagState.edges.push({ id: Date.now(), blueprint_id: 0, from_node_id: lastClickNode, to_node_id: id });
      }
      lastClickNode = null;
      renderDAG();
      return;
    }
    lastClickNode = id;
    dagState.selectedNode = id;
    dagState.selectedEdge = null;
    const node = dagState.nodes.find(n=>n.id===id);
    if (node) {
      dragging = node;
      const pt = svgPoint(e);
      offsetX = pt.x - node.pos_x;
      offsetY = pt.y - node.pos_y;
    }
    renderDAG();
  });

  svg.addEventListener('mousemove', e => {
    if (panning) {
      canvas.scrollLeft = panScrollX - (e.clientX - panStartX);
      canvas.scrollTop = panScrollY - (e.clientY - panStartY);
      return;
    }
    if (!dragging) return;
    const pt = svgPoint(e);
    dragging.pos_x = pt.x - offsetX;
    dragging.pos_y = pt.y - offsetY;
    renderDAG();
  });

  svg.addEventListener('mouseup', () => { dragging = null; panning = false; });
  svg.addEventListener('mouseleave', () => { dragging = null; panning = false; });
}

window.deleteBlueprint = async function(id) {
  if (!confirm('确认删除此蓝图？')) return;
  try { await api('/blueprints/'+id, {method:'DELETE'}); toast('已删除'); loadPageBlueprintList(); }
  catch(e) { toast(e.message,'error'); }
};

window.saveBlueprint = async function(id) {
  const name = document.getElementById('bp-name').value.trim();
  if (!name) { toast('请输入蓝图名称','error'); return; }
  const payload = {
    name,
    description: document.getElementById('bp-desc').value.trim(),
    nodes: dagState.nodes.map(n=>({ id:n.id, env_code:n.env_code, env_name:n.env_name, pos_x:n.pos_x, pos_y:n.pos_y, gate_type:n.gate_type, approve_role_id:n.approve_role_id||null, webhook_token:n.webhook_token||'' })),
    edges: dagState.edges.map(e=>({ from_node_id:e.from_node_id, to_node_id:e.to_node_id }))
  };
  try {
    if (id) await api('/blueprints/'+id, {method:'PUT',body:JSON.stringify(payload)});
    else await api('/blueprints', {method:'POST',body:JSON.stringify(payload)});
    toast('蓝图已保存','success');
    loadPageBlueprintList();
  } catch(e) { toast(e.message,'error'); }
};

// Preload envs and roles for dropdowns
(async function(){
  try { envCache = (await api('/environments')).envs||[]; } catch(e) {}
  try { roleCache = (await api('/admin/roles')).roles||[]; } catch(e) {}
})();
