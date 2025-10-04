/* ============================================================
   app.js – Kalkulator HPP & Harga Jual (Bootstrap 5 + Chart.js)
   Fitur: BOM, susut, tenaga kerja, overhead, PPN, kemasan,
          3 tier harga + margin/profit, alokasi biaya tetap,
          target laba → target jual/hari & omzet/bln,
          grafik prediksi (bar+line) & grafik harian (3 skenario),
          simpan/muat (localStorage), impor/ekspor JSON, autosave.
   Terintegrasi dengan prefs.js jika ada (umkmPrefs & events).
   ============================================================ */
(() => {
  // ---------- Helpers ----------
  const $  = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const toNum = (v) => {
    const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const clamp = (n, a, b) => Math.min(Math.max(n, a), b);

  // Aman untuk rgba
  function hexToRgba(hex, alpha = 1) {
    const h = hex.replace('#','').padEnd(6,'0');
    const r = parseInt(h.substring(0,2), 16);
    const g = parseInt(h.substring(2,4), 16);
    const b = parseInt(h.substring(4,6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Toast (Bootstrap)
  function ensureToastArea(){
    if (!$('#toastArea')) {
      const div=document.createElement('div');
      div.id='toastArea';
      div.className='toast-container position-fixed bottom-0 end-0 p-3';
      document.body.appendChild(div);
    }
  }
  function showToast(message, variant = 'primary', delay = 2200) {
    ensureToastArea();
    const wrap = document.createElement('div');
    wrap.className = `toast align-items-center text-bg-${variant} border-0`;
    wrap.setAttribute('role','alert');
    wrap.setAttribute('aria-live','assertive');
    wrap.setAttribute('aria-atomic','true');
    wrap.innerHTML = `<div class="d-flex">
      <div class="toast-body">${message}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>`;
    $('#toastArea').appendChild(wrap);
    const t = new bootstrap.Toast(wrap, { delay });
    t.show();
    wrap.addEventListener('hidden.bs.toast', () => wrap.remove());
  }

  
  // ---------- Storage ----------
  const KEYS = { RECIPES: 'hpp_recipes_v2', PREFS: 'hpp_prefs_v2' };

  // ---------- Defaults ----------
  const defaultPrefs = () => ({
    numberFormat: 'id-ID',
    autosaveMode: 'off',
    hppSchema: 'default',
    precision: 2,
    autoApplyCategory: true,
    categoryMargins: [
      { name: 'F&B',     low: 20, mid: 35, high: 50 },
      { name: 'Sandang', low: 25, mid: 40, high: 55 }
    ],
    baseDemand: 100,
    elasticityPctPer10: 15,
  });

  const defaultRecipe = () => ({
    prodName: '',
    prodCat: 'F&B',
    mode: 'byTarget', // 'byTarget' | 'perUnit'
    yield: 10,
    packCost: 0,
    shrink: 0,
    overheadPct: 10,
    taxPct: 0,
    laborMode: 'fixed',
    laborA: 0,
    laborB: 0,
    margins: { low: 20, mid: 35, high: 50 },
    rounding: '100',
    bom: [],   // {name, qty, unit, unitCost, category}
    fixed: [], // {name, monthly}
    targetSalesMonthly: 0,
    targetProfitMonthly: 0,
    imgDataUrl: ''
  });

  // Runtime
  let prefs  = loadPrefs();
  let recipe = defaultRecipe();
  let autosaveTimer = null;

  // Charts
  let profitChart = null; // bar + line
  let dailyChart  = null; // 3 lines
  let resizeBound = false;

  // ---------- Prefs Loader ----------
  function loadPrefs(){
    // Jika prefs.js ada, utamakan window.umkmPrefs
    if (window.umkmPrefs) {
      return Object.assign(defaultPrefs(), window.umkmPrefs);
    }
    try { return Object.assign(defaultPrefs(), JSON.parse(localStorage.getItem(KEYS.PREFS) || '{}')); }
    catch { return defaultPrefs(); }
  }
  function savePrefs(){
    // Simpan lokal juga (biar standalone tanpa prefs.js pun tetap jalan)
    localStorage.setItem(KEYS.PREFS, JSON.stringify(prefs));
  }

  // ---------- Format ----------
  function fmtMoney(n) {
    // Jika prefs.js menyediakan formatter, pakai
    if (typeof window.umkmFormat === 'function') {
      return 'Rp ' + window.umkmFormat(n);
    }
    const loc = prefs.numberFormat || 'id-ID';
    const f = new Intl.NumberFormat(loc, {
      style: 'currency', currency: 'IDR',
      minimumFractionDigits: prefs.precision,
      maximumFractionDigits: prefs.precision
    });
    const p = 10 ** prefs.precision;
    return f.format(Math.round((+n || 0) * p) / p);
  }

  // ---------- Recipes DB ----------
  function loadRecipesDB(){
    try { return JSON.parse(localStorage.getItem(KEYS.RECIPES) || '{}'); }
    catch { return {}; }
  }
  function saveRecipesDB(db){ localStorage.setItem(KEYS.RECIPES, JSON.stringify(db)); }

  function refreshSavedSelect(){
    const db = loadRecipesDB();
    const sel = $('#savedSelect'); if (!sel) return;
    sel.innerHTML = ['<option value="">— Resep Tersimpan —</option>']
      .concat(Object.keys(db).sort().map(k=>`<option value="${k}">${k}</option>`))
      .join('');
  }

  const serializeRecipe   = () => JSON.parse(JSON.stringify(recipe));
  const deserializeRecipe = (data) => recipe = Object.assign(defaultRecipe(), data || {});

  // ---------- Prefs UI (opsional, jika elemen ada) ----------
  function bindPrefsUI(){
    const nf = $('#numberFormat');         if (nf) nf.value = prefs.numberFormat;
    const as = $('#autosaveMode');         if (as) as.value = prefs.autosaveMode;
    const hs = $('#hppSchema');            if (hs) hs.value = prefs.hppSchema;
    const pr = $('#precision');            if (pr) pr.value = String(prefs.precision);
    const aa = $('#autoApplyCategory');    if (aa) aa.checked = !!prefs.autoApplyCategory;

    const bd = $('#baseDemand');           if (bd) bd.value = prefs.baseDemand;
    const el = $('#elasticity');           if (el) el.value = prefs.elasticityPctPer10;

    // Area template kategori (jika tersedia di offcanvas index.html)
    const area = $('#categoryMarginArea');
    if (area){
      area.innerHTML = '';
      prefs.categoryMargins.forEach((row, idx)=>{
        const div = document.createElement('div');
        div.className='row g-2 align-items-end';
        div.innerHTML = `
          <div class="col-12 col-sm-4">
            <label class="form-label small">Kategori</label>
            <input class="form-control form-control-sm cm-name" data-idx="${idx}" value="${row.name}"/>
          </div>
          <div class="col-4 col-sm-2">
            <label class="form-label small">Low %</label>
            <input type="number" class="form-control form-control-sm cm-low" data-idx="${idx}" value="${row.low}" step="0.1" min="0"/>
          </div>
          <div class="col-4 col-sm-2">
            <label class="form-label small">Mid %</label>
            <input type="number" class="form-control form-control-sm cm-mid" data-idx="${idx}" value="${row.mid}" step="0.1" min="0"/>
          </div>
          <div class="col-4 col-sm-2">
            <label class="form-label small">High %</label>
            <input type="number" class="form-control form-control-sm cm-high" data-idx="${idx}" value="${row.high}" step="0.1" min="0"/>
          </div>
          <div class="col-12 col-sm-2 text-end">
            <button class="btn btn-sm btn-outline-danger cm-del" data-idx="${idx}">
              <i class="bi bi-trash"></i>
            </button>
          </div>`;
        area.appendChild(div);
      });

      area.oninput = (e)=>{
        const idx = +e.target.getAttribute('data-idx');
        if (Number.isNaN(idx)) return;
        const row = prefs.categoryMargins[idx]; if (!row) return;
        if (e.target.classList.contains('cm-name')) row.name = e.target.value;
        if (e.target.classList.contains('cm-low'))  row.low  = toNum(e.target.value);
        if (e.target.classList.contains('cm-mid'))  row.mid  = toNum(e.target.value);
        if (e.target.classList.contains('cm-high')) row.high = toNum(e.target.value);
        savePrefs(); renderBOM();
      };
      area.onclick = (e)=>{
        const del=e.target.closest?.('.cm-del');
        if (del){
          const idx=+del.getAttribute('data-idx');
          prefs.categoryMargins.splice(idx,1);
          savePrefs(); bindPrefsUI();
        }
      };
    }

    const addBtn = $('#btnAddCategory');
    if (addBtn && !addBtn._bound){
      addBtn._bound = true;
      addBtn.onclick = ()=>{
        prefs.categoryMargins.push({name:'Kategori Baru',low:20,mid:35,high:50});
        savePrefs(); bindPrefsUI();
      };
    }

    if (nf && !nf._bound){ nf._bound=true; nf.onchange = ()=>{ prefs.numberFormat=nf.value; savePrefs(); renderAll(); }; }
    if (as && !as._bound){ as._bound=true; as.onchange = ()=>{ prefs.autosaveMode=as.value; savePrefs(); setupAutosave(); }; }
    if (hs && !hs._bound){ hs._bound=true; hs.onchange = ()=>{ prefs.hppSchema=hs.value; savePrefs(); renderAll(); }; }
    if (pr && !pr._bound){ pr._bound=true; pr.onchange = ()=>{ prefs.precision=toNum(pr.value); savePrefs(); renderAll(); }; }

    if (aa && !aa._bound){ aa._bound=true; aa.onchange = ()=>{ prefs.autoApplyCategory=aa.checked; savePrefs(); }; }
    if (bd && !bd._bound){ bd._bound=true; bd.oninput = ()=>{ prefs.baseDemand=toNum(bd.value); savePrefs(); updateChartsOnly(); }; }
    if (el && !el._bound){ el._bound=true; el.oninput = ()=>{ prefs.elasticityPctPer10=toNum(el.value); savePrefs(); updateChartsOnly(); }; }

    const resetBtn = $('#btnResetPrefs');
    if (resetBtn && !resetBtn._bound){
      resetBtn._bound = true;
      resetBtn.onclick = ()=>{
        if(!confirm('Reset semua preferensi ke bawaan?')) return;
        prefs = defaultPrefs(); savePrefs(); bindPrefsUI(); renderAll();
        showToast('Preferensi direset','warning');
      };
    }
  }

  // ---------- Recipe UI ----------
  function bindRecipeForm(){
    const nameEl = $('#prodName'); if (nameEl) nameEl.value = recipe.prodName;
    const catEl  = $('#prodCat');  if (catEl)  catEl.value  = recipe.prodCat;

    const imgPrev = $('#imgPreview');
    if (imgPrev){
      if (recipe.imgDataUrl){
        imgPrev.src = recipe.imgDataUrl;
        imgPrev.classList.remove('d-none');
      } else {
        imgPrev.classList.add('d-none');
        imgPrev.removeAttribute('src');
      }
    }

    const setVal = (id, v)=>{ const el=$('#'+id); if (el) el.value = v; };
    setVal('yield', recipe.yield);
    setVal('packCost', recipe.packCost);
    setVal('shrink', recipe.shrink);
    setVal('overheadPct', recipe.overheadPct);
    setVal('taxPct', recipe.taxPct);
    setVal('laborMode', recipe.laborMode);
    setVal('laborA', recipe.laborA);
    setVal('laborB', recipe.laborB);
    setVal('mLow', recipe.margins.low);
    setVal('mMid', recipe.margins.mid);
    setVal('mHigh', recipe.margins.high);
    setVal('rounding', recipe.rounding);
    setVal('targetSalesMonthly', recipe.targetSalesMonthly);
    setVal('targetProfitMonthly', recipe.targetProfitMonthly);

    updateLaborLabels();
    renderBOM(); renderFixed(); renderAll();
  }

  function wireImage(){
    const inp = $('#prodImg'); if (!inp) return;
    inp.onchange = () => {
      const f = inp.files?.[0]; if (!f) return;
      const r=new FileReader();
      r.onload = ev => {
        recipe.imgDataUrl = ev.target.result;
        const img=$('#imgPreview');
        if (img){ img.src=recipe.imgDataUrl; img.classList.remove('d-none'); }
        autosaveNow();
        showToast('Gambar dimuat','secondary');
      };
      r.readAsDataURL(f);
    };
  }

  function wireModes(){
    const byTarget = $('#modeByTarget');
    const perUnit  = $('#modePerUnit');

    if (byTarget && !byTarget._bound){
      byTarget._bound = true;
      byTarget.onclick = ()=>{
        recipe.mode='byTarget';
        byTarget.classList.add('active');
        perUnit?.classList.remove('active');
        showToast('Mode: Target Produksi (BOM per batch)','secondary');
        renderAll();
      };
    }
    if (perUnit && !perUnit._bound){
      perUnit._bound = true;
      perUnit.onclick = ()=>{
        recipe.mode='perUnit';
        perUnit.classList.add('active');
        byTarget?.classList.remove('active');
        showToast('Mode: Biaya per Satuan (BOM per unit)','secondary');
        renderAll();
      };
    }
    if (recipe.mode==='perUnit') perUnit?.click();
  }

  function updateLaborLabels(){
    const modeEl = $('#laborMode'); if (!modeEl) return;
    const mode = modeEl.value;
    const la = $('#laborLabelA');
    const lb = $('#laborLabelB');
    const lbInput = $('#laborB');

    if (mode === 'fixed'){
      if (la) la.textContent = 'Biaya/batch';
      if (lb) lb.textContent = 'Jam/batch';
      if (lbInput){ lbInput.disabled = true; if (!lbInput.value) lbInput.value = 0; }
    } else {
      if (la) la.textContent = 'Tarif/jam';
      if (lb) lb.textContent = 'Jam/batch';
      if (lbInput) lbInput.disabled = false;
    }
  }

  // ---------- BOM ----------
  function addRow(seed){
    recipe.bom.push(Object.assign(
      {name:'', qty:0, unit:'', unitCost:0, category:''}, seed||{}
    ));
    renderBOM(); renderAll();
  }
  function bomSubtotal(row){ return toNum(row.qty) * toNum(row.unitCost); }

  function renderBOM(){
    const body = $('#bomBody'); if (!body) return;
    body.innerHTML='';

    const catOptions = ['<option value="">— Kategori —</option>']
      .concat(prefs.categoryMargins.map(c=>`<option value="${c.name}">${c.name}</option>`))
      .join('');

    recipe.bom.forEach((r, idx)=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <input class="form-control form-control-sm bom-name" data-idx="${idx}" placeholder="Contoh: Tepung terigu" value="${r.name||''}" />
          <div class="small text-muted mt-1">
            <i class="bi bi-tags"></i> Kategori:
            <select class="form-select form-select-sm d-inline-block w-auto bom-cat" data-idx="${idx}">${catOptions}</select>
          </div>
        </td>
        <td><input type="number" min="0" step="0.0001" class="form-control form-control-sm bom-qty"  data-idx="${idx}" value="${r.qty||0}" /></td>
        <td><input class="form-control form-control-sm bom-unit" data-idx="${idx}" placeholder="kg/ml/pcs" value="${r.unit||''}" /></td>
        <td>
          <div class="input-group input-group-sm">
            <span class="input-group-text">Rp</span>
            <input type="number" min="0" step="0.01" class="form-control form-control-sm bom-cost" data-idx="${idx}" value="${r.unitCost||0}" />
          </div>
        </td>
        <td class="text-nowrap subtotal">${fmtMoney(bomSubtotal(r))}</td>
        <td class="text-end"><button class="btn btn-sm btn-outline-danger bom-del" data-idx="${idx}"><i class="bi bi-x-lg"></i></button></td>`;
      body.appendChild(tr);
      tr.querySelector('.bom-cat').value = r.category || '';
    });

    const matRaw = recipe.bom.reduce((a,x)=>a + bomSubtotal(x), 0);
    const badge = $('#matBadge');      if (badge) badge.textContent = `${recipe.bom.length} bahan`;
    const matTot = $('#matTotalBadge');if (matTot) matTot.textContent = `Total bahan: ${fmtMoney(matRaw)}`;

    body.oninput = (e)=>{
      const idx = +e.target.getAttribute('data-idx');
      if (Number.isNaN(idx)) return;
      const row=recipe.bom[idx]; if(!row) return;

      if (e.target.classList.contains('bom-name')) row.name = e.target.value;
      if (e.target.classList.contains('bom-qty'))  row.qty  = toNum(e.target.value);
      if (e.target.classList.contains('bom-unit')) row.unit = e.target.value;
      if (e.target.classList.contains('bom-cost')) row.unitCost = toNum(e.target.value);
      if (e.target.classList.contains('bom-cat')){
        row.category = e.target.value;
        if (prefs.autoApplyCategory && row.category){
          const tpl = prefs.categoryMargins.find(c=>c.name.toLowerCase()===row.category.toLowerCase());
          if (tpl){
            recipe.margins.low  = toNum(tpl.low);
            recipe.margins.mid  = toNum(tpl.mid);
            recipe.margins.high = toNum(tpl.high);
            const mLow = $('#mLow'), mMid=$('#mMid'), mHigh=$('#mHigh');
            if (mLow)  mLow.value  = recipe.margins.low;
            if (mMid)  mMid.value  = recipe.margins.mid;
            if (mHigh) mHigh.value = recipe.margins.high;
            showToast(`Margin mengikuti kategori "${row.category}"`,'info');
          }
        }
      }
      const cell = e.target.closest('tr')?.querySelector('.subtotal');
      if (cell) cell.textContent = fmtMoney(bomSubtotal(row));
      renderAll();
    };
    body.onclick = (e)=>{
      const del=e.target.closest('.bom-del');
      if(del){
        const idx=+del.getAttribute('data-idx');
        recipe.bom.splice(idx,1); renderBOM(); renderAll();
      }
    };

    // Tombol pada header kartu BOM
    const addRowBtn = $('#addRow');
    const addCommonBtn = $('#addCommon');
    const clearBtn = $('#clearBom');

    if (addRowBtn && !addRowBtn._bound){ addRowBtn._bound = true; addRowBtn.onclick = ()=> addRow(); }
    if (addCommonBtn && !addCommonBtn._bound){
      addCommonBtn._bound = true;
      addCommonBtn.onclick = ()=>{
        [
          { name:'Tepung terigu', qty:1,   unit:'kg',  unitCost:11000, category:'F&B' },
          { name:'Gula',          qty:0.2, unit:'kg',  unitCost:14000, category:'F&B' },
          { name:'Minyak goreng', qty:0.1, unit:'L',   unitCost:16000, category:'F&B' },
          { name:'Kemasan',       qty:1,   unit:'pcs', unitCost:800,   category:'F&B' }
        ].forEach(seed=>addRow(seed));
      };
    }
    if (clearBtn && !clearBtn._bound){
      clearBtn._bound = true;
      clearBtn.onclick = ()=>{
        if(confirm('Bersihkan semua bahan?')){
          recipe.bom=[]; renderBOM(); renderAll();
        }
      };
    }
  }

  // ---------- Biaya Tetap ----------
  function addFixedRow(seed){
    recipe.fixed.push(Object.assign({name:'', monthly:0}, seed||{}));
    renderFixed(); renderAll();
  }

  function renderFixed(){
    const body = $('#fixedBody'); if (!body) return;
    body.innerHTML='';

    recipe.fixed.forEach((r, idx)=>{
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td><input class="form-control form-control-sm fx-name" data-idx="${idx}" placeholder="Contoh: Sewa toko" value="${r.name||''}" /></td>
        <td>
          <div class="input-group input-group-sm">
            <span class="input-group-text">Rp</span>
            <input type="number" min="0" step="1000" class="form-control form-control-sm fx-monthly" data-idx="${idx}" value="${r.monthly||0}" />
          </div>
        </td>
        <td class="text-end"><button class="btn btn-sm btn-outline-danger fx-del" data-idx="${idx}"><i class="bi bi-x-lg"></i></button></td>`;
      body.appendChild(tr);
    });

    body.oninput = (e)=>{
      const idx = +e.target.getAttribute('data-idx');
      if (Number.isNaN(idx)) return;
      const row=recipe.fixed[idx]; if(!row) return;
      if (e.target.classList.contains('fx-name'))    row.name    = e.target.value;
      if (e.target.classList.contains('fx-monthly')) row.monthly = toNum(e.target.value);
      renderAll();
    };
    body.onclick = (e)=>{
      const del=e.target.closest('.fx-del');
      if(del){
        const idx=+del.getAttribute('data-idx');
        recipe.fixed.splice(idx,1); renderFixed(); renderAll();
      }
    };

    const addFixedBtn = $('#addFixed');
    if (addFixedBtn && !addFixedBtn._bound){
      addFixedBtn._bound = true;
      addFixedBtn.onclick = ()=> addFixedRow({name:'Biaya tetap', monthly:0});
    }
  }

  // ---------- HPP & Pricing ----------
  function materialsCost(){
    const sum = recipe.bom.reduce((a,r)=> a + toNum(r.qty)*toNum(r.unitCost), 0);
    if (recipe.mode==='perUnit'){
      const perUnitRaw = sum;
      const perBatchRaw = perUnitRaw * Math.max(1,toNum(recipe.yield));
      const shrink = clamp(toNum(recipe.shrink)/100, 0, .95);
      const adjBatch = perBatchRaw / (1 - shrink);
      return { perUnitRaw, raw: perBatchRaw, adj: adjBatch };
    } else {
      const shrink = clamp(toNum(recipe.shrink)/100, 0, .95);
      const adj = sum / (1 - shrink);
      return { perUnitRaw: sum/Math.max(1,toNum(recipe.yield)), raw: sum, adj };
    }
  }
  function laborCost(){
    return recipe.laborMode==='fixed'
      ? toNum(recipe.laborA)
      : toNum(recipe.laborA) * toNum(recipe.laborB);
  }
  function overhead(base){ return base * (toNum(recipe.overheadPct)/100); }
  function tax(base){      return base * (toNum(recipe.taxPct)/100); }

  function computeHPP(){
    const y = Math.max(1, toNum(recipe.yield));
    const mat   = materialsCost();
    const labor = laborCost();
    const packTotal = toNum(recipe.packCost) * y; // kemasan per unit
    let ohBase = mat.adj + labor;
    if (prefs.hppSchema==='oh_on_all') ohBase += packTotal;
    const oh = overhead(ohBase);
    let subtotal = mat.adj + labor + packTotal + oh;
    const vat  = tax(subtotal);
    const batch = subtotal + vat;
    let unit = batch / y;

    // alokasi biaya tetap/unit
    const fixedMonthly = recipe.fixed.reduce((a,x)=>a + toNum(x.monthly), 0);
    const targetSalesMonthly = Math.max(0, toNum(recipe.targetSalesMonthly));
    const fixedPerUnit = targetSalesMonthly>0 ? fixedMonthly / targetSalesMonthly : 0;
    unit += fixedPerUnit;
    const batchPlus = unit * y;

    return {
      mat: mat.adj, matRaw: mat.raw, labor,
      packTotal, oh, vat,
      batch: batchPlus, unit,
      fixedMonthly, fixedPerUnit
    };
  }

  function roundPrice(v){
    const r = recipe.rounding;
    if (r==='1') return Math.round(v);
    if (r==='up1000') return Math.ceil(v/1000)*1000;
    const step = parseInt(r,10)||1;
    return Math.round(v/step)*step;
  }
  const priceFromMargin = (costUnit, m) => roundPrice(costUnit * (1 + (toNum(m)/100)));
  function marginFromPrice(costUnit, price){
    if (price<=0) return {marginPct:0, profit:0};
    const profit = price - costUnit;
    const marginPct = (profit/price)*100;
    return { marginPct, profit };
  }

  // ---------- Charts ----------
  function setChartHeight(){
    const wraps = $$('.chart-wrap');
    wraps.forEach(wrap=>{
      const w = window.innerWidth;
      let h = 280; if (w < 992) h = 260; if (w < 576) h = 220;
      wrap.style.height = h + 'px';
    });
  }

  function bindResizeOnce(){
    if (resizeBound) return;
    resizeBound = true;
    window.addEventListener('resize', ()=>{
      setChartHeight();
      profitChart?.resize();
      dailyChart?.resize();
    });
  }

  function initTierChart(){
    const canvas = $('#chartProfit'); if (!canvas || typeof Chart==='undefined') return;
    setChartHeight(); bindResizeOnce();

    const brand    = '#356f6b';
    const brandLine= '#0ea5a7';

    if (profitChart && typeof profitChart.destroy==='function') {
      profitChart.destroy();
    }

    const ctx = canvas.getContext('2d');
    profitChart = new Chart(ctx, {
      type:'bar',
      data:{
        labels:['Kompetitif','Standar','Premium'],
        datasets:[
          {
            label:'Profit/bln (Rp)',
            data:[0,0,0],
            yAxisID:'yProfit',
            backgroundColor: hexToRgba(brand, 0.35),
            borderColor: brand,
            borderWidth:1,
            borderRadius:6
          },
          {
            label:'Unit/bln (prediksi)',
            data:[0,0,0],
            type:'line',
            yAxisID:'yUnits',
            tension:.35,
            pointRadius:3,
            borderWidth:2,
            borderColor: brandLine,
            backgroundColor: hexToRgba(brandLine, 0.25)
          }
        ]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        scales:{
          yProfit:{
            position:'left',
            title:{display:true,text:'Profit/bln (Rp)'},
            ticks:{ callback:v=>fmtMoney(v).replace('Rp','Rp ') }
          },
          yUnits:{
            position:'right',
            grid:{drawOnChartArea:false},
            title:{display:true,text:'Unit/bln'},
            ticks:{ precision:0 }
          }
        },
        plugins:{
          legend:{ position:'bottom' },
          tooltip:{
            callbacks:{
              label:(ctx)=> ctx.dataset.yAxisID==='yUnits'
                ? `Unit: ${ctx.parsed.y}`
                : `Profit: ${fmtMoney(ctx.parsed.y)}`
            }
          }
        }
      }
    });
  }

  function initDailyChart(){
    const canvas = $('#chartDaily'); if(!canvas || typeof Chart==='undefined') return;
    setChartHeight(); bindResizeOnce();
    if (dailyChart && typeof dailyChart.destroy==='function') dailyChart.destroy();

    const ctx = canvas.getContext('2d');
    dailyChart = new Chart(ctx, {
      type:'line',
      data:{
        labels: Array.from({length:30},(_,i)=>`Hari ${i+1}`),
        datasets:[
          { label:'Rame',   data:Array(30).fill(0), borderWidth:2 },
          { label:'Target', data:Array(30).fill(0), borderWidth:2 },
          { label:'Sepi',   data:Array(30).fill(0), borderWidth:2 }
        ]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index', intersect:false},
        plugins:{
          legend:{position:'bottom'},
          tooltip:{
            callbacks:{
              title:(items)=> `Hari ke-${items[0].dataIndex+1}`,
              label:(ctx)=> `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y)}`
            }
          }
        },
        scales:{ y:{ ticks:{ callback:v=>fmtMoney(v).replace('Rp','Rp ') } } }
      }
    });
  }

  function predictDemand(price, pLow){
    if (pLow<=0) return prefs.baseDemand;
    const delta=((price-pLow)/pLow)*100;
    const drop=(prefs.elasticityPctPer10/10)*delta;
    return Math.max(0, Math.round(prefs.baseDemand*(1-drop/100)));
  }

  function updateChartsOnly(){
    const res  = computeHPP();
    const pLow = priceFromMargin(res.unit, recipe.margins.low);
    const pMid = priceFromMargin(res.unit, recipe.margins.mid);
    const pHigh= priceFromMargin(res.unit, recipe.margins.high);
    updateTierChart(res.unit, {low:pLow, mid:pMid, high:pHigh});
    updateDailyChart(res.unit, pMid);
  }

  function updateTierChart(costUnit, prices){
    if(!profitChart) initTierChart();
    if(!profitChart) return;
    const pLow=prices.low, pMid=prices.mid, pHigh=prices.high;
    const uLow = predictDemand(pLow,pLow);
    const uMid = predictDemand(pMid,pLow);
    const uHigh= predictDemand(pHigh,pLow);
    const prLow = (pLow -costUnit)*uLow;
    const prMid = (pMid -costUnit)*uMid;
    const prHigh= (pHigh-costUnit)*uHigh;
    profitChart.data.datasets[0].data=[prLow,prMid,prHigh];
    profitChart.data.datasets[1].data=[uLow,uMid,uHigh];
    profitChart.update();
  }

  function updateDailyChart(costUnit, priceStd){
    if(!dailyChart) initDailyChart();
    if(!dailyChart) return;

    const unitProfit = Math.max(0, priceStd - costUnit);
    const baseUnitsPerDay = Math.max(0, toNum(recipe.targetSalesMonthly)) / 30;

    const makeCumulative = (factor) => {
      const series = [];
      let acc = 0;
      const dailyUnits = baseUnitsPerDay * factor;
      const dailyProfit = unitProfit * dailyUnits;
      for (let d = 1; d <= 30; d++){
        acc += dailyProfit;
        series.push(acc);
      }
      return series;
    };

    dailyChart.data.datasets[0].data = makeCumulative(1.4); // Rame
    dailyChart.data.datasets[1].data = makeCumulative(1.0); // Target
    dailyChart.data.datasets[2].data = makeCumulative(0.6); // Sepi
    dailyChart.update();
  }

  // ---------- Render ----------
  function pullInputs(){
    const getVal = (id) => $('#'+id)?.value;

    recipe.prodName = getVal('prodName') ?? recipe.prodName;
    recipe.prodCat  = getVal('prodCat')  ?? recipe.prodCat;

    recipe.yield     = toNum(getVal('yield'));
    recipe.packCost  = toNum(getVal('packCost'));
    recipe.shrink    = toNum(getVal('shrink'));
    recipe.overheadPct = toNum(getVal('overheadPct'));
    recipe.taxPct      = toNum(getVal('taxPct'));
    recipe.laborMode   = getVal('laborMode') ?? recipe.laborMode;
    recipe.laborA      = toNum(getVal('laborA'));
    recipe.laborB      = toNum(getVal('laborB'));
    recipe.margins.low = toNum(getVal('mLow'));
    recipe.margins.mid = toNum(getVal('mMid'));
    recipe.margins.high= toNum(getVal('mHigh'));
    recipe.rounding    = getVal('rounding') ?? recipe.rounding;

    recipe.targetSalesMonthly  = toNum(getVal('targetSalesMonthly'));
    recipe.targetProfitMonthly = toNum(getVal('targetProfitMonthly'));
  }

  function renderAll(){
    pullInputs();
    const res = computeHPP();

    // KPI
    const setText = (id, txt)=>{ const el=$('#'+id); if (el) el.textContent = txt; };
    setText('outMat',   fmtMoney(res.mat));
    setText('outLabor', fmtMoney(res.labor));
    setText('outOH',    fmtMoney(res.oh));
    setText('outTax',   fmtMoney(res.vat));
    setText('hppBatch', fmtMoney(res.batch));
    setText('hppUnit',  fmtMoney(res.unit));
    setText('fixedMonthlyTotal', fmtMoney(res.fixedMonthly));
    setText('fixedPerUnit',      fmtMoney(res.fixedPerUnit));

    // 3 tier harga
    const pLow = priceFromMargin(res.unit, recipe.margins.low);
    const pMid = priceFromMargin(res.unit, recipe.margins.mid);
    const pHigh= priceFromMargin(res.unit, recipe.margins.high);
    setText('pLow',  fmtMoney(pLow));
    setText('pMid',  fmtMoney(pMid));
    setText('pHigh', fmtMoney(pHigh));
    const g1=marginFromPrice(res.unit,pLow),
          g2=marginFromPrice(res.unit,pMid),
          g3=marginFromPrice(res.unit,pHigh);
    setText('pfLow',  fmtMoney(g1.profit));
    setText('pfMid',  fmtMoney(g2.profit));
    setText('pfHigh', fmtMoney(g3.profit));
    setText('mgLow',  g1.marginPct.toFixed(1)+'%');
    setText('mgMid',  g2.marginPct.toFixed(1)+'%');
    setText('mgHigh', g3.marginPct.toFixed(1)+'%');

    // Target & Proyeksi (pakai harga standar)
    const unitProfit = Math.max(0, pMid - res.unit);
    const fixedMonthly = res.fixedMonthly;
    const monthlyUnitsNeeded = unitProfit>0
      ? (recipe.targetProfitMonthly + fixedMonthly) / unitProfit
      : 0;
    const perDay = monthlyUnitsNeeded/30;
    const potentialRevenue = pMid * monthlyUnitsNeeded;
    setText('targetPerDay', (perDay||0).toFixed(1) + ' pcs');
    setText('potentialRevenue', fmtMoney(potentialRevenue||0));
    setText('fixedMonthly', fmtMoney(fixedMonthly));

    // Charts
    updateTierChart(res.unit, {low:pLow, mid:pMid, high:pHigh});
    updateDailyChart(res.unit, pMid);

    autosaveNow();
  }

  // ---------- Autosave ----------
  function setupAutosave(){
    if (autosaveTimer){ clearInterval(autosaveTimer); autosaveTimer=null; }
    if (prefs.autosaveMode==='on'){
      autosaveTimer=setInterval(()=>{
        const name=recipe.prodName||'Resep Tanpa Nama';
        const db=loadRecipesDB(); db[name]=serializeRecipe();
        saveRecipesDB(db); refreshSavedSelect();
      }, 5000);
    }
  }
  function autosaveNow(){
    if (prefs.autosaveMode==='on'){
      const db=loadRecipesDB();
      const key=recipe.prodName||'Resep Tanpa Nama';
      db[key]=serializeRecipe(); saveRecipesDB(db); refreshSavedSelect();
    }
  }

  // ---------- Navbar / File IO ----------
  function wireNav(){
    // === Baru: aman tanpa modalNew ===
    const btnNew = $('#btnNew');
    if (btnNew && !btnNew._bound){
      btnNew._bound = true;
      btnNew.onclick = (e)=>{
        e.preventDefault();
        if (!confirm('Buat resep baru? Perubahan yang belum disimpan bisa hilang.')) return;
        recipe=defaultRecipe(); bindRecipeForm();
        showToast('Resep baru dibuat','secondary');
        // Siapkan modal simpan kalau ingin langsung memberi nama
        const saveName = $('#saveName'); if (saveName) saveName.value = '';
        const saveEl = $('#modalSave');
        if (saveEl && window.bootstrap?.Modal){
          bootstrap.Modal.getOrCreateInstance(saveEl, {backdrop:'static'}).show();
        }
      };
    }

    // === Simpan ===
    const btnSave = $('#btnSave');
    if (btnSave && !btnSave._bound){
      btnSave._bound = true;
      btnSave.onclick = ()=>{
        const saveName = $('#saveName'); if (saveName) saveName.value = recipe.prodName || '';
        const el = $('#modalSave');
        if (!el || !window.bootstrap?.Modal) return;
        bootstrap.Modal.getOrCreateInstance(el, {backdrop:'static'}).show();
      };
    }
    const doSave = $('#doSave');
    if (doSave && !doSave._bound){
      doSave._bound = true;
      doSave.onclick = ()=>{
        const name = ($('#saveName')?.value||'').trim();
        if(!name) return showToast('Nama resep wajib diisi','danger');
        recipe.prodName=name; const pn=$('#prodName'); if (pn) pn.value=name;
        const db=loadRecipesDB(); db[name]=serializeRecipe(); saveRecipesDB(db);
        refreshSavedSelect();
        const el = $('#modalSave'); if (el) bootstrap.Modal.getInstance(el)?.hide();
        showToast('Resep tersimpan','success');
      };
    }

    // === Muat ===
    const savedSel = $('#savedSelect');
    if (savedSel && !savedSel._bound){
      savedSel._bound = true;
      savedSel.onchange = (e)=>{
        const key=e.target.value; if(!key) return;
        const db=loadRecipesDB(); if(!db[key]) return;
        deserializeRecipe(db[key]); bindRecipeForm();
        showToast(`Memuat resep "${key}"`,'info');
      };
    }

    // === Ekspor ===
    const btnExport = $('#btnExport');
    if (btnExport && !btnExport._bound){
      btnExport._bound = true;
      btnExport.onclick = ()=>{
        const data=JSON.stringify(serializeRecipe(),null,2);
        const blob=new Blob([data],{type:'application/json'});
        const a=document.createElement('a');
        a.href=URL.createObjectURL(blob);
        a.download=(recipe.prodName||'resep')+'_hpp.json';
        a.click();
        showToast('Ekspor JSON berhasil','success');
      };
    }

    // === Impor ===
    const doImport = $('#doImport');
    if (doImport && !doImport._bound){
      doImport._bound = true;
      doImport.onclick = async ()=>{
        const f=$('#importFile')?.files?.[0];
        if(!f) return showToast('Pilih file JSON dulu','warning');
        try{
          const txt=await f.text();
          const data=JSON.parse(txt);
          deserializeRecipe(data); bindRecipeForm();
          const el = $('#modalImport'); if (el) bootstrap.Modal.getInstance(el)?.hide();
          showToast('Impor sukses','success');
        }catch(e){ showToast('File tidak valid','danger'); }
      };
    }

    // === Cetak ===
    const btnPrint = $('#btnPrint');
    if (btnPrint && !btnPrint._bound){
      btnPrint._bound = true;
      btnPrint.onclick = ()=> window.print();
    }
  }

  // ---------- Wiring Inputs ----------
  function wireInputs(){
    [
      'prodName','prodCat','yield','packCost','shrink',
      'overheadPct','taxPct','laborMode','laborA','laborB',
      'mLow','mMid','mHigh','rounding',
      'targetSalesMonthly','targetProfitMonthly'
    ].forEach(id=>{
      const el=$('#'+id); if(!el) return;
      if (!el._bound){
        el._bound = true;
        const handler = id==='laborMode' ? ()=>{ updateLaborLabels(); renderAll(); }
                                          : ()=> renderAll();
        el.addEventListener('input', handler);
        if (id==='laborMode') el.addEventListener('change', handler);
      }
    });

    wireImage(); wireModes();

    // Tooltips
    $$('.navbar [data-bs-toggle="tooltip"]').forEach(el => {
      if (!el._tooltip){ el._tooltip = new bootstrap.Tooltip(el); }
    });

    // AI Assist (stub)
    const aiBtn = $('#aiAssistBtn');
    if (aiBtn && !aiBtn._bound){
      aiBtn._bound = true;
      aiBtn.onclick = ()=>{
        const y = toNum($('#yield')?.value);
        if (!y || y < 1){
          showToast('Isi hasil/batch minimal 1 dulu ya. 😊','warning');
          $('#yield')?.focus();
          return;
        }
        if (recipe.bom.length === 0){
          showToast('Tambah minimal 1 bahan di BOM supaya analisis bermakna.','warning');
          return;
        }
        const res = computeHPP();
        const pStd = priceFromMargin(res.unit, recipe.margins.mid);
        showToast(`Saran cepat: coba harga standar ${fmtMoney(pStd)} agar margin sehat.`, 'success', 3000);
      };
    }
  }

  // ---------- Integrasi dengan prefs.js ----------
  // Ikuti perubahan preferensi global
  document.addEventListener('umkm:prefs:changed', (e) => {
    // Ambil dari event.detail.prefs atau window.umkmPrefs
    const incoming = e?.detail?.prefs || window.umkmPrefs;
    if (incoming) {
      prefs = Object.assign(defaultPrefs(), incoming);
      savePrefs();
      bindPrefsUI();
      renderAll();
      setupAutosave();
    }
  });
  // Autosave event dari prefs.js
  document.addEventListener('umkm:autosave', () => autosaveNow());
  // Margin auto-applied
  document.addEventListener('umkm:margins:auto-applied', () => renderAll());

  // ---------- Init ----------
  function init(){
    // Sinkron dengan prefs.js jika ada
    if (window.umkmPrefs) prefs = Object.assign(defaultPrefs(), window.umkmPrefs);

    refreshSavedSelect();
    bindPrefsUI();
    bindRecipeForm();
    wireNav();
    wireInputs();
    setupAutosave();
    initTierChart();
    initDailyChart();
    if (recipe.bom.length===0) addRow();
    setChartHeight();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
