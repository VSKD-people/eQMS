/* Routes and boot. */
(function (Q) {
  'use strict';
  var V = Q.views;
  Q.route('/today', V.today);
  Q.route('/tasks', V.tasks);
  Q.route('/task/:id', V.task);
  Q.route('/documents', V.documents);
  Q.route('/documents/:id', V.document);
  Q.route('/training', V.training);
  Q.route('/changes', V.changes);
  Q.route('/changes/:id', V.change);
  Q.route('/reviews', V.reviews);
  Q.route('/reviews/:id', V.review);
  Q.route('/quality', V.quality);
  Q.route('/quality/:id', V.qualityRecord);
  Q.route('/analytics', V.analytics);
  Q.route('/admin', function (p, q) { return V.admin({}, q); });
  Q.route('/admin/:section', V.admin);
  Q.route('/notifications', V.notifications);
  Q.route('/profile', V.profile);
  Q.route('/help', V.help);
  Q.route('/search', V.search);
  Q.route('/raise', V.raise);

  window.addEventListener('hashchange', function () {
    if (Q.drawer.isOpen()) Q.drawer.close();
    if (Q.menu.isOpen()) Q.menu.close();
    if (Q.palette.isOpen()) Q.palette.close(true);
    Q.render();
  });
  window.addEventListener('resize', Q.debounce(function () { Q.renderShell(); }, 150));

  Q.load();
  Q.render({ noFocus: true });
  if (!Q.S.seen.tour) setTimeout(function () { Q.tour.open(0); }, 300);
})(window.Q);
