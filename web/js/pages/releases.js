import { api, currentUser } from '../api.js';
import {
  toast, showLoading, statusHTML, escapeHtml, fmtTime,
  crFormatJson, CR_INIT_DB_FIELDS, autoUpdateInitDbUrls,
} from '../utils.js';

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
    // 缓存每条发布的stages供蓝图模态框使用
    releaseStagesMap = {};
    releases.forEach(r => { releaseStagesMap[r.id] = r.stages || []; });
    body.innerHTML = `
      <div id="release-batch-bar" style="display:none;position:sticky;top:0;z-index:10;background:var(--bg,#fff);border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:8px 12px;margin-bottom:8px;align-items:center;gap:12px">
        <span id="release-batch-count" style="font-size:13px;color:var(--text-muted)">已选 0 项</span>
        <button class="btn btn-sm btn-warning" onclick="batchDeprecateReleases()">批量废弃</button>
        <button class="btn btn-sm btn-danger" onclick="batchDeleteReleases()">批量删除</button>
      </div>
      <div class="card"><table class="data-table"><thead><tr>
        <th style="width:36px"><input type="checkbox" id="release-check-all" onchange="toggleAllReleases(this)"></th>
        <th>标题</th><th>部署单元</th><th>版本</th><th>蓝图</th><th>状态</th><th>创建者</th><th>时间</th><th>操作</th>
      </tr></thead><tbody>${releases.map(r=>{
      const bpName = r.blueprint?.name||'';
      const bpId = r.blueprint_id||0;
      const bpCell = bpName ? `<a href="#" class="text-link" onclick="showBlueprintModal(${bpId},${r.id});return false" title="查看蓝图详情">${escapeHtml(bpName)}</a>` : '-';
      return `<tr>
      <td><input type="checkbox" class="release-check" value="${r.id}" data-status="${r.status}" onchange="updateReleaseBatchBar()"></td>
      <td><a href="#" class="text-link" onclick="loadPage('release-detail',${r.id});return false">${escapeHtml(r.title)}</a></td>
      <td>${escapeHtml(r.deploy_unit_code||'')}</td>
      <td><code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-size:12px">${escapeHtml(r.version||'')}</code></td>
      <td>${bpCell}</td>
      <td>${statusHTML(r.status)}</td>
      <td>${escapeHtml(r.created_by?.username||'')}</td>
      <td>${fmtTime(r.created_at)}</td>
      <td class="action-group">${r.status==='draft'?'<button class="btn btn-sm btn-primary" onclick="startRelease('+r.id+')">开始发布</button>':''}${r.status==='in_progress'||r.status==='completed'?'<button class="btn btn-sm btn-secondary" onclick="loadPage(\'release-detail\','+r.id+')">查看</button>':''}${r.status!=='deprecated'&&r.status!=='completed'?'<button class="btn btn-sm btn-warning" onclick="deprecateRelease('+r.id+')">废弃</button>':''}${r.status==='deprecated'?'<button class="btn btn-sm btn-secondary" onclick="loadPage(\'release-detail\','+r.id+')">查看</button>':''}${r.status==='deprecated'&&currentUser?.roles?.some(r=>r.name==='admin')?'<button class="btn btn-sm btn-danger" onclick="deleteRelease('+r.id+')">删除</button>':''}</td>
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

async function deprecateRelease(id) {
  if (!confirm('确认废弃此发布？废弃后将无法再审批，且一周内可删除。')) return;
  try {
    await api('/releases/'+id+'/deprecate', { method:'POST' });
    toast('已废弃','success');
    loadPage('releases');
  } catch(e) { toast(e.message,'error'); }
}

