// gate.js — umkmall access guard (FAST, production-ready)
const GATE_CONFIG = {
  SERVICE_REQUIRED: (window.UMKM_CONFIG && window.UMKM_CONFIG.SERVICE_REQUIRED) || 'umkm_basic',
  DEV_DEFAULT_USER: (window.UMKM_CONFIG && window.UMKM_CONFIG.DEV_DEFAULT_USER) || { u: 'user1', p: 'User@123' },
  TIMEOUT_MS: 3000,
  LOGIN_PAGE: (window.UMKM_CONFIG && window.UMKM_CONFIG.PAGES && window.UMKM_CONFIG.PAGES.login) || './login.html',
  PAY_PAGE:   (window.UMKM_CONFIG && window.UMKM_CONFIG.PAGES && window.UMKM_CONFIG.PAGES.pay)   || './pay.html'
};

const WORKER_URL =
  (window.UMKM_CONFIG && window.UMKM_CONFIG.WORKER_URL) ||
  window.__WORKER_BASE__ ||
  'https://umkm.msabiq-stan.workers.dev';

// ---------- utils ----------
const $html = document.documentElement;
function unlock(){
  const s = document.getElementById('gate-hide');
  if (s) s.remove();
  $html.style.visibility = 'visible';
}
function isLocalDev(){
  const h = location.hostname;
  return !h || h === 'localhost' || h === '127.0.0.1' || location.protocol === 'file:';
}
function getToken(){ try{ return localStorage.getItem('umkm_token')||''; }catch{ return ''; } }
function setToken(t){ try{ localStorage.setItem('umkm_token', t||''); }catch{} }
function clearToken(){ try{ localStorage.removeItem('umkm_token'); }catch{} }
function toArr(x){ if(!x) return []; if(Array.isArray(x)) return x; if(typeof x==='string') return x.split(',').map(s=>s.trim()).filter(Boolean); return []; }
function hasSvc(services, svc){ return toArr(services).map(s=>s.toLowerCase()).includes(String(svc||'').toLowerCase()); }
function goLogin(){ location.replace(GATE_CONFIG.LOGIN_PAGE+'?next='+encodeURIComponent(location.href)); }
function goPay(q){
  const qs = q ? ('?'+new URLSearchParams(q).toString()) : '';
  location.replace(GATE_CONFIG.PAY_PAGE + qs);
}
function withTimeout(p, ms, name='request'){
  let to; const killer = new Promise((_,rej)=>{ to=setTimeout(()=>rej(new Error(name+' timeout')), ms); });
  return Promise.race([p.finally(()=>clearTimeout(to)), killer]);
}

// ---------- API ----------
async function apiUserCheck(tok){
  const r = await withTimeout(fetch(WORKER_URL+'/?route=user-check', {
    method:'POST',
    headers:{ 'authorization':'Bearer '+tok, 'content-type':'application/json' },
    body:'{}',
    cache:'no-store', keepalive:false
  }), GATE_CONFIG.TIMEOUT_MS, 'user-check');
  let j; try{ j = await r.json(); } catch { j = { ok:false, error:'bad json' }; }
  return j;
}
async function apiLogin(u,p){
  const r = await withTimeout(fetch(WORKER_URL+'/?route=user-login', {
    method:'POST',
    headers:{ 'content-type':'application/json' },
    body: JSON.stringify({ username:u, password:p }),
    cache:'no-store', keepalive:false
  }), GATE_CONFIG.TIMEOUT_MS, 'user-login');
  let j; try{ j = await r.json(); } catch { j = { ok:false, error:'bad json' }; }
  return j;
}

// ---------- main flow ----------
(async function run(){
  try {
    // Early Guard di <head> sudah sembunyikan halaman. Di sini validasi cepat.
    const token = getToken();
    if (!token) {
      // Normalnya ketangkap Early Guard, tapi berjaga-jaga:
      return goLogin();
    }

    // Validasi token
    let chk;
    try { chk = await apiUserCheck(token); } catch (e) { chk = { ok:false, error:String(e) }; }

    if (chk && chk.ok) {
      if (GATE_CONFIG.SERVICE_REQUIRED && !hasSvc(chk.services, GATE_CONFIG.SERVICE_REQUIRED)) {
        // Tidak punya layanan yang disyaratkan → arahkan ke halaman bayar
        return goPay();
      }
      // Token valid dan layanan cocok → tampilkan halaman
      return unlock();
    }

    // Token invalid → bersihkan
    clearToken();

    // Dev auto-login (hanya untuk lokal)
    if (isLocalDev()) {
      try{
        const res = await apiLogin(GATE_CONFIG.DEV_DEFAULT_USER.u, GATE_CONFIG.DEV_DEFAULT_USER.p);
        if (res && res.ok && res.token) {
          setToken(res.token);
          if (GATE_CONFIG.SERVICE_REQUIRED && !hasSvc(res.services, GATE_CONFIG.SERVICE_REQUIRED)) {
            return goPay();
          }
          return unlock();
        }
      }catch(_){}
    }

    // Gagal → login
    return goLogin();

  } catch (err) {
    // Kesalahan fatal → jangan blank; arahkan login
    try { clearToken(); } catch(_){}
    goLogin();
  }
})();

// ---------- public helper ----------
window.umkmSignOut = function(){
  clearToken();
  goLogin();
};
