(function () {
  "use strict";

  // ---------------------------
  // Mobile hamburger menu
  // ---------------------------
  var btn = document.getElementById("navbtn");
  var panel = document.getElementById("navpanel");
  if (btn && panel) {
    function closeMenu() {
      btn.setAttribute("aria-expanded", "false");
      panel.classList.remove("open");
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", open ? "false" : "true");
      panel.classList.toggle("open", !open);
    });

    document.addEventListener("click", function (e) {
      if (!panel.classList.contains("open")) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      closeMenu();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu();
    });
  }

  // ---------------------------
  // Demo family sample handling
  // ---------------------------
  function getSampleFromUrl() {
    var u = new URL(window.location.href);
    return (u.searchParams.get("sample") || "").toLowerCase();
  }

  function setSampleInUrl(nextSample) {
    var u = new URL(window.location.href);

    if (!nextSample) {
      u.searchParams.delete("sample");
    } else {
      u.searchParams.set("sample", nextSample);
    }

    // preserve hash
    window.location.href = u.toString();
  }

  // Update all links marked to preserve sample
  function applySampleToLinks(sample) {
    var links = document.querySelectorAll('a[data-preserve-sample="1"]');
    links.forEach(function (a) {
      try {
        var href = a.getAttribute("href");
        if (!href) return;

        // ignore external links
        if (/^https?:\/\//i.test(href)) return;

        var u = new URL(href, window.location.origin);

        if (sample) u.searchParams.set("sample", sample);
        else u.searchParams.delete("sample");

        a.setAttribute("href", u.pathname + (u.search ? u.search : "") + (u.hash ? u.hash : ""));
      } catch (e) {
        // no-op
      }
    });
  }

  // Wire desktop + mobile selects (if present)
  function wireDemoSelect(id) {
    var sel = document.getElementById(id);
    if (!sel) return;

    sel.addEventListener("change", function () {
      var next = (sel.value || "").toLowerCase();
      setSampleInUrl(next);
    });
  }

  var sample = getSampleFromUrl();
  applySampleToLinks(sample);

  // Keep both pickers in sync with URL
  var desktopSel = document.getElementById("demoFamilySelect");
  var mobileSel = document.getElementById("demoFamilySelectMobile");
  if (desktopSel && sample) desktopSel.value = sample;
  if (mobileSel && sample) mobileSel.value = sample;

  // If no sample param and picker exists, default to stark WITHOUT forcing redirect
  // (we only update links so previews/nav are correct)
  if (!sample) {
    var fallback = "";
    if (desktopSel) fallback = desktopSel.value;
    else if (mobileSel) fallback = mobileSel.value;
    sample = (fallback || "stark").toLowerCase();
    applySampleToLinks(sample);
  }

  wireDemoSelect("demoFamilySelect");
  wireDemoSelect("demoFamilySelectMobile");
})();