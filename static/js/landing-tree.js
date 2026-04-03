
document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.querySelector('.tree-canvas[data-tree-links]');
  const svg = canvas?.querySelector('.tree-svg');
  const speedToggle = document.getElementById('treeSpeedToggle');
  const playBtn = document.getElementById('treePlayBtn');
  if (!canvas || !svg) return;

  let links = [];
  try {
    links = JSON.parse(canvas.dataset.treeLinks || '[]');
  } catch (err) {
    console.error('Tree link data could not be parsed.', err);
    return;
  }

  const ns = 'http://www.w3.org/2000/svg';
  const speedProfiles = { slow: 1700, medium: 1100, fast: 760 };
  let playbackSpeed = 'medium';
  let playbackRunning = true;
  let generationCount = 0;
  let stageIndex = 0;
  let stageTimer = null;
  let stageGroups = [];

  function boundsFor(el, containerRect) {
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left - containerRect.left,
      right: rect.right - containerRect.left,
      top: rect.top - containerRect.top,
      bottom: rect.bottom - containerRect.top,
      width: rect.width,
      height: rect.height,
      centerX: rect.left - containerRect.left + (rect.width / 2),
      centerY: rect.top - containerRect.top + (rect.height / 2)
    };
  }

  function buildLine(x1, y1, x2, y2, cls, generation) {
    const el = document.createElementNS(ns, 'line');
    el.setAttribute('x1', x1.toFixed(2));
    el.setAttribute('y1', y1.toFixed(2));
    el.setAttribute('x2', x2.toFixed(2));
    el.setAttribute('y2', y2.toFixed(2));
    el.setAttribute('class', `${cls} tree-link-segment`);
    el.dataset.generation = String(generation);
    svg.appendChild(el);
  }

  function assignGenerations(containerRect) {
    const cards = Array.from(canvas.querySelectorAll('.person-card'));
    const rows = [];
    cards.forEach((card) => {
      const box = boundsFor(card, containerRect);
      let rowIndex = rows.findIndex((top) => Math.abs(top - box.top) < 24);
      if (rowIndex === -1) {
        rows.push(box.top);
        rows.sort((a, b) => a - b);
        rowIndex = rows.findIndex((top) => Math.abs(top - box.top) < 24);
      }
      card.dataset.generation = String(rowIndex);
    });
    generationCount = rows.length;
  }

  function groupedLinks() {
    const grouped = new Map();
    links.forEach((link) => {
      const parentKey = (link.parents || []).slice().sort().join('|');
      if (!grouped.has(parentKey)) grouped.set(parentKey, { parents: (link.parents || []).slice().sort(), children: [] });
      grouped.get(parentKey).children.push(link.child);
    });
    return Array.from(grouped.values());
  }

  function applyStage() {
    canvas.querySelectorAll('.person-card').forEach((card) => {
      const gen = Number(card.dataset.generation || 0);
      card.classList.toggle('tree-visible', gen <= stageIndex);
    });
    svg.querySelectorAll('.tree-link-segment').forEach((el) => {
      const gen = Number(el.dataset.generation || 0);
      el.classList.toggle('tree-visible', gen <= stageIndex && stageIndex > 0);
    });
  }

  function stopTimer() {
    if (stageTimer) clearTimeout(stageTimer);
    stageTimer = null;
  }

  function scheduleNextStage() {
    stopTimer();
    if (!playbackRunning) return;
    stageTimer = setTimeout(() => {
      stageIndex = (stageIndex + 1) % Math.max(generationCount, 1);
      applyStage();
      scheduleNextStage();
    }, speedProfiles[playbackSpeed] || speedProfiles.medium);
  }

  function restartPlayback(resetStage = true) {
    if (resetStage) stageIndex = 0;
    canvas.classList.add('tree-has-animation');
    applyStage();
    scheduleNextStage();
    if (playBtn) playBtn.textContent = playbackRunning ? 'Pause tree' : 'Play tree';
  }

  function draw() {
    const containerRect = canvas.getBoundingClientRect();
    if (!containerRect.width || !containerRect.height) return;

    assignGenerations(containerRect);
    svg.setAttribute('viewBox', `0 0 ${containerRect.width} ${containerRect.height}`);
    svg.setAttribute('width', containerRect.width);
    svg.setAttribute('height', containerRect.height);
    svg.innerHTML = '';

    stageGroups = groupedLinks();
    stageGroups.forEach((group) => {
      const parentEls = group.parents.map((id) => canvas.querySelector(`.person-${id}`)).filter(Boolean);
      const childEls = group.children.map((id) => canvas.querySelector(`.person-${id}`)).filter(Boolean);
      if (parentEls.length < 2 || !childEls.length) return;

      const [leftParent, rightParent] = parentEls
        .map((el) => ({ el, box: boundsFor(el, containerRect) }))
        .sort((a, b) => a.box.centerX - b.box.centerX);
      const children = childEls.map((el) => ({ el, box: boundsFor(el, containerRect) })).sort((a, b) => a.box.centerX - b.box.centerX);
      const childGeneration = Math.max(...children.map(({ el }) => Number(el.dataset.generation || 0)));

      const unionCenterX = (leftParent.box.centerX + rightParent.box.centerX) / 2;
      const leftAnchorX = leftParent.box.right;
      const rightAnchorX = rightParent.box.left;
      const sharedParentY = (leftParent.box.centerY + rightParent.box.centerY) / 2;
      const parentsBottom = Math.max(leftParent.box.bottom, rightParent.box.bottom);
      const childrenTop = Math.min(...children.map(({ box }) => box.top));
      const topClearance = 14;
      const bottomClearance = 12;
      const minSplitY = parentsBottom + topClearance;
      const maxSplitY = childrenTop - bottomClearance;
      const splitY = maxSplitY > minSplitY
        ? (minSplitY + ((maxSplitY - minSplitY) / 2))
        : ((parentsBottom + childrenTop) / 2);

      buildLine(leftAnchorX, sharedParentY, unionCenterX, sharedParentY, 'tree-union', childGeneration);
      buildLine(rightAnchorX, sharedParentY, unionCenterX, sharedParentY, 'tree-union', childGeneration);
      buildLine(unionCenterX, sharedParentY, unionCenterX, splitY, 'tree-drop', childGeneration);

      if (children.length === 1) {
        const child = children[0].box;
        const childAnchorY = child.top;
        buildLine(unionCenterX, splitY, child.centerX, splitY, 'tree-connector', childGeneration);
        buildLine(child.centerX, splitY, child.centerX, childAnchorY, 'tree-drop', childGeneration);
      } else {
        const leftChildX = children[0].box.centerX;
        const rightChildX = children[children.length - 1].box.centerX;
        buildLine(leftChildX, splitY, rightChildX, splitY, 'tree-connector', childGeneration);
        children.forEach(({ box }) => {
          const childAnchorY = box.top;
          buildLine(box.centerX, splitY, box.centerX, childAnchorY, 'tree-drop', childGeneration);
        });
      }
    });

    restartPlayback(false);
  }

  let raf = null;
  function scheduleDraw() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  }

  speedToggle?.querySelectorAll('.tree-speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      playbackSpeed = btn.dataset.speed || 'medium';
      speedToggle.querySelectorAll('.tree-speed-btn').forEach((item) => item.classList.toggle('is-active', item === btn));
      if (playbackRunning) restartPlayback(false);
    });
  });

  playBtn?.addEventListener('click', () => {
    playbackRunning = !playbackRunning;
    if (playbackRunning) {
      restartPlayback(false);
    } else {
      stopTimer();
      if (playBtn) playBtn.textContent = 'Play tree';
    }
  });

  window.addEventListener('resize', scheduleDraw);
  if (window.ResizeObserver) new ResizeObserver(scheduleDraw).observe(canvas);
  if (document.fonts?.ready) {
    document.fonts.ready.then(scheduleDraw).catch(() => scheduleDraw());
  }
  scheduleDraw();
});
