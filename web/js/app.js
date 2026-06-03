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
  const names = {draft:'草稿',in_progress:'进行中',approved:'已通过',pushing:'推送中',completed:'已完成',rejected:'已驳回',failed:'失败',rolled_back:'已回滚',pending:'待处理',skipped:'已跳过'};
  return `<span class="status-badge status-${status}">${names[status]||status}</span>`;
}

async function checkAuth() {
  try {
    const data = await api('/current-user');
    if (!data) return;
    currentUser = data;
    document.getElementById('user-name').textContent = data.username;
    document.getElementById('user-avatar').textContent = (data.username||'A')[0].toUpperCase();
    const roles = (data.roles||[]).map(r=>r.name);
    document.getElementById('user-role').textContent = roles.join(', ') || '无角色';
    if (roles.includes('admin')) {
      document.getElementById('nav-admin').style.display = '';
    }
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
  // 重置 content-body 样式（create-release 页面会修改）
  body.style.display = '';
  body.style.flexDirection = '';
  body.style.overflow = '';

  switch(page) {
    case 'releases': setPage('releases','发布管理','管理应用发布流水线'); renderReleaseList(body,actions); break;
    case 'create-release': setPage('releases','新建发布','创建新的发布单'); renderCreateRelease(body,actions); break;
    case 'batch-release': setPage('releases','批量发布','多个部署单元统一升级版本'); renderBatchRelease(body,actions); break;
    case 'release-detail': setPage('releases','发布详情','查看发布流水线进度'); renderReleaseDetail(body,param); break;
    case 'deploy-units': setPage('deploy-units','部署单元','浏览各环境的部署单元'); renderDeployUnits(body); break;
    case 'approvals': setPage('approvals','审批中心','处理待审批的发布'); renderApprovals(body); break;
    case 'blueprints': loadPageBlueprintList(body); break;
    case 'admin':
      if (!currentUser?.roles?.some(r=>r.name==='admin')) { toast('无权限访问','error'); loadPage('releases'); return; }
      setPage('admin','权限管理','管理用户角色和权限'); renderAdmin(body); break;
    default: loadPage('releases');
  }
}

// ===== Releases =====
let releaseStagesMap = {}; // {releaseId: stages[]}

async function renderReleaseList(body, actions) {
  actions.innerHTML = '<button class="btn btn-primary" onclick="loadPage(\'create-release\')">+ 新建发布</button> <button class="btn btn-secondary" onclick="loadPage(\'batch-release\')">⚡ 批量发布</button>';
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
    // 缓存每条发布的stages供蓝图模态框使用
    releaseStagesMap = {};
    releases.forEach(r => { releaseStagesMap[r.id] = r.stages || []; });
    body.innerHTML = `<div class="card"><table class="data-table"><thead><tr><th>标题</th><th>部署单元</th><th>版本</th><th>蓝图</th><th>状态</th><th>创建者</th><th>时间</th><th>操作</th></tr></thead><tbody>${releases.map(r=>{
      const bpName = r.blueprint?.name||'';
      const bpId = r.blueprint_id||0;
      const bpCell = bpName ? `<a href="#" class="text-link" onclick="showBlueprintModal(${bpId},${r.id});return false" title="查看蓝图详情">${escapeHtml(bpName)}</a>` : '-';
      return `<tr>
      <td><a href="#" class="text-link" onclick="loadPage('release-detail',${r.id});return false">${escapeHtml(r.title)}</a></td>
      <td>${escapeHtml(r.deploy_unit_code||'')}</td>
      <td><code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-size:12px">${escapeHtml(r.version||'')}</code></td>
      <td>${bpCell}</td>
      <td>${statusHTML(r.status)}</td>
      <td>${escapeHtml(r.created_by?.username||'')}</td>
      <td>${fmtTime(r.created_at)}</td>
      <td class="action-group">${r.status==='draft'?'<button class="btn btn-sm btn-primary" onclick="startRelease('+r.id+')">开始发布</button>':''}${r.status==='in_progress'||r.status==='completed'?'<button class="btn btn-sm btn-secondary" onclick="loadPage(\'release-detail\','+r.id+')">查看</button>':''}${r.status==='completed'||r.status==='in_progress'?'<button class="btn btn-sm btn-danger" onclick="rollbackRelease('+r.id+')">回滚</button>':''}</td>
    </tr>`}).join('')}</tbody></table></div>`;
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

// 渲染发布流水线DAG（只读，基于蓝图拓扑+阶段状态着色）
async function renderReleasePipeline(blueprintId, stages) {
  const container = document.getElementById('release-pipeline-container');
  if (!container) return;

  try {
    const bp = await api('/blueprints/' + blueprintId);
    const nodes = bp.nodes || [];
    const edges = bp.edges || [];

    if (nodes.length === 0) {
      container.innerHTML = '<div style="text-align:center;color:var(--text-muted)">蓝图无环境节点</div>';
      return;
    }

    // 构建 stageByNodeId 映射
    const stageByNode = new Map();
    const stageByEnv = new Map();
    stages.forEach(s => {
      if (s.node_id) stageByNode.set(s.node_id, s);
      stageByEnv.set(s.env_code, s);
    });

    // 计算节点宽高
    const nodeH = 36, nodePadX = 24;
    nodes.forEach(n => {
      const label = n.env_name || n.env_code || '';
      n._w = Math.max(90, Math.min(220, label.length * 10 + nodePadX * 2));
    });

    // 自动布局：按拓扑分层
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const childrenOf = new Map();
    const inDeg = new Map();
    nodes.forEach(n => { childrenOf.set(n.id, []); inDeg.set(n.id, 0); });
    edges.forEach(e => {
      childrenOf.get(e.from_node_id)?.push(e.to_node_id);
      inDeg.set(e.to_node_id, (inDeg.get(e.to_node_id) || 0) + 1);
    });

    // Kahn分层
    const layers = [];
    let queue = nodes.filter(n => (inDeg.get(n.id) || 0) === 0).map(n => n.id);
    const assigned = new Set();
    while (queue.length) {
      layers.push(queue);
      queue.forEach(id => assigned.add(id));
      const next = [];
      queue.forEach(id => {
        (childrenOf.get(id) || []).forEach(cid => {
          inDeg.set(cid, inDeg.get(cid) - 1);
          if (inDeg.get(cid) === 0 && !assigned.has(cid)) next.push(cid);
        });
      });
      queue = next;
    }
    // 如果有未分配的节点（环），追加到最后
    nodes.forEach(n => { if (!assigned.has(n.id)) layers.push([n.id]); });

    // 计算位置
    const layerGapX = 260, nodeGapY = 24;
    layers.forEach((layer, li) => {
      const layerW = layer.reduce((sum, nid) => sum + (nodeById.get(nid)?._w || 100) + (sum > 0 ? nodeGapY : 0), 0);
      let curY = 0;
      layer.forEach((nid, ni) => {
        const n = nodeById.get(nid);
        if (!n) return;
        n._px = li * layerGapX;
        n._py = curY;
        curY += (n._w || 100) + nodeGapY; // 这里用_w做间距不太好，改为固定
      });
      // 重新用固定间距
      curY = 0;
      layer.forEach((nid, ni) => {
        const n = nodeById.get(nid);
        if (!n) return;
        n._py = curY;
        curY += nodeH + nodeGapY;
      });
      // 居中对齐
      const totalH = layer.length * nodeH + (layer.length - 1) * nodeGapY;
      layer.forEach(nid => {
        const n = nodeById.get(nid);
        if (n) n._py = n._py - totalH / 2;
      });
    });

    // 计算SVG尺寸
    const maxLayerLen = Math.max(...layers.map(l => l.length));
    const svgW = layers.length * layerGapX + 120;
    const svgH = maxLayerLen * (nodeH + nodeGapY) + 80;
    const offsetX = 40, offsetY = svgH / 2;

    // 确定每个节点的状态
    function getNodeStatus(n) {
      const s = stageByNode.get(n.id) || stageByEnv.get(n.env_code);
      return s?.status || 'pending';
    }

    // 判断边是否"已完成"（from节点completed且to节点至少in_progress）
    function getEdgeClass(e) {
      const fromSt = getNodeStatus(nodeById.get(e.from_node_id));
      const toSt = getNodeStatus(nodeById.get(e.to_node_id));
      if (fromSt === 'completed' && (toSt === 'completed' || toSt === 'in_progress' || toSt === 'pushing' || toSt === 'approved')) return 'completed';
      if (fromSt === 'completed' || fromSt === 'in_progress' || fromSt === 'approved') return 'active';
      return '';
    }

    // 渲染边
    const edgesHTML = edges.map(e => {
      const from = nodeById.get(e.from_node_id), to = nodeById.get(e.to_node_id);
      if (!from || !to) return '';
      const sx = offsetX + from._px + from._w;
      const sy = offsetY + from._py + nodeH / 2;
      const ex = offsetX + to._px;
      const ey = offsetY + to._py + nodeH / 2;
      const hOff = Math.max(40, Math.abs(ex - sx) * 0.4);
      const cls = getEdgeClass(e);
      return `<path class="pipeline-dag-edge ${cls}" d="M${sx},${sy} C${sx+hOff},${sy} ${ex-hOff},${ey} ${ex},${ey}"/>`;
    }).join('');

    // 渲染节点
    const statusLabel = { pending:'待处理', in_progress:'进行中', approved:'已通过', pushing:'推送中', completed:'已完成', rejected:'已驳回' };
    const nodesHTML = nodes.map(n => {
      const st = getNodeStatus(n);
      const active = st === 'in_progress' || st === 'pushing' || st === 'approved';
      const label = n.env_name || n.env_code;
      const x = offsetX + n._px, y = offsetY + n._py;
      return `<g class="pipeline-dag-node status-${st}${active?' active':''}" transform="translate(${x},${y})">
        <rect width="${n._w}" height="${nodeH}"/>
        <text x="${n._w/2}" y="${nodeH/2 + 1}">${escapeHtml(label)}</text>
      </g>`;
    }).join('');

    // 图例
    const legendItems = [
      {fill:'#f4f4f5', stroke:'#d1d5db', label:'待处理'}, {fill:'#dbeafe', stroke:'#3b82f6', label:'进行中'},
      {fill:'#ede9fe', stroke:'#8b5cf6', label:'已通过'}, {fill:'#fef3c7', stroke:'#f59e0b', label:'推送中'},
      {fill:'#d1fae5', stroke:'#10b981', label:'已完成'}, {fill:'#fee2e2', stroke:'#ef4444', label:'已驳回'}
    ];
    const legendHTML = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">${legendItems.map(item =>
      `<div style="display:flex;align-items:center;gap:4px;font-size:11px"><svg width="14" height="14"><rect width="14" height="14" rx="3" fill="${item.fill}" stroke="${item.stroke}" stroke-width="1.5"/></svg>${item.label}</div>`
    ).join('')}</div>`;

    container.innerHTML = `<div class="pipeline-dag-container"><svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
      <defs><marker id="pipeline-arrow" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto"><polygon points="0 0, 6 2.5, 0 5" fill="#9ca3af"/></marker>
      <marker id="pipeline-arrow-done" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto"><polygon points="0 0, 6 2.5, 0 5" fill="#10b981"/></marker></defs>
      ${edgesHTML}
      ${nodesHTML}
    </svg></div>${legendHTML}`;

    // 给边添加箭头（通过CSS marker-end在SVG内联中不生效，用JS补）
    container.querySelectorAll('.pipeline-dag-edge').forEach(el => {
      if (el.classList.contains('completed')) el.style.markerEnd = 'url(#pipeline-arrow-done)';
      else el.style.markerEnd = 'url(#pipeline-arrow)';
    });

  } catch(e) {
    container.innerHTML = `<div style="color:#ef4444">流水线加载失败: ${escapeHtml(e.message)}</div>`;
  }
}

async function renderReleaseDetail(body, id) {
  showLoading(body);
  try {
    const r = await api('/releases/'+id);
    if (!r) return;
    const stages = r.stages||[];

    // Changes summary
    const changes = r.changes||{};
    const changeKeys = Object.keys(changes);
    let changesHTML = '';
    if (changeKeys.length > 0) {
      const rows = changeKeys.map(k=>{
        const v = changes[k];
        const disp = Array.isArray(v)?JSON.stringify(v):String(v);
        return `<tr><td><strong>${escapeHtml(k)}</strong></td><td style="word-break:break-all;max-width:400px;white-space:pre-wrap;font-size:12px">${escapeHtml(disp)}</td></tr>`;
      }).join('');
      changesHTML = `<div class="card" style="margin-bottom:24px"><div class="card-header"><div class="card-title">变更内容</div></div><div class="card-body"><table class="data-table"><thead><tr><th>字段</th><th>目标值</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    }

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
    ${changesHTML}
    <div class="card" style="margin-bottom:24px"><div class="card-header"><div class="card-title">发布流水线</div></div><div class="card-body" id="release-pipeline-container"><div style="text-align:center;color:var(--text-muted)">加载流水线…</div></div></div>
    <div class="card"><div class="card-header"><div class="card-title">阶段详情</div></div><div class="card-body" id="stage-table-container"><div style="text-align:center;color:var(--text-muted)">加载中…</div></div></div>`;

    // 异步加载蓝图并渲染DAG流水线
    if (r.blueprint_id) {
      renderReleasePipeline(r.blueprint_id, stages);
    }

    // 异步加载DU当前配置快照，用于比对实际差异
    let snapshots = [];
    if (r.deploy_unit_code) {
      try {
        const data = await api('/deploy-units/'+encodeURIComponent(r.deploy_unit_code)+'/compare');
        snapshots = data.snapshots || [];
      } catch(e) { /* 忽略，降级为不比对 */ }
    }
    const stageContainer = document.getElementById('stage-table-container');
    if (stageContainer) {
      stageContainer.innerHTML = renderStageTable(stages, changes, snapshots);
    }
  } catch(e) { body.innerHTML = '<div class="empty-state"><p>加载失败: '+escapeHtml(e.message)+'</p></div>'; }
}

function renderStageTable(stages, changes, snapshots) {
  // 构建 envCode → snapshot fields 映射
  const snapByEnv = new Map();
  (snapshots || []).forEach(s => snapByEnv.set(s.env, s.fields || {}));

  // 解析某个环境的具体变更值
  function resolveForEnv(envCode) {
    const result = {};
    for (const [k, v] of Object.entries(changes || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (v[envCode] !== undefined) result[k] = v[envCode];
        else if (v._default !== undefined) result[k] = v._default;
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  return `<table class="data-table"><thead><tr><th>环境</th><th>顺序</th><th>状态</th><th>审批人</th><th>备注</th><th>变更内容</th></tr></thead><tbody>${stages.map(s=>{
    const envChanges = resolveForEnv(s.env_code);
    const currentFields = snapByEnv.get(s.env_code) || {};

    // 计算合并后的目标值（含 initDb tag 自动同步）
    const merged = {...currentFields};
    Object.entries(envChanges).forEach(([k,v]) => { merged[k] = v; });

    // 如果 ArtifactVersion 有变更，自动同步 initDb 类字段的 URL tag
    const newAV = merged['ArtifactVersion'];
    const autoUpdated = new Set();
    if (newAV && String(newAV) !== String(currentFields['ArtifactVersion'] || '')) {
      CR_INIT_DB_FIELDS.forEach(field => {
        if (envChanges[field] !== undefined) return; // 手动修改了该字段，不覆盖
        const current = currentFields[field];
        const updated = autoUpdateInitDbUrls(current, String(newAV));
        if (updated !== null) {
          merged[field] = updated;
          autoUpdated.add(field);
        }
      });
    }

    // 只保留与当前值不同的字段
    const diffItems = [];
    for (const [k, targetVal] of Object.entries(merged)) {
      const currentVal = currentFields[k] ?? '';
      const targetStr = typeof targetVal === 'object' ? JSON.stringify(targetVal) : String(targetVal ?? '');
      if (targetStr === String(currentVal)) continue;
      // 跳过非变更字段（只展示手动变更 + 自动同步的字段）
      if (!(k in envChanges) && !autoUpdated.has(k)) continue;
      const isComplex = Array.isArray(targetVal) || (typeof targetVal === 'object' && targetVal !== null);
      const disp = isComplex ? crFormatJson(targetStr) : targetStr;
      const display = isComplex
        ? `<span style="font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-all">${escapeHtml(disp.length > 120 ? disp.substring(0,120)+'…' : disp)}</span>`
        : `<span style="font-size:12px">${escapeHtml(disp)}</span>`;
      const autoTag = autoUpdated.has(k) ? ' <span style="font-size:10px;color:#f59e0b" title="随ArtifactVersion自动同步">🔗</span>' : '';
      diffItems.push(`<div style="margin-bottom:4px"><span style="color:var(--text-muted);font-size:11px">${escapeHtml(k)}</span>${autoTag}: ${display}</div>`);
    }
    const changesCell = diffItems.length > 0
      ? `<div style="max-height:200px;overflow:auto">${diffItems.join('')}</div>`
      : '<span style="color:var(--text-muted)">无实际变更</span>';
    return `<tr>
      <td><strong>${escapeHtml(s.env_name||s.env_code)}</strong></td><td>${s.promotion_order+1}</td>
      <td>${statusHTML(s.status)}</td>
      <td>${escapeHtml(s.approved_by?.username||'-')}</td>
      <td>${escapeHtml(s.comment||'-')}</td>
      <td style="min-width:260px">${changesCell}</td>
    </tr>`;
  }).join('')}</tbody></table>`;
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
async function retryPush(id) {
  if (!confirm('确认重试推送配置到DMDB？')) return;
  try { await api('/stages/'+id+'/retry-push', { method:'POST' }); toast('推送成功','success'); loadPage('releases'); }
  catch(e) { toast(e.message,'error'); }
}

// 根据用户 allowed_silos 过滤 DU 列表
function filterDUsByPermission(dus) {
  if (!currentUser || !currentUser.allowed_silos) return [];
  if (currentUser.allowed_silos === '*') return dus;
  const allowed = currentUser.allowed_silos.split(',').map(s=>s.trim()).filter(Boolean);
  if (allowed.length === 0) return [];
  return dus.filter(d => allowed.includes(d.silo));
}

// ===== Create Release Wizard =====
let crStep = 1;
let crTitle = '';
let crDUList = [];
let crSelectedDU = null;
let crSnapshots = [];
let crChanges = {};
let crExtraFields = [];
let crBlueprints = [];
let crSelectedBP = null;
let crBlueprintEnvs = new Set(); // 蓝图涉及的环境代码集合
let crFieldSelOpen = false;
let crPerEnvMode = new Set(); // fields in per-env mode
let crPerEnvVals = {};        // {fieldName: {envCode: val}}

// All editable fields grouped
const CR_SCALAR_FIELDS = [
  'AppName','desc','du_type_code','deploy_type',
  'ArtifactGroupId','ArtifactId','ArtifactVersion',
  'NodeCount','RunAsUser','RunAsGroup','JvmArgs','Loglevel','MetricPort',
  'MaxPollRecords','BatchSize','kafkaTxTimeoutMs','kafkaDeliveryTimeoutMs',
  'ExtraConfig','UseFtp','RemoteDir','dbStreamEnhancedAudit'
];
const CR_ARRAY_FIELDS = [
  'initDb','initDbAuth','initDbFinal','ImportData','initKafka','frameworkDatasource','serviceDatasource','Servers'
];
const CR_INIT_DB_FIELDS = ['initDb', 'initDbAuth', 'initDbFinal', 'ImportData'];
const CR_READONLY_FIELDS = new Set([
  'id','classCode','biz_serial','Env','System','SiloCode','SiloNo',
  'SystemName','belong_System'
]);

async function renderCreateRelease(body, actions) {
  crStep = 1; crTitle = ''; crSelectedDU = null; crSnapshots = [];
  crChanges = {}; crExtraFields = []; crSelectedBP = null; crBlueprintEnvs = new Set();
  crPerEnvMode = new Set(); crPerEnvVals = {};
  body.style.overflow = 'hidden';
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  showLoading(body);
  try { const d = await api('/du-list'); crDUList = d.deploy_units||[]; } catch(e) { crDUList = []; }
  try { const d = await api('/blueprints'); crBlueprints = d.blueprints||[]; } catch(e) { crBlueprints = []; }
  crRenderStep(body);
}

function crRenderStep(body) {
  const actions = document.getElementById('header-actions');
  if (actions) actions.innerHTML = '';
  const steps = ['选择DU与蓝图','查看现状','定义变更','预览'];
  const circles = steps.map((s,i)=>{
    const n = i+1;
    const cls = n===crStep?'active':(n<crStep?'done':'');
    const circle = `<div class="cr-wizard-step ${cls}"><div class="cr-wizard-num">${n<crStep?'✓':n}</div></div>`;
    const line = i<steps.length-1?`<div class="cr-wizard-line ${n<crStep?'done':''}"></div>`:'';
    return circle + line;
  }).join('');
  const labels = steps.map((s,i)=>{
    const n = i+1;
    const cls = n===crStep?'active':(n<crStep?'done':'');
    const col = `<div class="cr-wizard-step ${cls}"><div class="cr-wizard-label-col"><div class="cr-wizard-label">${s}</div></div></div>`;
    const space = i<steps.length-1?`<div class="cr-wizard-label-space"></div>`:'';
    return col + space;
  }).join('');
  const wizard = `<div class="cr-wizard"><div class="cr-wizard-circles">${circles}</div><div class="cr-wizard-labels">${labels}</div></div>`;
  let step;
  switch(crStep) {
    case 1: step = crStep1(); break;
    case 2: step = crStep2(); break;
    case 3: step = crStep3(); break;
    case 4: step = crStep4Preview(); break;
  }
  body.innerHTML = `<div style="display:flex;flex-direction:column;flex:1;min-height:0">${wizard}<div class="card" style="flex:1;min-height:0;display:flex;flex-direction:column"><div class="card-body" style="flex:1;min-height:0;overflow-y:auto">${step.content}</div></div><div class="cr-actions" style="flex-shrink:0">${step.actions}</div></div>`;
}

// ===== Step 1: Select DU + Blueprint =====
function crStep1() {
  // 按用户权限过滤 DU 列表
  const permittedDUs = filterDUsByPermission(crDUList);
  const siloSet = new Set(), sysSet = new Set();
  permittedDUs.forEach(d => { if(d.silo) siloSet.add(d.silo); if(d.system) sysSet.add(d.system); });
  const silos = [...siloSet].sort(), systems = [...sysSet].sort();
  return {
    content: `
      <div style="display:grid;grid-template-columns:320px 1fr;gap:20px;height:100%">
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="cr-section" style="margin-bottom:0;flex-shrink:0"><div class="cr-section-title">基本信息</div>
            <div class="form-group"><label class="form-label">发布标题</label>
              <input class="form-control" id="cr-title" value="${escapeHtml(crTitle)}" placeholder="例: v2.1.0 发版" onchange="crTitle=this.value"></div>
          </div>
          <div class="cr-section" style="margin-bottom:0;flex-shrink:0"><div class="cr-section-title">选择晋级蓝图</div>
            <div class="form-group">
              <select class="form-control" id="cr-bp-select" onchange="crSelectBP(parseInt(this.value))">
                <option value="">请选择蓝图</option>
                ${crBlueprints.map(b=>`<option value="${b.id}" ${crSelectedBP&&crSelectedBP.id===b.id?'selected':''}>${escapeHtml(b.name)}${b.description?' — '+escapeHtml(b.description):''}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="cr-section" style="margin-bottom:0;flex-shrink:0"><div class="cr-section-title">筛选部署单元</div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <select class="form-control" id="cr-silo" onchange="crFilterDUList()" style="font-size:12px">
                <option value="">全部竖井</option>${silos.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
              </select>
              <select class="form-control" id="cr-system" onchange="crFilterDUList()" style="font-size:12px">
                <option value="">全部系统</option>${systems.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;min-height:0;overflow:hidden">
          <div class="cr-section-title" style="flex-shrink:0;margin-bottom:0">选择部署单元</div>
          <div id="cr-du-list" style="flex:1;overflow-y:auto">${crRenderDUList(permittedDUs)}</div>
        </div>
      </div>`,
    actions: `
      <button class="btn btn-secondary" onclick="loadPage('releases')">取消</button>
      <button class="btn btn-primary" id="cr-next1" onclick="crGoStep2()" ${crSelectedDU&&crSelectedBP?'':'disabled'}>下一步: 查看现状 →</button>`
  };
}

function crRenderDUList(dus) {
  if (!dus||dus.length===0) return '<div class="empty-state"><p>无匹配的部署单元</p></div>';
  return dus.map(d=>{
    const sel = crSelectedDU&&crSelectedDU.code===d.code?'selected':'';
    return `<div class="du-list-item ${sel}" onclick='crSelectDU(${JSON.stringify(d).replace(/'/g,"&#39;")})' style="margin-bottom:4px">
      <div class="du-item-code">${escapeHtml(d.code)}</div>
      <div class="du-item-name">${escapeHtml(d.system||'')}</div>
      <div class="du-item-meta">Silo: ${escapeHtml(d.silo||'-')} / System: ${escapeHtml(d.system||'-')}</div>
    </div>`;
  }).join('');
}

window.crFilterDUList = function() {
  const silo = document.getElementById('cr-silo')?.value||'';
  const sys = document.getElementById('cr-system')?.value||'';
  let dus = filterDUsByPermission(crDUList);
  if (silo) dus = dus.filter(d=>d.silo===silo);
  if (sys) dus = dus.filter(d=>d.system===sys);
  document.getElementById('cr-du-list').innerHTML = crRenderDUList(dus);
};

window.crSelectDU = function(d) {
  crSelectedDU = d;
  document.querySelectorAll('#cr-du-list .du-list-item').forEach(el=>{
    el.classList.toggle('selected', el.querySelector('.du-item-code')?.textContent===d.code);
  });
  crUpdateNextBtn();
};

window.crGoStep2 = async function() {
  if (!crSelectedDU || !crSelectedBP) return;
  crTitle = document.getElementById('cr-title')?.value || crTitle;
  crStep = 2;
  const body = document.getElementById('content-body');
  showLoading(body);
  try {
    // 获取蓝图详情以得到环境列表
    const bpDetail = await api('/blueprints/'+crSelectedBP.id);
    crBlueprintEnvs = new Set((bpDetail.nodes||[]).map(n=>n.env_code));
  } catch(e) { crBlueprintEnvs = new Set(); }
  try {
    const data = await api('/deploy-units/'+encodeURIComponent(crSelectedDU.code)+'/compare');
    const allSnapshots = data.snapshots||[];
    // 只保留蓝图相关环境
    crSnapshots = allSnapshots.filter(s => crBlueprintEnvs.has(s.env));
  } catch(e) { crSnapshots = []; }
  crRenderStep(body);
};

// 单元格值颜色表（相同值相同颜色，不同值不同颜色）
const VALUE_COLORS = [
  '#dbeafe', // 蓝
  '#dcfce7', // 绿
  '#fef9c3', // 黄
  '#fce7f3', // 粉
  '#ede9fe', // 紫
  '#ffedd5', // 橙
  '#ccfbf1', // 青
  '#e0e7ff', // 靛
  '#fae8ff', // 洋红
  '#f0f9ff', // 天蓝
];

// 为一行的值分配颜色：相同值→相同颜色，不同值→不同颜色
function crAssignValueColors(vals) {
  const valColorMap = new Map();
  let colorIdx = 0;
  return vals.map(v => {
    const key = String(v);
    if (!valColorMap.has(key)) {
      valColorMap.set(key, VALUE_COLORS[colorIdx % VALUE_COLORS.length]);
      colorIdx++;
    }
    return valColorMap.get(key);
  });
}

// ===== Step 2: View Current State =====
function crStep2() {
  const code = crSelectedDU?.code||'';
  let tableHTML = '';
  if (crSnapshots.length === 0) {
    tableHTML = '<div class="empty-state"><p>未在任何DMDB环境中找到此部署单元</p></div>';
  } else {
    // 收集所有字段（排除展开的子行和只读字段）
    const allKeys = new Set();
    crSnapshots.forEach(s => {
      if(s.fields) Object.keys(s.fields).forEach(k => {
        if(!CR_READONLY_FIELDS.has(k) && !k.includes('[')) allKeys.add(k);
      });
    });
    // 只保留有差异的字段
    const diffKeys = [...allKeys].filter(k => {
      const vals = crSnapshots.map(s=>String((s.fields||{})[k]??''));
      return new Set(vals).size > 1;
    }).sort();
    if (diffKeys.length === 0) {
      tableHTML = '<div class="empty-state"><p>所有环境配置一致，无差异</p></div>';
    } else {
      const envCount = crSnapshots.length;
      const colW = 280;
      tableHTML = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${envCount} 个环境 / ${diffKeys.length} 个差异项</div>
        <div style="overflow:auto;max-height:60vh"><table class="data-table cr-status-table" style="table-layout:fixed;width:${180 + envCount * colW}px">
        <colgroup><col style="width:180px">${crSnapshots.map(()=>`<col style="width:${colW}px">`).join('')}</colgroup>
        <thead><tr><th style="position:sticky;left:0;background:#fafafa;z-index:1">配置项</th>${crSnapshots.map(s=>{
          return `<th style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(s.env_name||s.env)}</th>`;
        }).join('')}</tr></thead>
        <tbody>${diffKeys.map(k=>{
          const isArrayField = CR_ARRAY_FIELDS.includes(k);
          const rawVals = crSnapshots.map(s=>(s.fields||{})[k]??'');
          const dispVals = rawVals.map(v=>isArrayField ? crArrSummary(v) : summarizeValue(v));
          const colors = crAssignValueColors(rawVals);
          return `<tr><td style="position:sticky;left:0;background:#fff;z-index:1"><strong class="diff-field-link" data-field="${escapeHtml(k)}" style="cursor:pointer;color:var(--accent)" title="点击查看详细差异">${escapeHtml(k)}</strong>${isArrayField?' <span style="font-size:10px;color:var(--text-muted)">[数组]</span>':''}</td>${dispVals.map((v,i)=>{
            return `<td style="font-size:12px;word-break:break-all;white-space:pre-wrap;background:${colors[i]}">${v}</td>`;
          }).join('')}</tr>`;
        }).join('')}</tbody></table></div>`;
    }
  }
  return {
    content: `<div class="cr-section"><div class="cr-section-title">${escapeHtml(code)} — 各环境现状</div>${tableHTML}</div>`,
    actions: `
      <button class="btn btn-secondary" onclick="crGoBack(1)">← 上一步</button>
      <button class="btn btn-primary" onclick="crGoStep3()">下一步: 定义变更 →</button>`
  };
}

window.crGoBack = function(step) {
  crStep = step;
  crRenderStep(document.getElementById('content-body'));
};

window.crGoStep3 = function() {
  crStep = 3;
  if (!crChanges.ArtifactVersion && crChanges.ArtifactVersion!=='') crChanges = { ArtifactVersion: '' };
  crRenderStep(document.getElementById('content-body'));
};

// ===== Step 3: Define Changes =====
function crStep3() {
  return {
    content: `
      <div class="cr-section"><div class="cr-section-title">ArtifactVersion（必填）</div>${crRenderFieldRow('ArtifactVersion', true)}</div>
      <div class="cr-section"><div class="cr-section-title">其他变更字段</div>
        ${crExtraFields.map(f=>crRenderExtraField(f)).join('')}
        <div style="position:relative;display:inline-block">
          <button class="cr-add-field-btn" onclick="crToggleFieldSelector(event)">+ 添加字段</button>
          <div id="cr-field-selector" class="cr-field-selector" style="display:none">
            ${crRenderFieldCheckboxes()}
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
              <button class="btn btn-sm btn-primary" onclick="crAddSelectedFields()">确认添加</button>
            </div>
          </div>
        </div>
      </div>`,
    actions: `
      <button class="btn btn-secondary" onclick="crGoBack(2)">← 上一步</button>
      <button class="btn btn-primary" onclick="crGoStep4Preview()">下一步: 预览 →</button>`
  };
}

function crRenderFieldRow(fieldName) {
  if (!crSnapshots.length) return '<p style="color:var(--text-muted)">无环境数据</p>';
  const envs = crSnapshots.map(s=>({code:s.env, name:s.env_name||s.env, val:(s.fields||{})[fieldName]}));
  const rawVals = envs.map(e=>e.val??'');
  const colors = crAssignValueColors(rawVals);
  const isArray = CR_ARRAY_FIELDS.includes(fieldName);
  const perEnv = crPerEnvMode.has(fieldName);

  const firstCol = `<th style="position:sticky;left:0;background:#fafafa;z-index:1;min-width:100px">配置项</th>`;
  const envThs = envs.map(e=>`<th style="white-space:nowrap">${escapeHtml(e.name)}</th>`).join('');

  // 按环境模式：每个环境一列输入框
  if (perEnv) {
    if (!crPerEnvVals[fieldName]) {
      crPerEnvVals[fieldName] = {};
      envs.forEach(e => { crPerEnvVals[fieldName][e.code] = isArray ? (e.val||'') : String(e.val??''); });
    }
    const pv = crPerEnvVals[fieldName];
    const envTds = envs.map((e,i)=>{
      const cur = pv[e.code]??'';
      const inputHtml = isArray
        ? `<textarea rows="3" style="width:100%;min-width:120px;font-size:11px;font-family:monospace" onchange="crSetPerEnv('${fieldName}','${e.code}',this.value)">${escapeHtml(crFormatJson(cur))}</textarea>`
        : `<textarea rows="2" style="width:100%;min-width:120px;font-size:11px" onchange="crSetPerEnv('${fieldName}','${e.code}',this.value)">${escapeHtml(cur)}</textarea>`;
      return `<td style="min-width:140px;vertical-align:top;background:${colors[i]}">${inputHtml}</td>`;
    }).join('');
    const firstTd = `<td style="position:sticky;left:0;background:#fff;z-index:1"><strong class="diff-field-link" data-field="${escapeHtml(fieldName)}" style="cursor:pointer;color:var(--accent)" title="点击查看详细差异">${escapeHtml(fieldName)}</strong> <button class="btn btn-xs btn-secondary" onclick="crTogglePerEnv('${fieldName}',false)" title="收回为统一值">↺</button></td>`;
    return `<div style="overflow-x:auto"><table class="cr-field-table">
      <thead><tr>${firstCol}${envThs}</tr></thead>
      <tbody><tr>${firstTd}${envTds}</tr></tbody></table></div>`;
  }

  // 统一模式
  const newColTh = `<th style="background:#f0fdf4;min-width:220px">新值 <button class="btn btn-xs btn-secondary" onclick="crTogglePerEnv('${fieldName}',true)" title="按环境指定">⇄</button></th>`;

  // 现状值单元格（与查看现状页一致的彩色展示）
  const envTds = envs.map((e,i)=>{
    const disp = isArray ? crArrSummary(e.val) : summarizeValue(e.val);
    return `<td style="font-size:12px;word-break:break-all;white-space:pre-wrap;background:${colors[i]}">${disp}</td>`;
  }).join('');
  const firstTd = `<td style="position:sticky;left:0;background:#fff;z-index:1"><strong class="diff-field-link" data-field="${escapeHtml(fieldName)}" style="cursor:pointer;color:var(--accent)" title="点击查看详细差异">${escapeHtml(fieldName)}</strong></td>`;

  // 新值输入框：统一使用多行textarea
  const currentVal = crChanges[fieldName]||'';
  let inputHtml;
  if (isArray) {
    const displayVal = currentVal ? crFormatJson(currentVal) : '';
    inputHtml = `<td class="new-col" style="vertical-align:top"><textarea rows="4" style="width:100%;min-width:200px;font-family:monospace;font-size:11px" onchange="crSetChange('${fieldName}',this.value)" placeholder='JSON数组，如 [{"id":"1","type":"mysql"}]'>${escapeHtml(displayVal)}</textarea>
      <div style="margin-top:4px"><button class="btn btn-xs btn-secondary" onclick="crFormatJsonInput('${fieldName}')">格式化</button> <span style="font-size:10px;color:var(--text-muted)">留空=不修改</span></div></td>`;
  } else {
    inputHtml = `<td class="new-col" style="vertical-align:top"><textarea rows="2" style="width:100%;min-width:200px;font-size:11px" onchange="crSetChange('${fieldName}',this.value)" placeholder="不填=不修改">${escapeHtml(currentVal)}</textarea>
      <div style="margin-top:4px;font-size:10px;color:var(--text-muted)">留空=不修改</div></td>`;
  }

  return `<div style="overflow-x:auto"><table class="cr-field-table">
    <thead><tr>${firstCol}${newColTh}${envThs}</tr></thead>
    <tbody><tr>${firstTd}${inputHtml}${envTds}</tr></tbody></table></div>`;
}

// 预览页专用：复杂值按实际格式展示，简单值直接显示
function crFormatPreviewValue(v) {
  if (v === null || v === undefined || v === '') return '<span style="color:var(--text-muted)">-</span>';
  const s = String(v);
  // JSON 数组或对象 → 格式化后以等宽块展示
  if ((s.startsWith('[') || s.startsWith('{')) && s.length > 1) {
    try {
      const parsed = JSON.parse(s);
      const formatted = JSON.stringify(parsed, null, 2);
      return `<pre style="margin:0;font-size:11px;font-family:monospace;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow:auto;background:#f9fafb;padding:4px 6px;border-radius:4px">${escapeHtml(formatted)}</pre>`;
    } catch(e) {}
  }
  // 多行字符串
  if (s.includes('\n')) {
    return `<pre style="margin:0;font-size:11px;font-family:monospace;white-space:pre-wrap;word-break:break-all">${escapeHtml(s)}</pre>`;
  }
  return escapeHtml(s);
}

function crArrSummary(v) {
  if (!v||v==='null'||v==='[]') return '<span class="same-val">空</span>';
  try {
    const a=JSON.parse(v);
    if(Array.isArray(a)) {
      if (a.length===0) return '<span class="same-val">空</span>';
      const preview = a.slice(0,3).map(item=>{
        if (typeof item==='object'&&item!==null) {
          const keys = Object.keys(item).slice(0,3).map(k=>`${k}:${JSON.stringify(item[k]).substring(0,20)}`).join(', ');
          return `{${keys}${Object.keys(item).length>3?', ...':''}}`;
        }
        return String(item).substring(0,30);
      }).join(', ');
      return `<span style="font-size:11px">${escapeHtml(preview)}${a.length>3?', ...':''}</span> <span style="font-size:10px;color:var(--text-muted)">(${a.length}项)</span>`;
    }
  } catch(e) {}
  return escapeHtml(String(v).substring(0,80));
}

// 摘要展示复杂值：JSON对象/数组显示预览，长字符串截断
function summarizeValue(v) {
  if (v === null || v === undefined || v === '') return '-';
  const s = String(v);
  // JSON对象
  if (s.startsWith('{') && s.length > 80) {
    try {
      const obj = JSON.parse(s);
      const keys = Object.keys(obj);
      if (keys.length === 0) return '{}';
      const preview = keys.slice(0, 3).map(k => {
        const val = obj[k];
        const vs = typeof val === 'object' ? (Array.isArray(val) ? `[...]` : '{...}') : JSON.stringify(val);
        return `${k}: ${String(vs).substring(0, 24)}`;
      }).join(', ');
      return `<span style="font-size:11px">{${preview}${keys.length > 3 ? ', ...' : ''}}</span> <span style="font-size:10px;color:var(--text-muted)">(${keys.length}个字段)</span>`;
    } catch(e) {}
  }
  // JSON数组
  if (s.startsWith('[') && s.length > 80) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        if (arr.length === 0) return '[]';
        const first = arr[0];
        if (typeof first === 'object' && first !== null) {
          const keys = Object.keys(first).slice(0, 2).map(k => `${k}:${JSON.stringify(first[k]).substring(0, 16)}`).join(', ');
          return `<span style="font-size:11px">[{${keys}}, ...] <span style="color:var(--text-muted)">(${arr.length}项)</span></span>`;
        }
        return `<span style="font-size:11px">[${JSON.stringify(first).substring(0, 30)}${arr.length > 1 ? ', ...' : ''}] <span style="color:var(--text-muted)">(${arr.length}项)</span></span>`;
      }
    } catch(e) {}
  }
  // 长字符串截断
  if (s.length > 100) {
    return `<span style="font-size:11px" title="${escapeHtml(s)}">${escapeHtml(s.substring(0, 80))}...</span> <span style="font-size:10px;color:var(--text-muted)">(${s.length}字符)</span>`;
  }
  return escapeHtml(s);
}

// 格式化 JSON 字符串（用于显示）
function crFormatJson(v) {
  if (!v || v === 'null' || v === '[]') return v || '';
  try { return JSON.stringify(JSON.parse(v), null, 2); } catch(e) {}
  return String(v);
}

// 格式化 textarea 中的 JSON 输入
window.crFormatJsonInput = function(fieldName) {
  const ta = document.querySelector(`textarea[onchange="crSetChange('${fieldName}',this.value)"]`);
  if (!ta) return;
  try {
    const parsed = JSON.parse(ta.value);
    ta.value = JSON.stringify(parsed, null, 2);
    crChanges[fieldName] = ta.value;
  } catch(e) {
    // JSON 不合法，不格式化
  }
};

window.crTogglePerEnv = function(fieldName, toPerEnv) {
  if (toPerEnv) {
    crPerEnvMode.add(fieldName);
    // 初始化 per-env 值为各环境当前值
    crPerEnvVals[fieldName] = {};
    crSnapshots.forEach(s => { crPerEnvVals[fieldName][s.env] = (s.fields||{})[fieldName] || ''; });
  } else {
    crPerEnvMode.delete(fieldName);
    // 收回时：如果所有环境值相同，设为统一值；否则用第一个环境的值
    const pv = crPerEnvVals[fieldName] || {};
    const vals = Object.values(pv).map(String);
    if (new Set(vals).size === 1 && vals.length > 0) {
      crChanges[fieldName] = vals[0];
    } else if (vals.length > 0) {
      crChanges[fieldName] = vals[0];
    }
    delete crPerEnvVals[fieldName];
  }
  crRenderStep(document.getElementById('content-body'));
};

window.crSetPerEnv = function(fieldName, envCode, val) {
  if (!crPerEnvVals[fieldName]) crPerEnvVals[fieldName] = {};
  crPerEnvVals[fieldName][envCode] = val;
};

function crRenderExtraField(fieldName) {
  return `<div class="cr-extra-field">
    <div class="cr-extra-field-header"><span class="cr-extra-field-name">${escapeHtml(fieldName)}</span>
      <button class="cr-extra-field-remove" onclick="crRemoveField('${fieldName}')">✕</button></div>
    ${crRenderFieldRow(fieldName)}</div>`;
}

function crRenderFieldCheckboxes() {
  const used = new Set(['ArtifactVersion',...crExtraFields]);
  return [...CR_SCALAR_FIELDS,...CR_ARRAY_FIELDS].filter(f=>!used.has(f)).map(f=>`<label><input type="checkbox" value="${f}"> ${f}</label>`).join('');
}

window.crToggleFieldSelector = function(e) {
  e.stopPropagation();
  const el = document.getElementById('cr-field-selector');
  if (!el) return;
  el.style.display = el.style.display==='none'?'block':'none';
};

window.crAddSelectedFields = function() {
  document.querySelectorAll('#cr-field-selector input:checked').forEach(cb => {
    if (!crExtraFields.includes(cb.value)) { crExtraFields.push(cb.value); crChanges[cb.value]=crChanges[cb.value]||''; }
  });
  crRenderStep(document.getElementById('content-body'));
};

window.crRemoveField = function(f) {
  crExtraFields = crExtraFields.filter(x=>x!==f);
  delete crChanges[f];
  crRenderStep(document.getElementById('content-body'));
};

window.crSetChange = function(f, v) { crChanges[f] = v; };

window.crSelectBP = function(id) {
  crSelectedBP = id ? (crBlueprints.find(b=>b.id===id)||null) : null;
  crUpdateNextBtn();
};

function crUpdateNextBtn() {
  const btn = document.getElementById('cr-next1');
  if (btn) btn.disabled = !(crSelectedDU && crSelectedBP);
}

// ===== Step 4: Preview =====
window.crGoStep4Preview = function() { crStep = 4; crRenderStep(document.getElementById('content-body')); };

function crResolveForEnv(fieldName, envCode) {
  if (crPerEnvMode.has(fieldName)) {
    const pv = crPerEnvVals[fieldName]||{};
    return pv[envCode] ?? '';
  }
  return crChanges[fieldName];
}

// 替换 git blob URL 中的 tag 部分
// URL 格式: https://git.example.com/repo/blob/TAG/path/to/file
function replaceUrlTag(url, newTag) {
  const idx = url.indexOf('/blob/');
  if (idx < 0) return url;
  const after = url.substring(idx + 6); // skip '/blob/'
  const slashIdx = after.indexOf('/');
  if (slashIdx < 0) return url;
  return url.substring(0, idx + 6) + newTag + after.substring(slashIdx);
}

// 对 initDb 类数组字段，将所有 source URL 中的 tag 替换为新版本
// 返回更新后的 JSON 字符串，如果无变化返回 null
function autoUpdateInitDbUrls(currentVal, newVersion) {
  if (!currentVal || !newVersion) return null;
  let arr;
  try { arr = JSON.parse(typeof currentVal === 'string' ? currentVal : JSON.stringify(currentVal)); } catch(e) { return null; }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  let changed = false;
  const updated = arr.map(item => {
    if (!item || typeof item !== 'object') return item;
    const source = item.source;
    if (!source || typeof source !== 'string') return item;
    const idx = source.indexOf('/blob/');
    if (idx < 0) return item;
    const after = source.substring(idx + 6);
    const slashIdx = after.indexOf('/');
    if (slashIdx < 0) return item;
    const oldTag = after.substring(0, slashIdx);
    if (oldTag === newVersion) return item;
    changed = true;
    return {...item, source: replaceUrlTag(source, newVersion)};
  });
  return changed ? JSON.stringify(updated) : null;
}

// 计算某个环境的最终变更值（含 initDb tag 自动同步）
// 返回 { merged: 完整字段映射, autoUpdated: 自动更新的字段集合 }
function crResolveEnvChanges(envCode, snapshotFields) {
  const merged = {...(snapshotFields || {})};
  const autoUpdated = new Set();

  // 先应用手动变更
  const changeKeys = new Set();
  Object.keys(crChanges).forEach(k=>{ if(crChanges[k]!==''&&crChanges[k]!==undefined&&!crPerEnvMode.has(k)) changeKeys.add(k); });
  crPerEnvMode.forEach(k=>changeKeys.add(k));
  changeKeys.forEach(k => { merged[k] = crResolveForEnv(k, envCode); });

  // 如果 ArtifactVersion 有变更，自动同步 initDb 类字段的 URL tag
  const newAV = merged['ArtifactVersion'];
  const origAV = (snapshotFields||{})['ArtifactVersion'];
  if (newAV && String(newAV) !== String(origAV || '')) {
    CR_INIT_DB_FIELDS.forEach(field => {
      if (changeKeys.has(field)) return;
      const current = (snapshotFields||{})[field];
      const updated = autoUpdateInitDbUrls(current, String(newAV));
      if (updated !== null) {
        merged[field] = updated;
        autoUpdated.add(field);
      }
    });
  }
  return { merged, autoUpdated };
}

function crStep4Preview() {
  // 收集所有变更字段（统一 + 按环境）
  const changeKeys = new Set();
  Object.keys(crChanges).forEach(k=>{ if(crChanges[k]!==''&&crChanges[k]!==undefined&&!crPerEnvMode.has(k)) changeKeys.add(k); });
  crPerEnvMode.forEach(k=>changeKeys.add(k));

  // 收集自动同步的字段（跨所有环境）
  const allAutoUpdated = new Set();
  crSnapshots.forEach(s => {
    const { autoUpdated } = crResolveEnvChanges(s.env, s.fields);
    autoUpdated.forEach(f => allAutoUpdated.add(f));
  });

  const summary = [...changeKeys].map(k=>{
    if (crPerEnvMode.has(k)) return `<span style="display:inline-block;background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px;font-size:12px;margin:2px">${escapeHtml(k)}: (按环境)</span>`;
    return `<span style="display:inline-block;background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px;font-size:12px;margin:2px">${escapeHtml(k)}: ${escapeHtml(String(crChanges[k]).substring(0,40))}</span>`;
  }).join(' ');
  const autoSummary = [...allAutoUpdated].map(k=>
    `<span style="display:inline-block;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:12px;margin:2px">🔗 ${escapeHtml(k)}: 随版本自动同步</span>`
  ).join(' ');

  let envsHTML = '';
  if (crSnapshots.length>0) {
    envsHTML = crSnapshots.map(s=>{
      const { merged, autoUpdated } = crResolveEnvChanges(s.env, s.fields);
      const rows = Object.keys(merged).filter(k=>{
        if (CR_READONLY_FIELDS.has(k) || k.includes('[')) return false;
        const orig = (s.fields||{})[k], nv = merged[k];
        return String(orig??'') !== String(nv??'');
      }).map(k=>{
        const orig = (s.fields||{})[k], nv = merged[k];
        const isArrayField = CR_ARRAY_FIELDS.includes(k);
        const origDisp = crFormatPreviewValue(orig);
        const newDisp = crFormatPreviewValue(nv);
        const autoTag = autoUpdated.has(k) ? ' <span style="font-size:10px;color:#f59e0b" title="随ArtifactVersion自动同步">🔗 自动同步</span>' : '';
        return `<tr><td style="vertical-align:top">${escapeHtml(k)}${isArrayField?' <span style="font-size:10px;color:var(--text-muted)">[数组]</span>':''}${autoTag}</td><td>${origDisp}</td><td><span class="cr-change-badge">⚡</span> ${newDisp}</td></tr>`;
      }).join('');
      return `<div class="cr-preview-env">
        <div class="cr-preview-env-header">📍 ${escapeHtml(s.env_name||s.env)} <span style="font-weight:400;font-size:11px;color:var(--text-muted)">${escapeHtml(s.env)}</span></div>
        <div class="cr-preview-env-body"><table class="data-table"><thead><tr><th>配置项</th><th>当前值</th><th>变更后</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>`;
    }).join('');
  }
  return {
    content: `
      <div class="cr-section"><div class="cr-section-title">变更内容</div>
        <div style="margin-bottom:8px"><strong>标题:</strong> ${escapeHtml(crTitle)}</div>
        <div style="margin-bottom:8px"><strong>部署单元:</strong> ${escapeHtml(crSelectedDU?.code||'')}</div>
        <div style="margin-bottom:16px"><strong>蓝图:</strong> ${escapeHtml(crSelectedBP?.name||'')}</div>
        <div>${summary||'<span style="color:var(--text-muted)">无变更</span>'}${autoSummary?'<div style="margin-top:8px">'+autoSummary+'</div>':''}</div>
      </div>
      <div class="cr-section"><div class="cr-section-title">各环境变更预览</div>${envsHTML||'<div class="empty-state"><p>无环境数据</p></div>'}</div>`,
    actions: `
      <button class="btn btn-secondary" onclick="crGoBack(3)">← 上一步</button>
      <button class="btn btn-success" onclick="crSubmitRelease()">确认创建发布</button>`
  };
}

window.crSubmitRelease = async function() {
  // 收集所有有变更的字段（统一模式 + 按环境模式）
  const changes = {};

  // 统一模式的字段
  Object.keys(crChanges).forEach(k=>{
    if (crPerEnvMode.has(k)) return; // 跳过按环境模式的字段
    const v = crChanges[k];
    if (v===''||v===undefined) return;
    if (CR_ARRAY_FIELDS.includes(k)) { try { changes[k]=JSON.parse(v); } catch(e) { changes[k]=v; } }
    else if (['NodeCount','MetricPort','MaxPollRecords','BatchSize'].includes(k)) { changes[k]=parseInt(v)||v; }
    else { changes[k]=v; }
  });

  // 按环境模式的字段：只发送与当前值不同的部分
  crPerEnvMode.forEach(k=>{
    const pv = crPerEnvVals[k]||{};
    const envChanged = {};
    crSnapshots.forEach(s=>{
      const orig = String((s.fields||{})[k]??'');
      const nv = String(pv[s.env]??'');
      if (nv!==orig) envChanged[s.env] = CR_ARRAY_FIELDS.includes(k) ? (()=>{try{return JSON.parse(nv)}catch(e){return nv}})() :
        (['NodeCount','MetricPort','MaxPollRecords','BatchSize'].includes(k) ? parseInt(nv)||nv : nv);
    });
    const changedVals = Object.values(envChanged).map(String);
    if (changedVals.length===0) return; // 无变更
    if (new Set(changedVals).size===1) {
      changes[k] = Object.values(envChanged)[0]; // 所有变更值相同，用标量
    } else {
      changes[k] = {_default: Object.values(envChanged)[0]};
      Object.entries(envChanged).forEach(([env,v])=>{
        if (String(v)!==String(Object.values(envChanged)[0])) changes[k][env]=v;
      });
    }
  });

  if (Object.keys(changes).length===0) { toast('请至少填写一个变更字段','error'); return; }
  // 检查 ArtifactVersion 是否有值
  const av = changes.ArtifactVersion;
  if (!av || (typeof av==='object' && Object.keys(av).length===0)) { toast('ArtifactVersion为必填项','error'); return; }

  // initDb tag 自动同步：如果 ArtifactVersion 有变更且用户未手动修改 initDb 类字段，
  // 自动将各环境 initDb/initDbAuth/initDbFinal 中的 URL tag 替换为新版本
  const avStr = typeof av === 'object' ? (av._default || Object.values(av)[0]) : av;
  if (avStr) {
    CR_INIT_DB_FIELDS.forEach(field => {
      if (changes[field] !== undefined) return; // 用户已手动修改，跳过
      // 计算每个环境的自动更新值
      const envUpdated = {};
      crSnapshots.forEach(s => {
        const current = (s.fields||{})[field];
        const updated = autoUpdateInitDbUrls(current, String(avStr));
        if (updated !== null) {
          try { envUpdated[s.env] = JSON.parse(updated); } catch(e) { envUpdated[s.env] = updated; }
        }
      });
      if (Object.keys(envUpdated).length === 0) return;
      // 判断所有环境是否更新结果相同
      const vals = Object.values(envUpdated).map(JSON.stringify);
      if (new Set(vals).size === 1) {
        changes[field] = Object.values(envUpdated)[0];
      } else {
        changes[field] = {_default: Object.values(envUpdated)[0]};
        Object.entries(envUpdated).forEach(([env, v]) => {
          if (JSON.stringify(v) !== JSON.stringify(Object.values(envUpdated)[0])) changes[field][env] = v;
        });
      }
    });
  }

  try {
    await api('/releases', { method:'POST', body:JSON.stringify({ title:crTitle, deploy_unit_code:crSelectedDU.code, blueprint_id:crSelectedBP.id, changes }) });
    toast('发布单创建成功','success');
    crStep=1; crChanges={}; crExtraFields=[]; crPerEnvMode=new Set(); crPerEnvVals={};
    loadPage('releases');
  } catch(e) { toast(e.message,'error'); }
};

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
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.overflow = 'hidden';
  if (actions) actions.innerHTML = '';
  const steps = ['选择DU与蓝图','设置版本','预览'];
  const circles = steps.map((s,i)=>{
    const n = i+1;
    const cls = n===brStep?'active':(n<brStep?'done':'');
    const circle = `<div class="cr-wizard-step ${cls}"><div class="cr-wizard-num">${n<brStep?'✓':n}</div></div>`;
    const line = i<steps.length-1?`<div class="cr-wizard-line ${n<brStep?'done':''}"></div>`:'';
    return circle + line;
  }).join('');
  const labels = steps.map((s,i)=>{
    const n = i+1;
    const cls = n===brStep?'active':(n<brStep?'done':'');
    const col = `<div class="cr-wizard-step ${cls}"><div class="cr-wizard-label-col"><div class="cr-wizard-label">${s}</div></div></div>`;
    const space = i<steps.length-1?`<div class="cr-wizard-label-space"></div>`:'';
    return col + space;
  }).join('');
  const wizard = `<div class="cr-wizard"><div class="cr-wizard-circles">${circles}</div><div class="cr-wizard-labels">${labels}</div></div>`;
  let step;
  switch(brStep) {
    case 1: step = brStep1(); break;
    case 2: step = await brStep2(); break;
    case 3: step = await brStep3(); break;
  }
  body.innerHTML = `<div style="display:flex;flex-direction:column;flex:1;min-height:0">${wizard}<div class="card" style="flex:1;min-height:0;display:flex;flex-direction:column"><div class="card-body" style="flex:1;min-height:0;overflow-y:auto">${step.content}</div></div><div class="cr-actions" style="flex-shrink:0">${step.actions}</div></div>`;
}

// Step 1: Select DUs + Blueprint
function brStep1() {
  if (brDUList.length === 0) {
    api('/du-list').then(d => { brDUList = d.deploy_units||[]; if(brStep===1) renderBatchRelease(document.getElementById('content-body'), document.getElementById('header-actions')); });
  }
  if (brBlueprints.length === 0) {
    api('/blueprints').then(d => { brBlueprints = d.blueprints||[]; if(brStep===1) renderBatchRelease(document.getElementById('content-body'), document.getElementById('header-actions')); });
  }

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
      <button class="btn btn-primary" id="br-next1" onclick="brGoStep2()" ${brSelectedDUs.length>0&&brSelectedBP?'':'disabled'}>下一步: 设置版本 →</button>`
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
  renderBatchRelease(document.getElementById('content-body'), document.getElementById('header-actions'));
};

window.brRemoveDU = function(code) {
  brSelectedDUs = brSelectedDUs.filter(d=>d.code!==code);
  renderBatchRelease(document.getElementById('content-body'), document.getElementById('header-actions'));
};

window.brSelectBP = function(id) {
  brSelectedBP = id ? (brBlueprints.find(b=>b.id===id)||null) : null;
  document.getElementById('br-next1').disabled = !(brSelectedDUs.length>0 && brSelectedBP);
};

window.brGoStep2 = async function() {
  if (!brSelectedDUs.length || !brSelectedBP) return;
  brTitle = document.getElementById('br-title')?.value || brTitle || ('批量升级 ' + brSelectedDUs.map(d=>d.code).join(', '));
  brStep = 2;
  // 获取蓝图环境列表
  try {
    const bpDetail = await api('/blueprints/'+brSelectedBP.id);
    brBlueprintEnvs = new Set((bpDetail.nodes||[]).map(n=>n.env_code));
  } catch(e) { brBlueprintEnvs = new Set(); }
  // 预加载各DU的快照，只保留蓝图环境
  brSnapshots = {};
  await Promise.all(brSelectedDUs.map(async d => {
    try {
      const data = await api('/deploy-units/'+encodeURIComponent(d.code)+'/compare');
      const all = data.snapshots||[];
      brSnapshots[d.code] = all.filter(s => brBlueprintEnvs.has(s.env));
    } catch(e) { brSnapshots[d.code] = []; }
  }));
  renderBatchRelease(document.getElementById('content-body'), document.getElementById('header-actions'));
};

// Step 2: Set version
async function brStep2() {
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
          <input class="form-control" id="br-version" value="${escapeHtml(brNewVersion)}" placeholder="例: v2.3.0" oninput="brNewVersion=this.value;brUpdateNextBtn()" style="max-width:400px">
          <div style="margin-top:8px;padding:8px 12px;background:#fef3c7;border-radius:6px;font-size:12px;color:#92400e">
            🔗 initDb / initDbAuth / initDbFinal / ImportData 中的代码仓库 URL tag 将随版本自动同步
          </div>
        </div>
      </div>
      <div class="cr-section"><div class="cr-section-title">各DU当前版本</div>${duInfoHTML}</div>`,
    actions: `
      <button class="btn btn-secondary" onclick="brStep=1;renderBatchRelease(document.getElementById('content-body'),document.getElementById('header-actions'))">← 上一步</button>
      <button class="btn btn-primary" id="br-next2" onclick="brGoStep3()" ${brNewVersion?'':'disabled'}>下一步: 预览 →</button>`
  };
}

window.brUpdateNextBtn = function() {
  const btn = document.getElementById('br-next2');
  if (btn) btn.disabled = !brNewVersion;
};

window.brGoStep3 = function() {
  brNewVersion = document.getElementById('br-version')?.value || brNewVersion;
  if (!brNewVersion) { toast('请填写新版本号','error'); return; }
  brStep = 3;
  renderBatchRelease(document.getElementById('content-body'), document.getElementById('header-actions'));
};

// Step 3: Preview
async function brStep3() {
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
      <button class="btn btn-secondary" onclick="brStep=2;renderBatchRelease(document.getElementById('content-body'),document.getElementById('header-actions'))">← 上一步</button>
      <button class="btn btn-success" onclick="brSubmitBatch()">确认批量发布</button>`
  };
}

window.brSubmitBatch = async function() {
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
  } catch(e) { toast(e.message, 'error'); }
};

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
  selected.forEach(s => Object.keys(s.fields||{}).forEach(k => { if (!skipKeys.has(k) && !k.includes('[')) allKeys.add(k); }));

  // 只保留有差异的字段
  const diffKeys = [...allKeys].filter(key => {
    const vals = selected.map(s=>String((s.fields||{})[key]||''));
    return new Set(vals).size > 1;
  }).sort();

  if (diffKeys.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><p>所选环境配置完全一致，无差异</p></div>';
    return;
  }

  wrap.innerHTML = `<div style="margin-bottom:8px;font-size:12px;color:var(--text-muted)">${selected.length} 个环境 / ${diffKeys.length} 个差异项</div>
    <table class="data-table du-compare-table" style="min-width:600px;table-layout:auto">
      <thead><tr><th style="min-width:120px">配置项</th>${selected.map(e=>`<th>${escapeHtml(e.env_name||e.env)}<br><span style="font-weight:400;font-size:10px;color:var(--text-muted)">${escapeHtml(e.env)}</span></th>`).join('')}</tr></thead>
      <tbody>${diffKeys.map(key=>{
        const rawVals = selected.map(s=>String((s.fields||{})[key]||''));
        const colors = crAssignValueColors(rawVals);
        return `<tr>
          <td><strong class="diff-field-link" data-field="${escapeHtml(key)}" title="点击查看详细差异">${escapeHtml(key)}</strong></td>
          ${selected.map((s,i)=>`<td style="font-size:12px;word-break:break-all;max-width:450px;white-space:pre-wrap;background:${colors[i]}">${summarizeValue((s.fields||{})[key])}</td>`).join('')}
        </tr>`;
      }).join('')}</tbody>
    </table>`;

  // 绑定字段名点击事件 → 打开 diff 模态框
  wrap.querySelectorAll('.diff-field-link').forEach(el => {
    el.addEventListener('click', () => {
      const field = el.dataset.field;
      if (field) showDiffModal(field, duSnapshots);
    });
  });
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
        <td><a href="#" class="text-link" onclick="loadPage('release-detail',${s.release_id});return false">#${s.release_id}</a></td>
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
      <div class="card"><div class="card-header"><div class="card-title">用户管理</div></div>
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
    </div>`;
  } catch(e) { body.innerHTML = '<div class="empty-state"><p>加载失败: '+escapeHtml(e.message)+'</p></div>'; }
}

window.editUserAccess = async function(userId, username, curSilos, curEnvs) {
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
};

window.saveUserAccess = async function(userId, btn) {
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
};

window.editUserRoles = async function(userId, username, currentRoleIds) {
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
};

window.saveUserRoles = async function(userId, btn) {
  const modal = btn.closest('.diff-modal');
  const roleIds = [];
  modal.querySelectorAll('input[type=checkbox]:checked').forEach(cb => roleIds.push(parseInt(cb.value)));
  try {
    await api('/admin/users/'+userId+'/roles', { method:'PUT', body:JSON.stringify({role_ids:roleIds}) });
    toast('角色已更新','success');
    modal.closest('.diff-modal-overlay').remove();
    loadPage('admin');
  } catch(e) { toast(e.message,'error'); }
};

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
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtTime(t) {
  if (!t) return '-';
  try { return new Date(t).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }
  catch(e) { return String(t); }
}

// ===== Diff Modal =====
function formatForDiff(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  if (s.startsWith('{') || s.startsWith('[')) {
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch(e) {}
  }
  return s;
}

function computeLineDiff(aLines, bLines) {
  const aLen = aLines.length, bLen = bLines.length;
  const dp = Array.from({length: aLen+1}, ()=>new Array(bLen+1).fill(0));
  for (let i=1; i<=aLen; i++) {
    for (let j=1; j<=bLen; j++) {
      dp[i][j] = aLines[i-1]===bLines[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
    }
  }
  const result = [];
  let i=aLen, j=bLen;
  while (i>0 || j>0) {
    if (i>0 && j>0 && aLines[i-1]===bLines[j-1]) {
      result.unshift({type:'ctx', aNum:i, bNum:j, text:aLines[i-1]});
      i--; j--;
    } else if (j>0 && (i===0 || dp[i][j-1]>=dp[i-1][j])) {
      result.unshift({type:'add', bNum:j, text:bLines[j-1]});
      j--;
    } else {
      result.unshift({type:'del', aNum:i, text:aLines[i-1]});
      i--;
    }
  }
  return result;
}

// 蓝图详情模态框
window.showBlueprintModal = async function(blueprintId, releaseId) {
  if (!blueprintId) return;
  const old = document.getElementById('bp-modal-root');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'bp-modal-root';
  overlay.className = 'diff-modal-overlay';
  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });

  const modal = document.createElement('div');
  modal.className = 'diff-modal';
  modal.innerHTML = `
    <div class="diff-modal-header">
      <h3>蓝图详情</h3>
      <button class="diff-modal-close" onclick="document.getElementById('bp-modal-root').remove()">✕</button>
    </div>
    <div class="diff-modal-body" id="bp-modal-body" style="padding:16px"><div style="text-align:center;color:var(--text-muted)">加载中…</div></div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  try {
    const bp = await api('/blueprints/' + blueprintId);
    const nodes = bp.nodes || [];
    const edges = bp.edges || [];
    const bodyEl = modal.querySelector('#bp-modal-body');

    // 构建前置环境映射：nodeId → [parentEnvCode]
    const parentMap = new Map(); // nodeId → [parent node ids]
    nodes.forEach(n => parentMap.set(n.id, []));
    edges.forEach(e => parentMap.get(e.to_node_id)?.push(e.from_node_id));
    const nodeById = new Map(nodes.map(n => [n.id, n]));

    // 构建环境阶段状态映射：envCode → stage
    const stages = releaseId ? (releaseStagesMap[releaseId] || []) : [];
    const stageByEnv = new Map();
    stages.forEach(s => stageByEnv.set(s.env_code, s));

    const statusLabel = (status) => {
      const map = { pending:'待处理', in_progress:'进行中', approved:'已通过', pushing:'推送中', completed:'已完成', rejected:'已驳回' };
      return map[status] || status || '-';
    };
    const statusColor = (status) => {
      const map = { pending:'#9ca3af', in_progress:'#3b82f6', approved:'#8b5cf6', pushing:'#f59e0b', completed:'#10b981', rejected:'#ef4444' };
      return map[status] || '#9ca3af';
    };

    const rowsHTML = nodes.map(n => {
      const parentNodes = (parentMap.get(n.id) || []).map(pid => nodeById.get(pid)).filter(Boolean);
      const parentStr = parentNodes.length > 0
        ? parentNodes.map(p => escapeHtml(p.env_name || p.env_code)).join('、')
        : '<span style="color:var(--text-muted)">-</span>';
      const stage = stageByEnv.get(n.env_code);
      const st = stage?.status || 'pending';
      return `<tr>
        <td style="font-weight:500">${escapeHtml(n.env_name||n.env_code)}</td>
        <td>${parentStr}</td>
        <td><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;color:#fff;background:${statusColor(st)}">${statusLabel(st)}</span></td>
      </tr>`;
    }).join('');

    bodyEl.innerHTML = `
      <div style="margin-bottom:12px"><strong>名称：</strong>${escapeHtml(bp.name)}</div>
      ${bp.description ? `<div style="margin-bottom:12px;color:var(--text-muted)">${escapeHtml(bp.description)}</div>` : ''}
      <table class="data-table">
        <thead><tr><th>环境</th><th>前置环境</th><th>状态</th></tr></thead>
        <tbody>${rowsHTML || '<tr><td colspan="3" style="color:var(--text-muted)">无环境节点</td></tr>'}</tbody>
      </table>`;
  } catch(e) {
    const bodyEl = modal.querySelector('#bp-modal-body');
    bodyEl.innerHTML = `<div style="color:#ef4444">加载失败: ${escapeHtml(e.message)}</div>`;
  }
};

