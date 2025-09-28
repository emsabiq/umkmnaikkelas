/* prefs.js — aktifkan Preferensi UMKM
   - Menyimpan/ambil preferensi dari localStorage
   - Auto apply margin berdasarkan kategori
   - Reset preferensi
   - Autosave trigger (event yang bisa ditangkap app.js kamu)
*/

(function () {
  const KEY = 'umkm:prefs:v1';
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const defaults = {
    numberFormat: 'id-ID',
    autosaveMode: 'off',  // 'on' | 'off'
    precision: 2,
    hppSchema: 'default', // 'default' | 'oh_on_all' | 'tax_after_oh'
    autoApplyCategory: true,
    categoryMargins: [
      { name: 'F&B',     low: 20, mid: 35, high: 50 },
      { name: 'Jasa',    low: 20, mid: 30, high: 40 },
      { name: 'Sandang', low: 20, mid: 30, high: 45 },
    ],
  };

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { ...defaults };
      const obj = JSON.parse(raw);
      return { ...defaults, ...obj };
    } catch {
      return { ...defaults };
    }
  }
  function savePrefs(p) { localStorage.setItem(KEY, JSON.stringify(p)); }

  // state
  let prefs = loadPrefs();
  window.umkmPrefs = prefs; // bisa dipakai app.js kamu

  // apply ke UI
  function applyUI() {
    const num = $('#numberFormat');
    const autosave = $('#autosaveMode');
    const prec = $('#precision');
    const schema = $('#hppSchema');
    const autoCat = $('#autoApplyCategory');

    if (num) num.value = prefs.numberFormat;
    if (autosave) autosave.value = prefs.autosaveMode;
    if (prec) prec.value = String(prefs.precision);
    if (schema) schema.value = prefs.hppSchema;
    if (autoCat) autoCat.checked = !!prefs.autoApplyCategory;

    renderCategoryList();
  }

  // render list template kategori
  function renderCategoryList() {
    const wrap = $('#categoryMarginArea');
    if (!wrap) return;
    wrap.innerHTML = '';
    prefs.categoryMargins.forEach((row, idx) => {
      const div = document.createElement('div');
      div.className = 'row g-2 align-items-center';
      div.innerHTML = `
        <div class="col-5">
          <input class="form-control form-control-sm cm-name" data-idx="${idx}" value="${row.name}">
        </div>
        <div class="col-2">
          <div class="input-group input-group-sm">
            <input type="number" min="0" step="0.1" class="form-control cm-low" data-idx="${idx}" value="${row.low}">
            <span class="input-group-text">%</span>
          </div>
        </div>
        <div class="col-2">
          <div class="input-group input-group-sm">
            <input type="number" min="0" step="0.1" class="form-control cm-mid" data-idx="${idx}" value="${row.mid}">
            <span class="input-group-text">%</span>
          </div>
        </div>
        <div class="col-2">
          <div class="input-group input-group-sm">
            <input type="number" min="0" step="0.1" class="form-control cm-high" data-idx="${idx}" value="${row.high}">
            <span class="input-group-text">%</span>
          </div>
        </div>
        <div class="col-1 text-end">
          <button class="btn btn-sm btn-outline-danger cm-del" data-idx="${idx}" title="Hapus"><i class="bi bi-x-lg"></i></button>
        </div>
      `;
      wrap.appendChild(div);
    });

    // listeners
    wrap.querySelectorAll('.cm-name').forEach(inp => inp.addEventListener('input', (e) => {
      const i = +e.target.dataset.idx; prefs.categoryMargins[i].name = e.target.value; persist('categoryMargins');
    }));
    wrap.querySelectorAll('.cm-low').forEach(inp => inp.addEventListener('input', (e) => {
      const i = +e.target.dataset.idx; prefs.categoryMargins[i].low = (+e.target.value||0); persist('categoryMargins');
    }));
    wrap.querySelectorAll('.cm-mid').forEach(inp => inp.addEventListener('input', (e) => {
      const i = +e.target.dataset.idx; prefs.categoryMargins[i].mid = (+e.target.value||0); persist('categoryMargins');
    }));
    wrap.querySelectorAll('.cm-high').forEach(inp => inp.addEventListener('input', (e) => {
      const i = +e.target.dataset.idx; prefs.categoryMargins[i].high = (+e.target.value||0); persist('categoryMargins');
    }));
    wrap.querySelectorAll('.cm-del').forEach(btn => btn.addEventListener('click', (e) => {
      const i = +e.currentTarget.dataset.idx;
      prefs.categoryMargins.splice(i, 1);
      persist('categoryMargins', true);
      renderCategoryList();
    }));
  }

  function persist(field, silent=false) {
    savePrefs(prefs);
    window.umkmPrefs = prefs;
    if (!silent) document.dispatchEvent(new CustomEvent('umkm:prefs:changed', { detail: { field, prefs }}));
  }

  // auto apply ketika kategori berubah
  function applyCategoryMarginsToInputs() {
    if (!prefs.autoApplyCategory) return;
    const cat = $('#prodCat')?.value;
    if (!cat) return;
    const tpl = prefs.categoryMargins.find(x => x.name.toLowerCase() === cat.toLowerCase());
    if (!tpl) return;
    const mLow = $('#mLow'), mMid = $('#mMid'), mHigh = $('#mHigh');
    if (mLow) mLow.value = tpl.low;
    if (mMid) mMid.value = tpl.mid;
    if (mHigh) mHigh.value = tpl.high;
    document.dispatchEvent(new Event('umkm:margins:auto-applied'));
  }

  // autosave: kirim event tiap 5 detik (app.js kamu bisa tangkap)
  let autosaveTimer = null;
  function refreshAutosaveTimer() {
    if (autosaveTimer) clearInterval(autosaveTimer);
    if (prefs.autosaveMode === 'on') {
      autosaveTimer = setInterval(() => {
        document.dispatchEvent(new Event('umkm:autosave'));
      }, 5000);
    }
  }

  // listeners UI
  document.addEventListener('DOMContentLoaded', () => {
    applyUI();
    refreshAutosaveTimer();

    $('#numberFormat')?.addEventListener('change', (e) => { prefs.numberFormat = e.target.value; persist('numberFormat'); });
    $('#autosaveMode')?.addEventListener('change', (e) => { prefs.autosaveMode = e.target.value; persist('autosaveMode'); refreshAutosaveTimer(); });
    $('#precision')?.addEventListener('change', (e) => { prefs.precision = +e.target.value || 0; persist('precision'); });
    $('#hppSchema')?.addEventListener('change', (e) => { prefs.hppSchema = e.target.value; persist('hppSchema'); });

    $('#autoApplyCategory')?.addEventListener('change', (e) => {
      prefs.autoApplyCategory = !!e.target.checked; persist('autoApplyCategory');
      if (prefs.autoApplyCategory) applyCategoryMarginsToInputs();
    });

    $('#btnAddCategory')?.addEventListener('click', () => {
      prefs.categoryMargins.push({ name: 'Baru', low: 20, mid: 30, high: 40 });
      persist('categoryMargins', true);
      renderCategoryList();
    });

    $('#btnResetPrefs')?.addEventListener('click', () => {
      if (!confirm('Reset semua preferensi ke bawaan?')) return;
      prefs = { ...defaults };
      savePrefs(prefs);
      window.umkmPrefs = prefs;
      applyUI();
      refreshAutosaveTimer();
      document.dispatchEvent(new CustomEvent('umkm:prefs:changed', { detail: { field: 'reset', prefs }}));
      applyCategoryMarginsToInputs();
    });

    $('#prodCat')?.addEventListener('change', applyCategoryMarginsToInputs);

    // pertama kali, coba terapkan
    applyCategoryMarginsToInputs();
  });

  // helper: format angka bisa dipakai app.js
  window.umkmFormat = function(num) {
    const p = window.umkmPrefs || defaults;
    try {
      return new Intl.NumberFormat(p.numberFormat, { minimumFractionDigits: p.precision, maximumFractionDigits: p.precision }).format(+num || 0);
    } catch {
      return String(num);
    }
  };
})();
