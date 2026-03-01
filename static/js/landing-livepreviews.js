/* static/js/landing-livepreviews.js */

function getSampleId() {
  const url = new URL(window.location.href);
  return (url.searchParams.get("sample") || "stark").toLowerCase();
}

function scaleFrame(frame) {
  const stage = frame.querySelector(".lmLiveStage");
  if (!stage) return;

  const baseW = Number(stage.dataset.baseW || 900);
  const baseH = Number(stage.dataset.baseH || 560);

  const w = frame.clientWidth || 1;
  const h = frame.clientHeight || 1;

  const fit = (frame.dataset.fit || "contain").toLowerCase();
  const sx = w / baseW;
  const sy = h / baseH;
  const s = Math.max(0.01, fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy));
  stage.style.setProperty("--lmScale", String(s));

  const shiftX = Number(frame.dataset.shiftX || 0);
  const shiftY = Number(frame.dataset.shiftY || 0);
  stage.style.setProperty("--lmShiftX", String(shiftX));
  stage.style.setProperty("--lmShiftY", String(shiftY));
}

function wireScaling() {
  const frames = Array.from(document.querySelectorAll(".lmLiveFrame"));
  if (!frames.length) return;

  const ro = new ResizeObserver(() => frames.forEach(scaleFrame));
  frames.forEach(f => ro.observe(f));
  frames.forEach(scaleFrame);
}

function setGlobals(sampleId) {
  const api = `/api/sample/${encodeURIComponent(sampleId)}/tree`;

  window.TREE_API_URL = api;
  window.TREE_FAMILY_ID = sampleId;
  window.TREE_PREVIEW_MODE = true;
  window.TREE_PREVIEW_MOBILE_ONLY = false;
  window.TREE_PREVIEW_DEPTH = 2;
  window.TREE_PREVIEW_MAX = 6;
  window.TREE_PREVIEW_STRATEGY = "focus_bottom";

  window.TIMELINE_API_URL = api;
  window.TIMELINE_FAMILY_ID = sampleId;

  window.MAP_API_URL = api;
  window.MAP_FAMILY_ID = sampleId;
  window.MAP_IMAGE_URL = (sampleId === "stark" || sampleId === "lannister")
    ? "/static/img/westeros.png"
    : "/static/img/world.png";
}

async function boot() {
  const hasTree = document.getElementById("treeSvg");
  const hasTl = document.getElementById("tlSnakeRoot");
  const hasMap = document.getElementById("mapRoot");
  if (!hasTree && !hasTl && !hasMap) return;

  setGlobals(getSampleId());
  wireScaling();

  if (hasTree) await import("./tree.js");
  if (hasTl) await import("./timeline.js");
  if (hasMap) await import("./map.js");
}

boot();