function showDiffModal(fieldName, snapshots) {
  const old = document.getElementById('diff-modal-root');
  if (old) old.remove();

  const formatted = snapshots.map(s => formatForDiff((s.fields||{})[fieldName]));
  const envLabels = snapshots.map(s => s.env_name || s.env);
  const envCodes = snapshots.map(s => s.env);
  const envOpts = snapshots.map((s, i) => ({idx:i, label:`${s.env_name||s.env} (${s.env})`}));

  const overlay = document.createElement('div');
  overlay.id = 'diff-modal-root';
  overlay.className = 'diff-modal-overlay';
  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });

  const modal = document.createElement('div');
  modal.className = 'diff-modal';
  modal.innerHTML = `
    <div class="diff-modal-header">
      <h3>${escapeHtml(fieldName)} — 详细差异</h3>
      <button class="diff-modal-close" onclick="document.getElementById('diff-modal-root').remove()">✕</button>
    </div>
    <div class="diff-modal-body" id="diff-body"></div>`;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const bodyEl = modal.querySelector('#diff-body');

  function envOptions(selectedIdx) {
    return envOpts.map(o => `<option value="${o.idx}" ${o.idx===selectedIdx?'selected':''}>${escapeHtml(o.label)}</option>`).join('');
  }

  // 根据左侧环境，生成右侧下拉框选项（带差异描述）
  function rightEnvOptions(leftIdx, selectedIdx) {
    return envOpts.map(o => {
      if (o.idx === leftIdx) {
        return `<option value="${o.idx}" disabled>${escapeHtml(o.label)} (当前)</option>`;
      }
      const same = formatted[o.idx] === formatted[leftIdx];
      const tag = same ? '无差异' : '有差异';
      return `<option value="${o.idx}" ${o.idx===selectedIdx?'selected':''}>${escapeHtml(o.label)} — ${tag}</option>`;
    }).join('');
  }

  function renderDiff(leftIdx, rightIdx) {
    const aLines = formatted[leftIdx].split('\n');
    const bLines = formatted[rightIdx].split('\n');
    const diff = computeLineDiff(aLines, bLines);
    const addCount = diff.filter(l=>l.type==='add').length;
    const delCount = diff.filter(l=>l.type==='del').length;

    const renderSide = (side) => diff.filter(l => l.type==='ctx' || l.type===side).map(l => {
      const cls = l.type==='add'?'add':l.type==='del'?'del':'ctx';
      const num = side==='del' ? (l.aNum||'') : (l.bNum||'');
      return `<div class="diff-line ${cls}"><div class="diff-line-num">${num}</div><div class="diff-line-content">${escapeHtml(l.text)}</div></div>`;
    }).join('');

    bodyEl.querySelector('#diff-content').innerHTML = `
      <div style="padding:8px 16px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border)">
        <span style="color:#16a34a;font-weight:600">+${addCount}</span>
        <span style="margin:0 8px;color:#ef4444;font-weight:600">-${delCount}</span>
        <span>行差异</span>
      </div>
      <div class="diff-container">
        <div class="diff-pane"><div class="diff-pane-header">${escapeHtml(envLabels[leftIdx])} <span style="font-weight:400;color:var(--text-muted)">(${escapeHtml(envCodes[leftIdx])})</span></div>${renderSide('del')}</div>
        <div class="diff-pane"><div class="diff-pane-header">${escapeHtml(envLabels[rightIdx])} <span style="font-weight:400;color:var(--text-muted)">(${escapeHtml(envCodes[rightIdx])})</span></div>${renderSide('add')}</div>
      </div>`;
  }

  // Build toolbar + content area
  const defaultLeft = 0;
  const defaultRight = snapshots.length > 1 ? 1 : 0;
  bodyEl.innerHTML = `
    <div class="diff-toolbar">
      <select class="form-control" id="diff-env-left" style="width:auto;min-width:160px;font-size:13px">${envOptions(defaultLeft)}</select>
      <span style="color:var(--text-muted);font-size:13px;font-weight:600">vs</span>
      <select class="form-control" id="diff-env-right" style="width:auto;min-width:160px;font-size:13px">${rightEnvOptions(defaultLeft, defaultRight)}</select>
    </div>
    <div id="diff-content"></div>`;

  const leftSel = bodyEl.querySelector('#diff-env-left');
  const rightSel = bodyEl.querySelector('#diff-env-right');

  function onSelChange() {
    const li = parseInt(leftSel.value);
    const ri = parseInt(rightSel.value);
    // 重建右侧下拉框，带上差异描述
    rightSel.innerHTML = rightEnvOptions(li, ri);
    if (li === parseInt(rightSel.value)) {
      // 当前选中项被禁用了，自动选第一个非禁用项
      for (const opt of rightSel.options) {
        if (!opt.disabled) { rightSel.value = opt.value; break; }
      }
    }
    const finalRi = parseInt(rightSel.value);
    if (li === finalRi) {
      bodyEl.querySelector('#diff-content').innerHTML = '<div class="diff-empty">请选择两个不同的环境进行比对</div>';
      return;
    }
    renderDiff(li, finalRi);
  }

  leftSel.addEventListener('change', onSelChange);
  rightSel.addEventListener('change', onSelChange);

  const escHandler = e => { if (e.key==='Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  onSelChange();
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  loadPage('releases');

  // 全局事件委托：点击 .diff-field-link 打开 diff 模态框
  document.addEventListener('click', e => {
    const el = e.target.closest('.diff-field-link');
    if (!el) return;
    const field = el.dataset.field;
    // 优先使用 duSnapshots（部署单元页面），其次 crSnapshots（创建发布向导）
    const snaps = (typeof duSnapshots !== 'undefined' && duSnapshots.length > 0) ? duSnapshots :
                  (typeof crSnapshots !== 'undefined' && crSnapshots.length > 0) ? crSnapshots : null;
    if (field && snaps) showDiffModal(field, snaps);
  });
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
    dagState.nextId = Math.max(100, ...dagState.nodes.map(n=>n.id)) + 1;
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
