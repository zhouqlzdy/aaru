import { api } from '../api.js';
import { toast, showLoading, escapeHtml, filterDUsByPermission, crAssignValueColors, crArrSummary, summarizeValue, CR_INIT_DB_FIELDS, autoUpdateInitDbUrls } from '../utils.js';

// ===== Batch Release =====
let brStep = 1;
let brTitle = '';
let brDUList = [];
let brSelectedDUs = [];    // [{code, system, silo}]
let brBlueprints = [];
let brSelectedBP = null;
let brNewVersion = '';
let brSnapshots = {};      // {duCode: [snapshots]}
let brFilterSilo = '';
let brFilterSystem = '';
let brBlueprintEnvs = new Set();

async function renderBatchRelease(body, actions) {
  if (!body) body = document.getElementById('content-body');
  // 重置状态
  brStep = 1; brSelectedDUs = []; brSelectedBP = null; brNewVersion = ''; brTitle = ''; brSnapshots = {}; brFilterSilo = ''; brFilterSystem = ''; brBlueprintEnvs = new Set();
  showLoading(body);
  try { const d = await api('/du-list'); brDUList = d.deploy_units||[]; } catch(e) { brDUList = []; }
  try { const d = await api('/blueprints'); brBlueprints = d.blueprints||[]; } catch(e) { brBlueprints = []; }
  brRenderBody();
}

function brRenderBody() {
  const body = document.getElementById('content-body');
  const actions = document.getElementById('header-actions');
  if (actions) actions.innerHTML = '';
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.overflow = 'hidden';
  const step = brStep;
  const steps = ['选择DU与蓝图','设置版本','预览'];
  const circles = steps.map((s,i)=>{
    const n = i+1;
    const cls = n===step?'active':(n<step?'done':'');
    const circle = `<div class="cr-wizard-step ${cls}"><div class="cr-wizard-num">${n<step?'✓':n}</div></div>`;
    const line = i<steps.length-1?`<div class="cr-wizard-line ${n<step?'done':''}"></div>`:'';
    return circle + line;
  }).join('');
  const labels = steps.map((s,i)=>{
    const n = i+1;
    const cls = n===step?'active':(n<step?'done':'');
    const col = `<div class="cr-wizard-step ${cls}"><div class="cr-wizard-label-col"><div class="cr-wizard-label">${s}</div></div></div>`;
    const space = i<steps.length-1?`<div class="cr-wizard-label-space"></div>`:'';
    return col + space;
  }).join('');
  const wizard = `<div class="cr-wizard"><div class="cr-wizard-circles">${circles}</div><div class="cr-wizard-labels">${labels}</div></div>`;
  let html;
  try {
    switch(step) {
      case 1: html = brStep1(); break;
      case 2: html = brStep2(); break;
      case 3: html = brStep3(); break;
      default: html = brStep1();
    }
  } catch(e) {
    console.error('brRenderBody error:', e);
    toast('页面渲染失败: '+e.message, 'error');
    html = { content: '<div class="empty-state"><p>渲染出错: '+escapeHtml(e.message)+'</p></div>', actions: '<button class="btn btn-secondary" onclick="loadPage(\'batch-release\')">重新开始</button>' };
  }
  body.innerHTML = `<div style="display:flex;flex-direction:column;flex:1;min-height:0">${wizard}<div class="card" style="flex:1;min-height:0;display:flex;flex-direction:column"><div class="card-body" style="flex:1;min-height:0;overflow-y:auto">${html.content}</div></div><div class="cr-actions" style="flex-shrink:0">${html.actions}</div></div>`;
}

