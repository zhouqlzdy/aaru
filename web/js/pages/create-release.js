import { api } from '../api.js';
import { toast, showLoading, escapeHtml, fmtTime, filterDUsByPermission, crAssignValueColors, crArrSummary, summarizeValue, crFormatJson, crFormatPreviewValue, CR_INIT_DB_FIELDS, autoUpdateInitDbUrls } from '../utils.js';

// ===== Create Release Wizard =====
let crStep = 1;
let crTitle = '';
let crDUList = [];
let crSelectedDU = null;
export let crSnapshots = [];
let crChanges = {};
let crExtraFields = [];
let crBlueprints = [];
let crSelectedBP = null;
let crBlueprintEnvs = new Set(); // 蓝图涉及的环境代码集合
let crPerEnvMode = new Set(); // fields in per-env mode
let crPerEnvVals = {};        // {fieldName: {envCode: val}}
let crTitleAutoGen = true;    // 标题是否为自动生成（未被用户手动修改）
let crDiffKeys = [];          // step2 中有差异的字段列表，用于带入 step3
let crDiffKeysApplied = false; // 差异字段是否已带入 step3（防止重复进入时重复添加）

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
const CR_READONLY_FIELDS = new Set([
  'id','classCode','biz_serial','Env','System','SiloCode','SiloNo',
  'SystemName','belong_System'
]);
const CR_FIELD_GROUPS = [
  { name: '基础信息', fields: ['AppName','deploy_type','desc','du_type_code','NodeCount','RunAsGroup','RunAsUser'] },
  { name: '制品坐标', fields: ['ArtifactGroupId','ArtifactId'] },
  { name: 'JVM & 日志', fields: ['ExtraConfig','JvmArgs','Loglevel','MetricPort'] },
  { name: '数据源 & Kafka', fields: ['BatchSize','frameworkDatasource','ImportData','initDb','initDbAuth','initDbFinal','initKafka','kafkaDeliveryTimeoutMs','kafkaTxTimeoutMs','MaxPollRecords','serviceDatasource'] },
  { name: '远程 & FTP', fields: ['dbStreamEnhancedAudit','RemoteDir','Servers','UseFtp'] },
];

