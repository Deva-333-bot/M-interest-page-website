(function () {
  'use strict';
  document.documentElement.classList.add('js');

  // Accessible disclosure menus (public site and admin).
  document.querySelectorAll('.menu-btn').forEach(function (btn) {
    var nav = document.getElementById(btn.getAttribute('aria-controls'));
    if (!nav) return;
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      nav.classList.toggle('open', !open);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
        btn.setAttribute('aria-expanded', 'false'); nav.classList.remove('open'); btn.focus();
      }
    });
  });

  // Loading state + double-submit guard for every form marked data-busy.
  function reset(form) {
    delete form.dataset.submitting; form.removeAttribute('aria-busy');
    var b = form.querySelector('button[type=submit]');
    if (b && b.dataset.label) { b.textContent = b.dataset.label; b.removeAttribute('aria-disabled'); }
  }
  document.querySelectorAll('form[data-busy]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (form.dataset.submitting) { e.preventDefault(); return; }
      if (form.hasAttribute('novalidate') && form.dataset.clientcheck !== 'off') {
        var bad = form.querySelector(':invalid');
        if (bad && !form.closest('[data-skip-check]')) { /* server validates and explains; native hints only help */ }
      }
      form.dataset.submitting = '1'; form.setAttribute('aria-busy', 'true');
      var b = form.querySelector('button[type=submit]');
      if (b) { b.dataset.label = b.textContent; b.textContent = form.dataset.busy; b.setAttribute('aria-disabled', 'true'); }
    });
  });
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) document.querySelectorAll('form[data-busy]').forEach(reset);
  });
})();
