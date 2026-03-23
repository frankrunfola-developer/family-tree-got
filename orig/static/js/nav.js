document.addEventListener("DOMContentLoaded", function () {

  const navButton = document.getElementById("navButton");
  const navPanel = document.getElementById("navPanel");

  const familiesToggle = document.getElementById("familiesMobileToggle");
  const familiesMenu = document.getElementById("familiesMobileMenu");

  if (navButton && navPanel) {

    navButton.addEventListener("click", function () {

      const open = navPanel.classList.contains("is-open");

      if (open) {
        navPanel.classList.remove("is-open");
        navButton.setAttribute("aria-expanded", "false");
      } else {
        navPanel.classList.add("is-open");
        navButton.setAttribute("aria-expanded", "true");
      }

    });

  }

  if (familiesToggle && familiesMenu) {

    familiesToggle.addEventListener("click", function (e) {

      e.preventDefault();

      const open = familiesMenu.classList.contains("is-open");

      if (open) {
        familiesMenu.classList.remove("is-open");
        familiesToggle.setAttribute("aria-expanded", "false");
      } else {
        familiesMenu.classList.add("is-open");
        familiesToggle.setAttribute("aria-expanded", "true");
      }

    });

  }

});