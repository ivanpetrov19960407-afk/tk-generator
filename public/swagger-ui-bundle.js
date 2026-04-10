(function () {
  window.SwaggerUIBundle = function SwaggerUIBundle(config) {
    var target = document.querySelector(config.dom_id || '#swagger-ui');
    if (!target) return;
    fetch(config.url)
      .then(function (r) { return r.json(); })
      .then(function (spec) {
        target.innerHTML = '<h2>TK Generator API</h2><p>Локальный просмотр OpenAPI спецификации.</p><pre></pre>';
        target.querySelector('pre').textContent = JSON.stringify(spec, null, 2);
      })
      .catch(function (err) {
        target.textContent = 'Не удалось загрузить спецификацию: ' + err.message;
      });
  };
})();
