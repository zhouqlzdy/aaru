import { currentUser, api, checkAuth, logout } from './api.js';
import { toast, setPage } from './utils.js';
import { showDiffModal } from './modal.js';
import { renderApprovals } from './pages/approvals.js';
import { renderAdmin } from './pages/admin.js';
import { renderDeployUnits, duSnapshots } from './pages/deploy-units.js';
import { renderReleaseList, renderReleaseDetail } from './pages/releases.js';
import { renderCreateRelease, crSnapshots } from './pages/create-release.js';
import { renderBatchRelease } from './pages/batch-release.js';
import { loadPageBlueprintList, envCache, roleCache } from './pages/blueprints.js';

// ===== SPA Router =====
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

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();

  // Preload envs for dropdowns; roles only for admin
  try { envCache = (await api('/environments')).envs||[]; } catch(e) {}
  if (currentUser?.roles?.some(r=>r.name==='admin')) {
    try { roleCache = (await api('/admin/roles')).roles||[]; } catch(e) {}
  }

  loadPage('releases');

  // 全局事件委托：点击 .diff-field-link 打开 diff 模态框
  document.addEventListener('click', e => {
    const el = e.target.closest('.diff-field-link');
    if (!el) return;
    const field = el.dataset.field;
    // 优先使用 duSnapshots（部署单元页面），其次 crSnapshots（创建发布向导）
    const snaps = (duSnapshots.length > 0) ? duSnapshots :
                  (crSnapshots.length > 0) ? crSnapshots : null;
    if (field && snaps) showDiffModal(field, snaps);
  });
});

// ===== Expose functions for inline onclick handlers =====
window.loadPage = loadPage;
window.logout = logout;