async function renderCreateRelease(body, actions) {
  crStep = 1; crTitle = ''; crSelectedDU = null; crSnapshots = [];
  crChanges = {}; crExtraFields = []; crSelectedBP = null; crBlueprintEnvs = new Set();
  crPerEnvMode = new Set(); crPerEnvVals = {}; crTitleAutoGen = true; crDiffKeys = []; crDiffKeysApplied = false;
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
              <input class="form-control" id="cr-title" value="${escapeHtml(crTitle)}" placeholder="选择DU和版本后自动生成，可手动修改" oninput="crTitle=this.value;crTitleAutoGen=false"></div>
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
  crTitleAutoGen = true; // 切换 DU 时重置标记，允许自动生成
  document.querySelectorAll('#cr-du-list .du-list-item').forEach(el=>{
    el.classList.toggle('selected', el.querySelector('.du-item-code')?.textContent===d.code);
  });
  crAutoGenTitle();
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

// ===== Step 2: View Current State =====
function crStep2() {
  const code = crSelectedDU?.code||'';
  let tableHTML = '';
  if (crSnapshots.length === 0) {
    tableHTML = '<div class="empty-state"><p>未在任何DMDB环境中找到此部署单元</p></div>';
  } else {
    // 收集所有字段（排除展开的子行、只读字段、已有 _Note 摘要的原始字段）
    const allKeys = new Set();
    crSnapshots.forEach(s => {
      if(s.fields) Object.keys(s.fields).forEach(k => {
        if(!CR_READONLY_FIELDS.has(k) && !k.includes('[')) allKeys.add(k);
      });
    });
    // 如果某字段存在对应的 _Note 摘要（如 initDb → initDb_Note），隐藏原始 JSON 字段
    [...allKeys].forEach(k => {
      if (k.endsWith('_Note')) return;
      if (allKeys.has(k + '_Note')) allKeys.delete(k);
    });
    // 只保留有差异的字段
    const diffKeys = [...allKeys].filter(k => {
      const vals = crSnapshots.map(s=>String((s.fields||{})[k]??''));
      return new Set(vals).size > 1;
    }).sort();
    crDiffKeys = diffKeys;
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
  try { crRenderStep(document.getElementById('content-body')); } catch(e) { toast('页面渲染失败: '+e.message,'error'); console.error(e); }
};

window.crGoStep3 = function() {
  crStep = 3;
  if (!crChanges.ArtifactVersion && crChanges.ArtifactVersion!=='') crChanges = { ArtifactVersion: '' };
  // 首次进入 step3 时，将 step2 中有差异的字段自动带入变更列表
  if (!crDiffKeysApplied && crDiffKeys.length > 0) {
    crDiffKeys.forEach(f => {
      if (f !== 'ArtifactVersion' && !crExtraFields.includes(f)) {
        crExtraFields.push(f);
        if (!(f in crChanges)) crChanges[f] = '';
      }
    });
    crDiffKeysApplied = true;
  }
  try { crRenderStep(document.getElementById('content-body')); } catch(e) { toast('页面渲染失败: '+e.message,'error'); console.error(e); }
};

// ===== Step 3: Define Changes =====
function crStep3() {
  return {
    content: `
      <div class="cr-section"><div class="cr-section-title">ArtifactVersion（必填）</div>${crRenderFieldRow('ArtifactVersion', true)}</div>
      <div class="cr-section"><div class="cr-section-title">其他变更字段</div>
        ${crExtraFields.map(f=>crRenderExtraField(f)).join('')}
        <button class="cr-add-field-btn" onclick="crOpenFieldModal()">+ 添加字段</button>
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

window.crOpenFieldModal = function() {
  const used = new Set(['ArtifactVersion', ...crExtraFields]);
  const overlay = document.createElement('div');
  overlay.className = 'cr-field-modal-overlay';
  overlay.id = 'cr-field-modal-overlay';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) crCloseFieldModal(); });

  let groupsHTML = CR_FIELD_GROUPS.map((g, gi) => {
    const items = g.fields.map(f => {
      const isUsed = used.has(f);
      return `<span class="cr-field-chip${isUsed ? ' used' : ''}" data-field="${f}" ${isUsed ? '' : 'onclick="crToggleFieldChip(this,\'' + f + '\')"'}>
        ${f}${isUsed ? ' ✓' : ''}
      </span>`;
    }).join('');
    const availableCount = g.fields.filter(f => !used.has(f)).length;
    return `<div class="cr-field-group" data-group="${gi}">
      <div class="cr-field-group-header">
        <span class="cr-field-group-title">${g.name} <span style="font-weight:400;color:var(--text-muted);font-size:11px">(${availableCount}可选)</span></span>
        <button class="cr-field-group-toggle" onclick="crToggleGroupSelect(${gi})">全选</button>
      </div>
      <div class="cr-field-group-items">${items}</div>
    </div>`;
  }).join('');

  overlay.innerHTML = `<div class="cr-field-modal">
    <div class="cr-field-modal-header">
      <h3>选择变更字段</h3>
      <button class="cr-field-modal-close" onclick="crCloseFieldModal()">✕</button>
    </div>
    <div class="cr-field-modal-search">
      <input type="text" id="cr-field-search" placeholder="搜索字段名..." oninput="crFilterFieldChips(this.value)" autofocus>
    </div>
    <div class="cr-field-modal-body">${groupsHTML}</div>
    <div class="cr-field-modal-footer">
      <span class="cr-field-modal-count" id="cr-field-modal-count">已选 0 个字段</span>
      <div>
        <button class="btn btn-sm btn-secondary" onclick="crCloseFieldModal()">取消</button>
        <button class="btn btn-sm btn-primary" onclick="crConfirmAddFields()" style="margin-left:8px">确认添加</button>
      </div>
    </div>
  </div>`;

  document.body.appendChild(overlay);
  document.getElementById('cr-field-search').focus();
  const escHandler = e => { if (e.key==='Escape') { crCloseFieldModal(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);
};

window.crCloseFieldModal = function() {
  const el = document.getElementById('cr-field-modal-overlay');
  if (el) el.remove();
};

window.crFilterFieldChips = function(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('#cr-field-modal-overlay .cr-field-group').forEach(group => {
    let hasVisible = false;
    group.querySelectorAll('.cr-field-chip').forEach(chip => {
      const field = chip.dataset.field;
      const match = !q || field.toLowerCase().includes(q);
      chip.style.display = match ? '' : 'none';
      if (match) hasVisible = true;
    });
    group.style.display = hasVisible ? '' : 'none';
  });
};

window.crToggleFieldChip = function(el, fieldName) {
  el.classList.toggle('selected');
  const count = document.querySelectorAll('#cr-field-modal-overlay .cr-field-chip.selected').length;
  const countEl = document.getElementById('cr-field-modal-count');
  if (countEl) countEl.textContent = `已选 ${count} 个字段`;
};

window.crToggleGroupSelect = function(groupIdx) {
  const group = document.querySelectorAll('#cr-field-modal-overlay .cr-field-group')[groupIdx];
  if (!group) return;
  const chips = group.querySelectorAll('.cr-field-chip:not(.used)');
  const allSelected = [...chips].every(c => c.classList.contains('selected'));
  chips.forEach(c => { if (allSelected) c.classList.remove('selected'); else c.classList.add('selected'); });
  const btn = group.querySelector('.cr-field-group-toggle');
  if (btn) btn.textContent = allSelected ? '全选' : '取消';
  const count = document.querySelectorAll('#cr-field-modal-overlay .cr-field-chip.selected').length;
  const countEl = document.getElementById('cr-field-modal-count');
  if (countEl) countEl.textContent = `已选 ${count} 个字段`;
};

window.crConfirmAddFields = function() {
  document.querySelectorAll('#cr-field-modal-overlay .cr-field-chip.selected').forEach(chip => {
    const f = chip.dataset.field;
    if (!crExtraFields.includes(f)) { crExtraFields.push(f); crChanges[f] = crChanges[f] || ''; }
  });
  crCloseFieldModal();
  crRenderStep(document.getElementById('content-body'));
};

window.crRemoveField = function(f) {
  crExtraFields = crExtraFields.filter(x=>x!==f);
  delete crChanges[f];
  crRenderStep(document.getElementById('content-body'));
};

window.crSetChange = function(f, v) {
  crChanges[f] = v;
  if (f === 'ArtifactVersion') crAutoGenTitle();
};

function crAutoGenTitle() {
  if (!crTitleAutoGen) return;
  const code = crSelectedDU?.code || '';
  const ver = crChanges.ArtifactVersion || '';
  const title = [code, ver].filter(Boolean).join(' ');
  crTitle = title;
  const el = document.getElementById('cr-title');
  if (el) el.value = title;
}

window.crSelectBP = function(id) {
  crSelectedBP = id ? (crBlueprints.find(b=>b.id===id)||null) : null;
  crUpdateNextBtn();
};

function crUpdateNextBtn() {
  const btn = document.getElementById('cr-next1');
  if (btn) btn.disabled = !(crSelectedDU && crSelectedBP);
}

// ===== Step 4: Preview =====
window.crGoStep4Preview = function() {
  crStep = 4;
  try { crRenderStep(document.getElementById('content-body')); } catch(e) { toast('预览页渲染失败: '+e.message,'error'); console.error(e); }
};

function crResolveForEnv(fieldName, envCode) {
  if (crPerEnvMode.has(fieldName)) {
    const pv = crPerEnvVals[fieldName]||{};
    return pv[envCode] ?? '';
  }
  return crChanges[fieldName];
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
        if (CR_READONLY_FIELDS.has(k) || k.includes('[') || k.endsWith('_Note')) return false;
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
      <button class="btn btn-success" id="cr-submit-btn" onclick="crSubmitRelease()">确认创建发布</button>`
  };
}

window.crSubmitRelease = async function() {
  const btn = document.getElementById('cr-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = '创建中...'; }
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

  if (Object.keys(changes).length===0) { toast('请至少填写一个变更字段','error'); if (btn) { btn.disabled = false; btn.textContent = '确认创建发布'; } return; }
  // 检查 ArtifactVersion 是否有值
  const av = changes.ArtifactVersion;
  if (!av || (typeof av==='object' && Object.keys(av).length===0)) { toast('ArtifactVersion为必填项','error'); if (btn) { btn.disabled = false; btn.textContent = '确认创建发布'; } return; }

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
  } catch(e) { toast(e.message,'error'); if (btn) { btn.disabled = false; btn.textContent = '确认创建发布'; } }
};

export { renderCreateRelease };