// Step 1: Select DUs + Blueprint
function brStep1() {

  // 按用户权限过滤 DU 列表
  const permittedDUs = filterDUsByPermission(brDUList);
  const siloSet = new Set(), sysSet = new Set();
  permittedDUs.forEach(d => { if(d.silo) siloSet.add(d.silo); if(d.system) sysSet.add(d.system); });
  const silos = [...siloSet].sort(), systems = [...sysSet].sort();

  // 应用过滤条件
  let filteredDUs = permittedDUs;
  if (brFilterSilo) filteredDUs = filteredDUs.filter(d=>d.silo===brFilterSilo);
  if (brFilterSystem) filteredDUs = filteredDUs.filter(d=>d.system===brFilterSystem);
  const duListHTML = brRenderDUList(filteredDUs);
  const selectedCount = brSelectedDUs.length;
  const selectedTags = brSelectedDUs.map(d => `<span style="display:inline-block;background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px;font-size:12px;margin:2px">${escapeHtml(d.code)} <span style="cursor:pointer;margin-left:4px" onclick="brRemoveDU('${escapeHtml(d.code)}')">✕</span></span>`).join('');

  return {
    content: `
      <div style="display:grid;grid-template-columns:1fr 300px;gap:20px;height:100%">
        <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
          <div class="cr-section" style="margin-bottom:0"><div class="cr-section-title">选择部署单元（可多选）</div>
            <div style="display:flex;gap:8px;margin-bottom:12px">
              <select class="form-control" id="br-silo" onchange="brFilterDUList()" style="width:auto"><option value="">全部竖井</option>${silos.map(c=>`<option value="${escapeHtml(c)}" ${brFilterSilo===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select>
              <select class="form-control" id="br-system" onchange="brFilterDUList()" style="width:auto"><option value="">全部系统</option>${systems.map(c=>`<option value="${escapeHtml(c)}" ${brFilterSystem===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select>
            </div>
            <div id="br-du-list" style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px">${duListHTML}</div>
            <div style="margin-top:8px;font-size:12px;color:var(--text-muted)">已选 <strong>${selectedCount}</strong> 个部署单元</div>
            <div style="margin-top:4px">${selectedTags}</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="cr-section" style="margin-bottom:0"><div class="cr-section-title">选择晋级蓝图</div>
            <div class="form-group">
              <select class="form-control" id="br-bp-select" onchange="brSelectBP(parseInt(this.value))">
                <option value="">请选择蓝图</option>
                ${brBlueprints.map(b=>`<option value="${b.id}" ${brSelectedBP&&brSelectedBP.id===b.id?'selected':''}>${escapeHtml(b.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="cr-section" style="margin-bottom:0"><div class="cr-section-title">基本信息</div>
            <div class="form-group"><label class="form-label">发布标题</label>
              <input class="form-control" id="br-title" value="${escapeHtml(brTitle)}" placeholder="例: v2.3.0 全量发版" onchange="brTitle=this.value"></div>
          </div>
        </div>
      </div>`,
    actions: `
      <button class="btn btn-secondary" onclick="loadPage('releases')">取消</button>
      <button class="btn btn-primary" id="br-next1" onclick="if(!this.disabled)brGoStep2()" ${brSelectedDUs.length>0&&brSelectedBP?'':'disabled'}>下一步: 设置版本 →</button>`
  };
}

function brRenderDUList(dus) {
  if (!dus||dus.length===0) return '<div class="empty-state"><p>无匹配的部署单元</p></div>';
  return dus.map(d=>{
    const sel = brSelectedDUs.some(s=>s.code===d.code) ? 'selected' : '';
    return `<div class="du-list-item ${sel}" onclick='brToggleDU(${JSON.stringify(d).replace(/'/g,"&#39;")})' style="margin-bottom:4px">
      <div class="du-item-code">${escapeHtml(d.code)}</div>
      <div class="du-item-meta">Silo: ${escapeHtml(d.silo||'-')} / System: ${escapeHtml(d.system||'-')}</div>
    </div>`;
  }).join('');
}

window.brFilterDUList = function() {
  brFilterSilo = document.getElementById('br-silo')?.value||'';
  brFilterSystem = document.getElementById('br-system')?.value||'';
  let dus = filterDUsByPermission(brDUList);
  if (brFilterSilo) dus = dus.filter(d=>d.silo===brFilterSilo);
  if (brFilterSystem) dus = dus.filter(d=>d.system===brFilterSystem);
  document.getElementById('br-du-list').innerHTML = brRenderDUList(dus);
};

window.brToggleDU = function(d) {
  const idx = brSelectedDUs.findIndex(s=>s.code===d.code);
  if (idx >= 0) brSelectedDUs.splice(idx, 1);
  else brSelectedDUs.push({code: d.code, system: d.system||'', silo: d.silo||''});
  brRenderBody();
};

window.brRemoveDU = function(code) {
  brSelectedDUs = brSelectedDUs.filter(d=>d.code!==code);
  brRenderBody();
};

window.brSelectBP = function(id) {
  brSelectedBP = id ? (brBlueprints.find(b=>b.id===id)||null) : null;
  document.getElementById('br-next1').disabled = !(brSelectedDUs.length>0 && brSelectedBP);
};

window.brGoStep1 = function() {
  brStep = 1;
  brRenderBody();
};

window.brBackToStep = function(step) {
  brStep = step;
  brRenderBody();
};

window.brGoStep2 = async function() {
  if (!brSelectedDUs.length || !brSelectedBP) return;
  brTitle = document.getElementById('br-title')?.value || brTitle || ('批量升级 ' + brSelectedDUs.map(d=>d.code).join(', '));
  // 获取蓝图环境列表
  try {
    const bpDetail = await api('/blueprints/'+brSelectedBP.id);
    brBlueprintEnvs = new Set((bpDetail.nodes||[]).map(n=>n.env_code));
  } catch(e) { brBlueprintEnvs = new Set(); }
  // 用户已离开此步骤，中止
  if (brStep !== 1) return;
  // 预加载各DU的快照，只保留蓝图环境
  brSnapshots = {};
  await Promise.all(brSelectedDUs.map(async d => {
    try {
      const data = await api('/deploy-units/'+encodeURIComponent(d.code)+'/compare');
      const all = data.snapshots||[];
      brSnapshots[d.code] = all.filter(s => brBlueprintEnvs.has(s.env));
    } catch(e) { brSnapshots[d.code] = []; }
  }));
  // 用户已离开此步骤，中止
  if (brStep !== 1) return;
  brStep = 2;
  brRenderBody();
};

// Step 2: Set version
function brStep2() {
  // 收集所有环境（取第一个DU的快照环境列表作为列头）
  const envOrder = [];
  const envSet = new Set();
  brSelectedDUs.forEach(d => {
    (brSnapshots[d.code]||[]).forEach(s => {
      if (!envSet.has(s.env)) { envSet.add(s.env); envOrder.push({code: s.env, name: s.env_name||s.env}); }
    });
  });
  const envCols = envOrder;

  // 构建每行：DU | env1版本 | env2版本 | ...
  const tableRows = brSelectedDUs.map(d => {
    const snaps = brSnapshots[d.code]||[];
    const snapMap = new Map(snaps.map(s => [s.env, s]));
    const vals = envCols.map(e => (snapMap.get(e.code)?.fields||{}).ArtifactVersion || '-');
    const colors = crAssignValueColors(vals);
    const cells = envCols.map((e, i) => {
      const ver = vals[i];
      return `<td style="text-align:center;background:${colors[i]}"><code style="font-size:12px">${escapeHtml(ver)}</code></td>`;
    }).join('');
    return `<tr><td style="font-weight:500;white-space:nowrap;position:sticky;left:0;background:#fff;z-index:1">${escapeHtml(d.code)}</td>${cells}</tr>`;
  }).join('');

  const envThs = envCols.map(e => `<th style="text-align:center;white-space:nowrap">${escapeHtml(e.name)}<br><span style="font-size:10px;font-weight:400;color:var(--text-muted)">${escapeHtml(e.code)}</span></th>`).join('');
  const duInfoHTML = envCols.length > 0
    ? `<div style="overflow-x:auto"><table class="data-table"><thead><tr><th style="position:sticky;left:0;background:#fafafa;z-index:1">DU</th>${envThs}</tr></thead><tbody>${tableRows}</tbody></table></div>`
    : '<div class="empty-state"><p>无环境数据</p></div>';

  return {
    content: `
      <div class="cr-section"><div class="cr-section-title">设置新版本</div>
        <div class="form-group"><label class="form-label">新 ArtifactVersion</label>
          <input class="form-control" id="br-version" value="${escapeHtml(brNewVersion)}" placeholder="例: v2.3.0" oninput="brSetVersion(this.value)" style="max-width:400px">
          <div style="margin-top:8px;padding:8px 12px;background:#fef3c7;border-radius:6px;font-size:12px;color:#92400e">
            🔗 initDb / initDbAuth / initDbFinal / ImportData 中的代码仓库 URL tag 将随版本自动同步
          </div>
        </div>
      </div>
      <div class="cr-section"><div class="cr-section-title">各DU当前版本</div>${duInfoHTML}</div>`,
    actions: `
      <button class="btn btn-secondary" onclick="brGoStep1()">← 上一步</button>
      <button class="btn btn-primary" id="br-next2" onclick="brGoStep3()" ${brNewVersion?'':'disabled'}>下一步: 预览 →</button>`
  };
}

window.brSetVersion = function(val) {
  brNewVersion = val;
  const btn = document.getElementById('br-next2');
  if (btn) btn.disabled = !brNewVersion;
};

window.brGoStep3 = function() {
  brNewVersion = document.getElementById('br-version')?.value || brNewVersion;
  if (!brNewVersion) { toast('请填写新版本号','error'); return; }
  brStep = 3;
  brRenderBody();
};

// Step 3: Preview
function brStep3() {
  const initDbFields = ['initDb','initDbAuth','initDbFinal','ImportData'];
  let totalEnvs = 0;

  const duPreviewHTML = brSelectedDUs.map(d => {
    const snaps = brSnapshots[d.code]||[];
    let duEnvCount = 0;
    const envRows = snaps.map(s => {
      const fields = s.fields||{};
      const oldVer = fields.ArtifactVersion||'-';
      if (oldVer === brNewVersion) return '';
      duEnvCount++;
      const initDbUpdates = initDbFields.filter(f => {
        const val = fields[f];
        if (!val) return false;
        return autoUpdateInitDbUrls(val, brNewVersion) !== null;
      });
      const initDbTag = initDbUpdates.length > 0
        ? `<div style="margin-top:4px;font-size:11px;color:#f59e0b">🔗 ${initDbUpdates.join(', ')} 自动同步</div>` : '';
      return `<tr>
        <td>${escapeHtml(s.env_name||s.env)}</td>
        <td><code>${escapeHtml(oldVer)}</code></td>
        <td><code style="color:#16a34a;font-weight:600">${escapeHtml(brNewVersion)}</code>${initDbTag}</td>
      </tr>`;
    }).filter(Boolean).join('');
    totalEnvs += duEnvCount;
    if (!envRows) return `<div class="cr-preview-env"><div class="cr-preview-env-header">📍 ${escapeHtml(d.code)}</div><div style="padding:12px;color:var(--text-muted)">所有环境已是目标版本</div></div>`;
    return `<div class="cr-preview-env">
      <div class="cr-preview-env-header">📍 ${escapeHtml(d.code)} <span style="font-weight:400;font-size:11px;color:var(--text-muted)">${duEnvCount}个环境将更新</span></div>
      <div class="cr-preview-env-body"><table class="data-table"><thead><tr><th>环境</th><th>当前版本</th><th>变更后</th></tr></thead><tbody>${envRows}</tbody></table></div>
    </div>`;
  }).join('');

  return {
    content: `
      <div class="cr-section"><div class="cr-section-title">批量发布预览</div>
        <div style="margin-bottom:8px"><strong>标题:</strong> ${escapeHtml(brTitle)}</div>
        <div style="margin-bottom:8px"><strong>蓝图:</strong> ${escapeHtml(brSelectedBP?.name||'')}</div>
        <div style="margin-bottom:8px"><strong>版本:</strong> → <code style="color:#16a34a;font-weight:600">${escapeHtml(brNewVersion)}</code></div>
        <div style="margin-bottom:16px;font-size:12px;color:var(--text-muted)">将创建 ${brSelectedDUs.length} 个发布单，涉及 ${totalEnvs} 个环境更新</div>
      </div>
      <div class="cr-section"><div class="cr-section-title">各DU变更预览</div>${duPreviewHTML}</div>`,
    actions: `
      <button class="btn btn-secondary" onclick="brBackToStep(2)">← 上一步</button>
      <button class="btn btn-success" id="br-submit-btn" onclick="brSubmitBatch()">确认批量发布</button>`
  };
}

window.brSubmitBatch = async function() {
  const btn = document.getElementById('br-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = '创建中...'; }
  try {
    const data = await api('/batch-releases', {
      method: 'POST',
      body: JSON.stringify({
        title: brTitle,
        du_codes: brSelectedDUs.map(d=>d.code),
        blueprint_id: brSelectedBP.id,
        version: brNewVersion
      })
    });
    toast(`批量发布成功，已创建 ${data.count||0} 个发布单`, 'success');
    brStep = 1; brSelectedDUs = []; brSelectedBP = null; brNewVersion = ''; brTitle = ''; brSnapshots = {}; brFilterSilo = ''; brFilterSystem = ''; brBlueprintEnvs = new Set();
    loadPage('releases');
  } catch(e) { toast(e.message, 'error'); if (btn) { btn.disabled = false; btn.textContent = '确认批量发布'; } }
};

window.renderBatchRelease = renderBatchRelease;

export { renderBatchRelease };
