/* Product page behaviour: language switch, the reach tester demo and copy buttons.
 * Plain browser script, no build step; i18n.js (loaded first) defines `en` and `ui`. */
(function () {
  /* ---------- language ---------- */
  var KEY = 'jump-attack-intro-lang';
  var zh = {}; // the Chinese written in index.html, kept so switching back needs no second dictionary
  var textNodes = document.querySelectorAll('[data-i18n]');
  var attrNodes = document.querySelectorAll('[data-i18n-attr]');
  textNodes.forEach(function (el) { zh[el.dataset.i18n] = el.innerHTML; });
  attrNodes.forEach(function (el) {
    el.dataset.i18nAttr.split(';').forEach(function (pair) {
      var p = pair.split(':');
      zh[p[1]] = el.getAttribute(p[0]);
    });
  });

  function readSaved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function save(lang) {
    try { localStorage.setItem(KEY, lang); } catch (e) { /* private mode: the choice just isn't remembered */ }
  }
  // ?lang= in a shared link wins, then the visitor's last choice, then the browser language.
  function initialLang() {
    var param = new URLSearchParams(location.search).get('lang');
    if (param === 'zh' || param === 'en') return param;
    var saved = readSaved();
    if (saved === 'zh' || saved === 'en') return saved;
    var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    return /^zh\b/i.test(langs[0]) ? 'zh' : 'en';
  }

  var lang = 'zh';
  function t(key) { return lang === 'en' ? ui.en[key] : ui.zh[key]; }
  function applyLang(next) {
    lang = next;
    var dict = next === 'en' ? en : zh;
    textNodes.forEach(function (el) { el.innerHTML = dict[el.dataset.i18n]; });
    attrNodes.forEach(function (el) {
      el.dataset.i18nAttr.split(';').forEach(function (pair) {
        var p = pair.split(':');
        el.setAttribute(p[0], dict[p[1]]);
      });
    });
    document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('#lang [data-lang]').forEach(function (s) { s.classList.toggle('on', s.dataset.lang === next); });
    render(+input.value, false);
  }

  document.getElementById('lang').addEventListener('click', function () {
    var next = lang === 'en' ? 'zh' : 'en';
    save(next);
    var url = new URL(location.href);
    url.searchParams.set('lang', next);
    history.replaceState(null, '', url);
    applyLang(next);
  });

  /* ---------- reach tester ---------- */
  // Vanes every 1 cm from 296 to 328. The dunk line is rim 305 + 15 = 320 (CLAUDE.md); 318 is the author's running reach.
  var LO = 296, HI = 328, DUNK = 320, RIM = 305, AUTHOR = 318;
  var rig = document.getElementById('rig');
  var input = document.getElementById('reach');
  var H = 300, PAD = 12;
  function y(cm) { return PAD + (HI - cm) * (H - 2 * PAD) / (HI - LO); }

  var vanes = [];
  for (var cm = LO; cm <= HI; cm++) {
    var v = document.createElement('div');
    v.className = 'vane';
    v.style.top = (y(cm) - 2) + 'px';
    v.style.width = (cm % 5 === 0 ? 62 : 50) + '%';
    v.dataset.cm = cm;
    rig.appendChild(v);
    vanes.push(v);
  }
  rig.insertAdjacentHTML('beforeend',
    '<div class="pole"></div>' +
    '<div class="line320" style="top:' + (y(DUNK) - 1.5) + 'px"></div>' +
    '<div class="lab c" style="left:0;top:' + (y(DUNK) - 24) + 'px"><span class="lab-dunk"></span> 320</div>' +
    '<div class="rim" style="top:' + (y(RIM) - 3) + 'px"></div>' +
    '<svg class="net" style="top:' + (y(RIM) + 3) + 'px" viewBox="0 0 100 46" preserveAspectRatio="none"><path d="M2 0 L14 46 M34 0 L38 46 M66 0 L62 46 M98 0 L86 46 M8 22 H92 M12 40 H88" stroke="#3A332A" stroke-width="2" fill="none" vector-effect="non-scaling-stroke"/></svg>' +
    '<div class="lab r" style="left:0;top:' + (y(RIM) - 9) + 'px"><span class="lab-rim"></span> 305</div>' +
    '<div class="marker"></div>');
  var marker = rig.querySelector('.marker');
  var gap = document.getElementById('gap'), gapLabel = document.getElementById('gapLabel');
  var reachNum = document.getElementById('reachNum'), reachVal = document.getElementById('reachVal');
  var verdict = document.getElementById('verdict');

  function render(reach, sweep) {
    var d = DUNK - reach;
    vanes.forEach(function (vane, i) {
      var c = +vane.dataset.cm;
      vane.classList.toggle('gapv', d > 0 && c > reach && c <= DUNK);
      vane.classList.toggle('overv', d <= 0 && c > DUNK && c <= reach);
      if (sweep) { vane.style.animationDelay = (vanes.length - i) * 18 + 'ms'; vane.classList.add('sweep'); }
    });
    rig.querySelector('.lab-dunk').textContent = lang === 'en' ? 'Dunk line' : '扣篮线';
    rig.querySelector('.lab-rim').textContent = lang === 'en' ? 'Rim' : '篮筐';
    marker.style.top = y(reach) + 'px';
    marker.classList.toggle('over', d <= 0);
    gap.classList.toggle('over', d <= 0);
    gapLabel.textContent = t(d > 0 ? 'gapBelow' : 'gapOver');
    gap.innerHTML = Math.abs(d).toFixed(1) + '<small>cm</small>';
    reachNum.textContent = reachVal.textContent = reach;
    verdict.textContent = reach === AUTHOR ? t('author') : t(d > 0 ? 'below' : 'over').replace('{d}', Math.abs(d));
  }
  input.addEventListener('input', function () { render(+input.value, false); });

  /* ---------- copy buttons ---------- */
  document.querySelectorAll('.copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var code = b.parentElement.querySelector('code');
      var label = b.innerHTML;
      function flash(key) { b.textContent = t(key); setTimeout(function () { b.innerHTML = label; }, 1500); }
      function fallback() {
        var r = document.createRange();
        r.selectNodeContents(code);
        var s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        flash('selected');
      }
      try { navigator.clipboard.writeText(code.textContent).then(function () { flash('copied'); }, fallback); } catch (e) { fallback(); }
    });
  });

  applyLang(initialLang());
  render(+input.value, true);
})();
