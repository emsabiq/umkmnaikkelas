// checkout.js — umkmall (Snap-first, QR as fallback)
const WORKER_URL =
  (window.UMKM_CONFIG && window.UMKM_CONFIG.WORKER_URL) ||
  window.__WORKER_BASE__ ||
  "https://umkm.msabiq-stan.workers.dev";

const $ = (id)=>document.getElementById(id);
const qs = new URLSearchParams(location.search);

function setStatus(text, cls){
  const el = $('status');
  if (!el) return;
  el.textContent = text;
  el.className = 'badge ' + (cls || 'text-bg-secondary');
}
function showAlert(type, msg){
  const a = $('alert');
  if (!a) return;
  a.className = 'alert alert-' + type;
  a.textContent = msg;
  a.classList.remove('d-none');
}

async function api(path, payload){
  const r = await fetch(WORKER_URL + path, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body: JSON.stringify(payload || {})
  });
  let j; try{ j = await r.json(); }catch{ j = {}; }
  if (!r.ok || j.ok === false) throw new Error(j.error || 'Request gagal');
  return j;
}
const createOrder  = (name, contact)=> api('/create-order',   { service_id:'umkm_basic', customer:{ name, contact } });
const checkStatus  = (order_id)=>     api('/status-check',     { order_id });
const orderClaim   = (order_id,contact)=> api('/?route=order-claim', { order_id, contact });
const userLogin    = (u,p)=>          api('/?route=user-login',{ username:u, password:p });

let currentOrderId = '';
let pollTimer = null;
let opened = null;

function startPolling(){
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async ()=>{
    try{
      const st = await checkStatus(currentOrderId);
      const s = String(st.transaction_status || 'unknown').toLowerCase();
      const f = String(st.fraud_status || '').toLowerCase();
      setStatus(s, (s==='settlement'||(s==='capture'&&f!=='challenge')||s==='success') ? 'text-bg-success':'text-bg-secondary');
      if (s==='settlement' || s==='success' || (s==='capture' && f!=='challenge')) {
        clearInterval(pollTimer);
        await afterPaid();
      } else if (s==='expire') {
        clearInterval(pollTimer);
        showAlert('warning','QR/Transaksi kedaluwarsa. Silakan buat order lagi.');
      }
    }catch(e){ /* diamkan agar polling lanjut */ }
  }, 4000);
}

async function afterPaid(){
  try{
    const contact = $('contact')?.value?.trim() || '';
    const claim = await orderClaim(currentOrderId, contact);
    $('uOut').textContent = claim.username || '(tersimpan)';
    $('pOut').textContent = claim.password || '(tersimpan)';
    $('credBox').classList.remove('d-none');

    // auto-login & redirect ke kalkulator
    const login = await userLogin(claim.username, claim.password);
    if (login.ok && login.token){
      localStorage.setItem('umkm_token', login.token);
      showAlert('success','Pembayaran sukses & login berhasil. Mengarahkan ke kalkulator…');
      setTimeout(()=>location.href='./index.html', 1200);
    } else {
      showAlert('warning','Akun dibuat. Silakan login manual.');
    }
  }catch(e){
    showAlert('danger', e.message || String(e));
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  // Prefill
  try{
    const pre = JSON.parse(localStorage.getItem('umkm_prefill')||'{}');
    if ($('name'))    $('name').value    = qs.get('name')    || pre.name    || '';
    if ($('contact')) $('contact').value = qs.get('contact') || pre.contact || '';
  }catch(_){}

  // Submit bayar
  $('form')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    $('alert')?.classList.add('d-none');
    const name = $('name').value.trim();
    const contact = $('contact').value.trim();
    if (!name || !contact) return;

    $('btnPay').disabled = true;
    try{
      opened = window.open('about:blank', '_blank'); // lolos popup blocker
      const o = await createOrder(name, contact);
      currentOrderId = o.order_id;
      $('orderId').textContent = currentOrderId;
      $('orderBox').classList.remove('d-none');
      $('btnStatus').disabled = false;

      // Prioritas: SNAP redirect (semua metode pembayaran)
      if (o.redirect_url){
        setStatus('menunggu pembayaran', 'text-bg-secondary');
        if (opened) opened.location.href = o.redirect_url;
        else window.open(o.redirect_url, '_blank');
      } else {
        // Fallback: QR (jika tersedia)
        const act = (o.actions||[]).find(a=>a.name==='generate-qr-code-v2') || (o.actions||[]).find(a=>a.name==='generate-qr-code');
        if (act) {
          setStatus('scan QR untuk bayar', 'text-bg-secondary');
          const box = document.createElement('div');
          box.className = 'mt-3';
          box.innerHTML = `<img alt="QRIS" style="max-width:100%;height:auto" src="${act.url}">`;
          $('orderBox').appendChild(box);
        } else {
          setStatus('menunggu…', 'text-bg-secondary');
        }
      }
      startPolling();
    }catch(err){
      showAlert('danger', err.message || String(err));
      if (opened) try{ opened.close(); }catch(_){}
    }finally{
      $('btnPay').disabled = false;
    }
  });

  // Datang dari redirect Snap (finish URL)
  (async ()=>{
    const qOrder = qs.get('order_id');
    if (qOrder){
      currentOrderId = qOrder;
      $('orderId').textContent = currentOrderId;
      $('orderBox').classList.remove('d-none');

      const s = (qs.get('transaction_status')||'').toLowerCase();
      if (s==='settlement' || s==='success' || (s==='capture' && (qs.get('fraud_status')||'')!=='challenge')){
        setStatus('settlement', 'text-bg-success');
        await afterPaid();
      } else {
        setStatus('memeriksa…', 'text-bg-secondary');
        startPolling();
      }
    }
  })();

  // Cek status manual
  $('btnStatus')?.addEventListener('click', async ()=>{
    if (!currentOrderId) return;
    try{
      const st = await checkStatus(currentOrderId);
      const s = String(st.transaction_status || 'unknown').toLowerCase();
      const f = String(st.fraud_status || '').toLowerCase();
      setStatus(s, (s==='settlement'||(s==='capture'&&f!=='challenge')||s==='success') ? 'text-bg-success':'text-bg-secondary');
      if (s==='settlement' || s==='success' || (s==='capture' && f!=='challenge')){
        await afterPaid();
      }
    }catch(e){ showAlert('danger', String(e)); }
  });
});
