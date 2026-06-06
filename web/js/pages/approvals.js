import { api } from '../api.js';
import { toast, showLoading, escapeHtml, fmtTime } from '../utils.js';

// ===== Approvals =====
let allStages = [];
let allHistory = [];
let activeTab = 'pending';

async function renderApprovals(body) {
  showLoading(body);
  try {
    const [pendingData, historyData] = await Promise.all([
      api('/approvals/pending'),
      api('/approvals/history'),
    ]);
    allStages = pendingData.stages||[];
    allHistory = historyData.stages||[];

    body.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm ${activeTab==='pending'?'btn-primary':'btn-ghost'}" onclick="switchApprovalTab('pending')">待审批 (${allStages.length})</button>
            <button class="btn btn-sm ${activeTab==='history'?'btn-primary':'btn-ghost'}" onclick="switchApprovalTab('history')">审批历史 (${allHistory.length})</button>
          </div>
          <div id="approval-actions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"></div>
        </div>
        <div id="approval-content"></div>
      </div>`;

    renderTabContent();
  } catch(e) { body.innerHTML = '<div class="empty-state"><p>加载失败: '+escapeHtml(e.message)+'</p></div>'; }
}

function renderTabContent() {
  if (activeTab === 'pending') renderPendingTab();
  else renderHistoryTab();
}

// ===== 待审批 =====
function renderPendingTab() {
  const actions = document.getElementById('approval-actions');
  // 提取去重的部署单元和环境列表
  const duSet = new Set();
  const envSet = new Set();
  allStages.forEach(s => {
    const du = s.release?.deploy_unit_code || '';
    if (du) duSet.add(du);
    const env = s.env_name || s.env_code || '';
    if (env) envSet.add(env);
  });
  actions.innerHTML = `
    <select class="form-control" id="approval-filter-du" style="width:auto;min-width:140px;font-size:13px">
      <option value="">全部部署单元</option>
      ${[...duSet].sort().map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}
    </select>
    <select class="form-control" id="approval-filter-env" style="width:auto;min-width:140px;font-size:13px">
      <option value="">全部环境</option>
      ${[...envSet].sort().map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('')}
    </select>
    <button class="btn btn-sm btn-success" id="btn-batch-approve" style="display:none" onclick="batchApproveStages()">批量通过</button>`;

  document.getElementById('approval-filter-du').addEventListener('change', renderFilteredPending);
  document.getElementById('approval-filter-env').addEventListener('change', renderFilteredPending);
  renderFilteredPending();
}

function renderFilteredPending() {
  const filterDu = document.getElementById('approval-filter-du');
  const filterEnv = document.getElementById('approval-filter-env');
  const duVal = filterDu?.value || '';
  const envVal = filterEnv?.value || '';

  const filtered = allStages.filter(s => {
    if (duVal && (s.release?.deploy_unit_code || '') !== duVal) return false;
    if (envVal && (s.env_name || s.env_code || '') !== envVal) return false;
    return true;
  });

  const checkAll = document.getElementById('approval-check-all');
  if (checkAll) checkAll.checked = false;
  updateBatchBtn();

  const content = document.getElementById('approval-content');
  if (allStages.length === 0) {
    content.innerHTML = '<div class="empty-state"><svg width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M12 22l6 6 10-10" stroke="#d1d5db" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="20" r="14" stroke="#d1d5db" stroke-width="2" fill="none"/></svg><p>暂无待审批的发布</p></div>';
    return;
  }
  content.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th style="width:36px"><input type="checkbox" id="approval-check-all" onchange="toggleAllApprovals(this)"></th>
        <th>发布单</th><th>环境</th><th>部署单元</th><th>版本</th><th>申请时间</th><th>操作</th>
      </tr></thead>
      <tbody>${filtered.length === 0
        ? '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">无匹配的待审批项</td></tr>'
        : filtered.map(s => `<tr>
            <td><input type="checkbox" class="approval-check" value="${s.id}" onchange="updateBatchBtn()"></td>
            <td><a href="#" class="text-link" onclick="loadPage('release-detail',${s.release_id});return false">#${s.release_id}</a></td>
            <td>${escapeHtml(s.env_name||s.env_code)}</td>
            <td>${escapeHtml(s.release?.deploy_unit_code||'-')}</td>
            <td><code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-size:12px">${escapeHtml(s.release?.version||'-')}</code></td>
            <td>${fmtTime(s.created_at)}</td>
            <td class="action-group">
              <button class="btn btn-sm btn-success" onclick="approveStage(${s.id})">通过</button>
              <button class="btn btn-sm btn-danger" onclick="rejectStage(${s.id})">驳回</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// ===== 审批历史 =====
function renderHistoryTab() {
  const actions = document.getElementById('approval-actions');
  // 提取去重的部署单元和环境列表
  const duSet = new Set();
  const envSet = new Set();
  allHistory.forEach(s => {
    const du = s.release?.deploy_unit_code || '';
    if (du) duSet.add(du);
    const env = s.env_name || s.env_code || '';
    if (env) envSet.add(env);
  });
  actions.innerHTML = `
    <select class="form-control" id="history-filter-du" style="width:auto;min-width:140px;font-size:13px">
      <option value="">全部部署单元</option>
      ${[...duSet].sort().map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}
    </select>
    <select class="form-control" id="history-filter-env" style="width:auto;min-width:140px;font-size:13px">
      <option value="">全部环境</option>
      ${[...envSet].sort().map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('')}
    </select>`;

  document.getElementById('history-filter-du').addEventListener('change', renderFilteredHistory);
  document.getElementById('history-filter-env').addEventListener('change', renderFilteredHistory);
  renderFilteredHistory();
}

function renderFilteredHistory() {
  const filterDu = document.getElementById('history-filter-du');
  const filterEnv = document.getElementById('history-filter-env');
  const duVal = filterDu?.value || '';
  const envVal = filterEnv?.value || '';

  const filtered = allHistory.filter(s => {
    if (duVal && (s.release?.deploy_unit_code || '') !== duVal) return false;
    if (envVal && (s.env_name || s.env_code || '') !== envVal) return false;
    return true;
  });

  const content = document.getElementById('approval-content');
  if (allHistory.length === 0) {
    content.innerHTML = '<div class="empty-state"><p>暂无审批历史</p></div>';
    return;
  }
  content.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>发布单</th><th>环境</th><th>部署单元</th><th>版本</th><th>审批结果</th><th>审批时间</th><th>备注</th>
      </tr></thead>
      <tbody>${filtered.length === 0
        ? '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">无匹配的审批记录</td></tr>'
        : filtered.map(s => {
            const isApproved = s.status === 'approved' || s.status === 'completed' || s.status === 'pushing';
            const resultHTML = isApproved
              ? '<span style="color:#16a34a;font-weight:500">通过</span>'
              : '<span style="color:#ef4444;font-weight:500">驳回</span>';
            return `<tr>
              <td><a href="#" class="text-link" onclick="loadPage('release-detail',${s.release_id});return false">#${s.release_id}</a></td>
              <td>${escapeHtml(s.env_name||s.env_code)}</td>
              <td>${escapeHtml(s.release?.deploy_unit_code||'-')}</td>
              <td><code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-size:12px">${escapeHtml(s.release?.version||'-')}</code></td>
              <td>${resultHTML}</td>
              <td>${fmtTime(s.approved_at)}</td>
              <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(s.comment||'')}">${escapeHtml(s.comment||'-')}</td>
            </tr>`;
          }).join('')}
      </tbody>
    </table>`;
}

// ===== Tab switching =====
function switchApprovalTab(tab) {
  activeTab = tab;
  // 更新按钮样式
  document.querySelectorAll('.card-header .btn-sm').forEach(btn => {
    btn.className = btn.className.replace(/btn-primary|btn-ghost/g, '').trim();
  });
  const targetBtn = [...document.querySelectorAll('.card-header .btn-sm')].find(b => b.textContent.includes(tab === 'pending' ? '待审批' : '审批历史'));
  if (targetBtn) targetBtn.classList.add('btn-primary');
  renderTabContent();
}

// ===== Batch operations =====
function getCheckedIds() {
  return [...document.querySelectorAll('.approval-check:checked')].map(c => parseInt(c.value));
}

function updateBatchBtn() {
  const btn = document.getElementById('btn-batch-approve');
  if (btn) btn.style.display = getCheckedIds().length > 0 ? '' : 'none';
}

function toggleAllApprovals(el) {
  document.querySelectorAll('.approval-check').forEach(c => { c.checked = el.checked; });
  updateBatchBtn();
}

async function batchApproveStages() {
  const ids = getCheckedIds();
  if (ids.length === 0) return;
  if (!confirm(`确认批量通过 ${ids.length} 个审批项？`)) return;

  const comment = prompt('审批备注（可选，将应用于所有项）:') || '';
  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      await api('/stages/' + id + '/approve', { method: 'POST', body: JSON.stringify({comment}) });
      ok++;
    } catch(e) { fail++; }
  }
  if (ok > 0) toast(`已通过 ${ok} 项${fail > 0 ? `，失败 ${fail} 项` : ''}`, 'success');
  else toast('批量通过失败', 'error');
  renderApprovals(document.getElementById('content-body'));
}

// expose to window
window.toggleAllApprovals = toggleAllApprovals;
window.updateBatchBtn = updateBatchBtn;
window.batchApproveStages = batchApproveStages;
window.switchApprovalTab = switchApprovalTab;

export { renderApprovals };