async function deleteRelease(id) {
  if (!confirm('确认删除此发布？此操作不可恢复！')) return;
  try {
    await api('/releases/'+id, { method:'DELETE' });
    toast('已删除','success');
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
        curY += (n._w || 100) + nodeGapY;
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

    // 给边添加箭头
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
          ${r.deprecated_at?`<div class="release-meta-item"><span>废弃时间</span><span>${fmtTime(r.deprecated_at)}</span></div>`:''}
        </div>
      </div>
      <div>${r.status==='draft'?'<button class="btn btn-primary" onclick="startRelease('+r.id+')">开始发布</button>':''}${r.status!=='deprecated'&&r.status!=='completed'?'<button class="btn btn-warning" onclick="deprecateRelease('+r.id+')">废弃</button>':''}${r.status==='deprecated'&&currentUser?.roles?.some(rl=>rl.name==='admin')?(() => { const days = r.deprecated_at ? Math.max(0, 7 - Math.floor((Date.now() - new Date(r.deprecated_at).getTime()) / 86400000)) : 0; return days > 0 ? '<button class="btn btn-danger" onclick="deleteRelease('+r.id+')">删除（剩余'+days+'天）</button>' : '<button class="btn btn-sm" disabled>删除窗口已过期</button>'; })() : ''}</div>
    </div>
    ${r.status==='deprecated'?`<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px 16px;margin-bottom:24px;color:#92400e;font-size:13px">⚠️ 此发布已废弃，所有审批和推进操作已停止。${r.deprecated_at?`废弃时间：${fmtTime(r.deprecated_at)}`:''}</div>`:''}
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
        if (envChanges[field] !== undefined) return;
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

// 蓝图详情模态框
async function showBlueprintModal(blueprintId, releaseId) {
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

    const parentMap = new Map();
    nodes.forEach(n => parentMap.set(n.id, []));
    edges.forEach(e => parentMap.get(e.to_node_id)?.push(e.from_node_id));
    const nodeById = new Map(nodes.map(n => [n.id, n]));

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
}

// ===== Batch operations =====
function getCheckedReleases() {
  return [...document.querySelectorAll('.release-check:checked')].map(c => ({
    id: parseInt(c.value),
    status: c.dataset.status
  }));
}

function updateReleaseBatchBar() {
  const checked = getCheckedReleases();
  const bar = document.getElementById('release-batch-bar');
  const countEl = document.getElementById('release-batch-count');
  if (!bar) return;
  if (checked.length > 0) {
    bar.style.display = 'flex';
    countEl.textContent = `已选 ${checked.length} 项`;
  } else {
    bar.style.display = 'none';
  }
}

function toggleAllReleases(el) {
  document.querySelectorAll('.release-check').forEach(c => { c.checked = el.checked; });
  updateReleaseBatchBar();
}

async function batchDeprecateReleases() {
  const checked = getCheckedReleases();
  const targets = checked.filter(c => c.status !== 'deprecated' && c.status !== 'completed');
  if (targets.length === 0) { toast('没有可废弃的发布','error'); return; }
  if (!confirm(`确认废弃 ${targets.length} 个发布？`)) return;
  let ok = 0, fail = 0;
  for (const t of targets) {
    try { await api('/releases/'+t.id+'/deprecate', {method:'POST'}); ok++; }
    catch(e) { fail++; }
  }
  toast(ok > 0 ? `已废弃 ${ok} 个${fail > 0 ? `，失败 ${fail} 个` : ''}` : '废弃失败', ok > 0 ? 'success' : 'error');
  loadPage('releases');
}

async function batchDeleteReleases() {
  const checked = getCheckedReleases();
  const targets = checked.filter(c => c.status === 'deprecated');
  if (targets.length === 0) { toast('仅支持删除已废弃的发布','error'); return; }
  if (!confirm(`确认删除 ${targets.length} 个已废弃的发布？此操作不可恢复！`)) return;
  let ok = 0, fail = 0;
  for (const t of targets) {
    try { await api('/releases/'+t.id, {method:'DELETE'}); ok++; }
    catch(e) { fail++; }
  }
  toast(ok > 0 ? `已删除 ${ok} 个${fail > 0 ? `，失败 ${fail} 个` : ''}` : '删除失败', ok > 0 ? 'success' : 'error');
  loadPage('releases');
}

// Expose for inline onclick
window.renderReleaseList = renderReleaseList;
window.startRelease = startRelease;
window.deprecateRelease = deprecateRelease;
window.deleteRelease = deleteRelease;
window.approveStage = approveStage;
window.rejectStage = rejectStage;
window.promoteStage = promoteStage;
window.retryPush = retryPush;
window.showBlueprintModal = showBlueprintModal;
window.toggleAllReleases = toggleAllReleases;
window.updateReleaseBatchBar = updateReleaseBatchBar;
window.batchDeprecateReleases = batchDeprecateReleases;
window.batchDeleteReleases = batchDeleteReleases;

export { renderReleaseList, renderReleaseDetail };
