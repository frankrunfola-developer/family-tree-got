
(function () {
  function uniqueInVisualOrder(nodes) {
    return Array.from(nodes).sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      if (Math.abs(ra.top - rb.top) > 10) return ra.top - rb.top;
      return ra.left - rb.left;
    });
  }

  function groupByGeneration(items) {
    const groups = [];
    const threshold = 28; // pixels of vertical tolerance per row
    uniqueInVisualOrder(items).forEach((el) => {
      const top = el.getBoundingClientRect().top;
      let placed = false;
      for (const g of groups) {
        if (Math.abs(g.top - top) <= threshold) {
          g.items.push(el);
          g.samples.push(top);
          g.top = g.samples.reduce((a, b) => a + b, 0) / g.samples.length;
          placed = true;
          break;
        }
      }
      if (!placed) {
        groups.push({ top, samples: [top], items: [el] });
      }
    });
    return groups.map(g => g.items);
  }

  function buildSyntheticRows(root, itemSelector, rowClass) {
    // remove old synthetic wrappers
    root.querySelectorAll(":scope > ." + rowClass).forEach(el => el.remove());
    const items = Array.from(root.querySelectorAll(itemSelector));
    if (!items.length) return [];
    const groups = groupByGeneration(items);

    // We do NOT reparent actual items. We create invisible markers for row activation timing.
    return groups.map((group, i) => {
      const marker = document.createElement("div");
      marker.className = rowClass;
      marker.dataset.groupIndex = String(i);
      marker._items = group;
      root.appendChild(marker);
      return marker;
    });
  }

  function startGroupedCarousel(rootSelector, itemSelector, rowClass) {
    const root = document.querySelector(rootSelector);
    if (!root) return;

    let rows = [];
    let index = 0;
    let timer = null;

    function clearActive() {
      rows.forEach(row => {
        row.classList.remove("carousel-active");
        (row._items || []).forEach(item => item.classList.remove("carousel-active"));
      });
    }

    function activateRow(i) {
      clearActive();
      if (!rows.length) return;
      const row = rows[i];
      row.classList.add("carousel-active");
      (row._items || []).forEach(item => item.classList.add("carousel-active"));
    }

    function collect() {
      rows = buildSyntheticRows(root, itemSelector, rowClass);
      index = 0;
      if (rows.length) activateRow(0);
    }

    function tick() {
      if (!rows.length) return;
      index = (index + 1) % rows.length;
      activateRow(index);
    }

    function begin() {
      collect();
      if (timer) window.clearInterval(timer);
      if (rows.length > 1) timer = window.setInterval(tick, 1800);
    }

    begin();

    const observer = new MutationObserver(() => {
      window.clearTimeout(root.__carouselRefreshTimer);
      root.__carouselRefreshTimer = window.setTimeout(begin, 160);
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  document.addEventListener("DOMContentLoaded", function () {
    startGroupedCarousel("#treeSvg", ".tree-node-wrap", "tree-generation-row");
    startGroupedCarousel(".tree-canvas", ".person-card", "generation-row");
  });
})();
