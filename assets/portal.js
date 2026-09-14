/* UMRT Portal — shared session helper.
   One request to /api/auth/me per page; every page reads the same promise
   so the nav, the home dashboard and the forms agree on who is signed in.
   Resolves to the user object or null; never rejects. */
(function () {
  var me = fetch('/api/auth/me', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { return d && d.user ? d.user : null; })
    .catch(function () { return null; });

  window.UMRTPortal = {
    me: me,
    firstName: function (u) {
      var n = (u && (u.name || u.email) || '').trim();
      return n ? n.split(/[\s@]/)[0] : '';
    },
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    // Live corridor + hours from the hub's shared status API (read-only,
    // CORS *). Same source the status/areas/quote sites already use, so the
    // portal never shows a different "where is Matt" than the rest of UMRT.
    status: fetch('https://united-mobile-rv.pages.dev/api/status')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return d && d.success ? d : null; })
      .catch(function () { return null; })
  };

  // Nav: show the signed-in user's first name on the Account link.
  me.then(function (u) {
    var link = document.querySelector('nav.portal-nav a[href="/account/"]');
    if (!link) return;
    if (u) {
      link.textContent = window.UMRTPortal.firstName(u) || 'Account';
      link.classList.add('nav-account');
      link.setAttribute('title', u.email || 'Account');
    }
  });

  // Field status strip (any page that has #field-status).
  window.UMRTPortal.status.then(function (d) {
    var el = document.getElementById('field-status');
    if (!el || !d || !d.status) return;
    var s = d.status;
    var esc = window.UMRTPortal.esc;
    el.innerHTML =
      '<span><b>Now near</b>' + esc(s.current_location || '—') + '</span>' +
      '<span><b>Active corridor</b>' + esc(s.active_corridor || '—') + '</span>' +
      '<span><b>Hours</b>' + esc(s.hours || '—') + '</span>' +
      (s.status_note ? '<span><b>Note</b>' + esc(s.status_note) + '</span>' : '');
    el.hidden = false;
  });
})();
