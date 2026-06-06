import { formatForDiff, computeLineDiff, escapeHtml } from './utils.js';

// ===== Diff Modal =====
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

  // 根据左侧环境，生成右侧下拉框选项（只显示有差异的环境）
  function rightEnvOptions(leftIdx, selectedIdx) {
    const opts = envOpts.filter(o => {
      if (o.idx === leftIdx) return false;
      return formatted[o.idx] !== formatted[leftIdx];
    });
    if (opts.length === 0) return '';
    const sel = opts.some(o => o.idx === selectedIdx) ? selectedIdx : opts[0].idx;
    return opts.map(o =>
      `<option value="${o.idx}" ${o.idx===sel?'selected':''}>${escapeHtml(o.label)}</option>`
    ).join('');
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
  // 选择第一个与 defaultLeft 有差异的环境作为默认右侧
  const defaultRight = (() => {
    for (let i = 0; i < formatted.length; i++) {
      if (i !== defaultLeft && formatted[i] !== formatted[defaultLeft]) return i;
    }
    return defaultLeft;
  })();
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
    // 重建右侧下拉框（仅包含有差异的环境）
    const optsHtml = rightEnvOptions(li, ri);
    rightSel.innerHTML = optsHtml;
    if (!optsHtml) {
      bodyEl.querySelector('#diff-content').innerHTML = '<div class="diff-empty">当前环境与其他环境无差异</div>';
      return;
    }
    renderDiff(li, parseInt(rightSel.value));
  }

  leftSel.addEventListener('change', onSelChange);
  rightSel.addEventListener('change', onSelChange);

  const escHandler = e => { if (e.key==='Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  onSelChange();
}

export { showDiffModal };
