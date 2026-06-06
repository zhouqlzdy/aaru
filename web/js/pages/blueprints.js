import { api } from '../api.js';
import { toast, showLoading, escapeHtml, setPage } from '../utils.js';

// ===== Blueprint Management =====
let dagState = { nodes: [], edges: [], nextId: 100, selectedNode: null, selectedEdge: null };
let originalNodeIDs = new Set();  // 编辑时记录原始节点 ID 集合
let originalEdgeKeys = new Set(); // 编辑时记录原始边 key 集合

async function loadPageBlueprintList(body) {
  if (!body) body = document.getElementById('content-body');
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
    body.innerHTML = bps.map(b=>`<div class="blueprint-list-item" onclick="loadPageBlueprintEditor(${b.id})" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;cursor:pointer">
      <div><strong>${escapeHtml(b.name)}</strong><br><span style="font-size:12px;color:var(--text-muted)">${escapeHtml(b.description||'')}</span></div>
      <div style="font-size:12px;color:var(--text-muted);text-align:right">${b.node_count} 节点 · ${b.edge_count} 边 <button class="btn btn-danger btn-xs" onclick="event.stopPropagation();deleteBlueprint(${b.id})" style="margin-left:12px">删除</button></div>
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
  try { const d = await api('/environments'); envCache = d.envs||[]; } catch(e) {}

  // Load roles for gate config
  try { const d = await api('/admin/roles'); roleCache = d.roles||[]; } catch(e) {}

  setPage('blueprints', bpId ? '编辑蓝图: '+escapeHtml(bp?.name||'') : '新建蓝图', '基于DAG的环境晋级策略编辑器');
  actions.innerHTML = `
    <button class="btn btn-primary" onclick="saveBlueprint(${bpId||0})">保存蓝图</button>
    <button class="btn btn-secondary" onclick="loadPage('blueprints')">返回列表</button>`;

  // Init DAG state
  if (bp) {
    dagState.nodes = (bp.nodes||[]).map(n=> ({...n, id:n.id, env_code:n.env_code, env_name:n.env_name||n.env_code, pos_x:n.pos_x, pos_y:n.pos_y, gate_type:n.gate_type||'manual', webhook_token:n.webhook_token||''}));
    dagState.edges = (bp.edges||[]).map(e=>({...e, id:e.id, from_node_id:e.from_node_id, to_node_id:e.to_node_id}));
    dagState.nextId = Math.max(100, ...dagState.nodes.map(n=>n.id)) + 1;
    // 记录原始结构，用于保存时检测变化
    originalNodeIDs = new Set(dagState.nodes.map(n=>n.id));
    originalEdgeKeys = new Set(dagState.edges.map(e=>`${e.from_node_id}->${e.to_node_id}`));
  } else {
    dagState = { nodes: [], edges: [], nextId: 100, selectedNode: null, selectedEdge: null };
    originalNodeIDs = new Set();
    originalEdgeKeys = new Set();
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
    ${n.gate_type==='manual'?`<div class="form-group"><span style="font-size:12px;color:var(--text-muted)">需要用户拥有 approve 权限，且 allowed_silos 包含该发布单所属 silo，allowed_envs 包含此环境。</span></div>`:''}${n.gate_type==='auto'?`<div class="form-group"><span style="font-size:12px;color:#059669">该阶段父环境审批通过后自动晋级，无需人工干预。</span></div>`:''}
    ${n.gate_type==='api_hook'?`<div class="form-group"><label class="form-label">Webhook URL（外部系统调用此地址晋级）</label><code style="display:block;padding:8px;background:#f5f5f4;border-radius:4px;font-size:11px;word-break:break-all;margin-bottom:8px">${webhookUrl}</code><span style="font-size:11px;color:var(--text-muted)">发布启动后，将 __STAGE_ID__ 替换为实际的stage id。外部系统调用此URL即可自动将该阶段从pending推进到in_progress。</span></div>`:''}
    <button class="btn btn-danger btn-sm" onclick="deleteDagNode(${n.id})" style="margin-top:8px">删除此节点</button>`;
}

// Env/role cache for dropdowns
export let envCache = [], roleCache = [];

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
  const n = { id: dagState.nextId++, env_code: '', env_name: '新节点', pos_x: dagState.nodes.length*110+30, pos_y: dagState.nodes.length*45+50, gate_type: 'manual', webhook_token: '' };
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
  try {
    const ar = await api('/blueprints/'+id+'/active-releases');
    const activeReleases = ar.releases || [];
    if (activeReleases.length > 0) {
      const list = activeReleases.map(r => `#${r.id} ${escapeHtml(r.title)} (${escapeHtml(r.status)})`).join('\n');
      if (!confirm(`⚠️ 该蓝图有 ${activeReleases.length} 个在途发布，删除蓝图不会废弃这些发布：\n\n${list}\n\n是否继续删除？`)) return;
    } else {
      if (!confirm('确认删除此蓝图？')) return;
    }
  } catch(e) {
    if (!confirm('确认删除此蓝图？')) return;
  }
  try { await api('/blueprints/'+id, {method:'DELETE'}); toast('已删除'); loadPageBlueprintList(); }
  catch(e) { toast(e.message,'error'); }
};

