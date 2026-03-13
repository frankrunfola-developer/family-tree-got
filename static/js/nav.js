document.addEventListener("DOMContentLoaded", function () {
  const button = document.getElementById("navButton");
  const panel = document.getElementById("navPanel");

  if (!button || !panel) return;

  function closeMenu() {
    panel.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
  }

  function openMenu() {
    panel.classList.add("is-open");
    button.setAttribute("aria-expanded", "true");
  }

  function toggleMenu(event) {
    event.preventDefault();
    event.stopPropagation();

    const isOpen = panel.classList.contains("is-open");

    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  button.addEventListener("click", toggleMenu);

  panel.addEventListener("click", function (event) {
    event.stopPropagation();
  });

  document.addEventListener("click", function () {
    closeMenu();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeMenu();
    }
  });
});