window.saveBlueprint = async function(id) {
  const name = document.getElementById('bp-name').value.trim();
  if (!name) { toast('请输入蓝图名称','error'); return; }

  // 编辑已有蓝图时，检测结构是否变化
  if (id) {
    const curNodeIDs = new Set(dagState.nodes.map(n=>n.id));
    const curEdgeKeys = new Set(dagState.edges.map(e=>`${e.from_node_id}->${e.to_node_id}`));
    const structureChanged =
      curNodeIDs.size !== originalNodeIDs.size ||
      curEdgeKeys.size !== originalEdgeKeys.size ||
      [...curNodeIDs].some(id => !originalNodeIDs.has(id)) ||
      [...curEdgeKeys].some(k => !originalEdgeKeys.has(k));

    if (structureChanged) {
      // 结构有变化，检查是否有在途发布需要废弃
      try {
        const ar = await api('/blueprints/'+id+'/active-releases');
        const active = ar.releases || [];
        if (active.length > 0) {
          const list = active.map(r => `  #${r.id} ${r.title} (${r.status})`).join('\n');
          if (!confirm(`⚠️ 蓝图结构已调整，保存将废弃以下 ${active.length} 个在途发布：\n\n${list}\n\n是否继续保存？`)) return;
        }
      } catch(e) {}
    }
  }

  const payload = {
    name,
    description: document.getElementById('bp-desc').value.trim(),
    nodes: dagState.nodes.map(n=>({ id:n.id, env_code:n.env_code, env_name:n.env_name, pos_x:n.pos_x, pos_y:n.pos_y, gate_type:n.gate_type, webhook_token:n.webhook_token||'' })),
    edges: dagState.edges.map(e=>({ from_node_id:e.from_node_id, to_node_id:e.to_node_id }))
  };
  try {
    let resp;
    if (id) resp = await api('/blueprints/'+id, {method:'PUT',body:JSON.stringify(payload)});
    else resp = await api('/blueprints', {method:'POST',body:JSON.stringify(payload)});
    if (resp?.deprecated_count > 0) {
      toast(`蓝图已保存，${resp.deprecated_count} 个在途发布已废弃`,'info');
    } else if (!id) {
      toast('蓝图已创建','success');
    }
    loadPageBlueprintList();
  } catch(e) { toast(e.message,'error'); }
};

// Expose for inline onclick
window.autoLayout = autoLayout;
window.loadPageBlueprintEditor = loadPageBlueprintEditor;
window.loadPageBlueprintList = loadPageBlueprintList;

export { loadPageBlueprintList, loadPageBlueprintEditor };
