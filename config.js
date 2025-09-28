/* config.js — umkmall global config
 * Taruh file ini di root (sejajar HTML) dan include PALING AWAL di <head>.
 * gate.js, login.html, admin.html, pay.html akan membaca nilai di sini.
 */
(function () {
  const CFG = {
    // ====== WAJIB: alamat Cloudflare Worker kamu ======
    WORKER_URL: "https://umkm.msabiq-stan.workers.dev",

    // ====== Layanan yang wajib dimiliki user untuk akses kalkulator ======
    SERVICE_REQUIRED: "umkm_basic",

    // ====== Info navigasi halaman (opsional, untuk konsistensi tautan) ======
    PAGES: {
      landing: "./landing.html",
      pay: "./pay.html",
      login: "./login.html",
      app: "./index.html"
    },

    // ====== Kredensial default DEV (hanya aktif di localhost/127.0.0.1/file:) ======
    DEV_DEFAULT_USER: { username: "user1", password: "User@123" },

    // ====== (Opsional) URL finish Snap (dipakai di backend/GAS) ======
    // Jika dihosting di domain publik, ubah jadi origin kamu:
    // FINISH_URL: "https://domainkamu.com/pay.html"
    FINISH_URL:
      (location.origin && location.origin !== "null")
        ? (location.origin + "/pay.html")
        : "./pay.html"
  };

  // Merge agar bisa dioverride bila perlu
  window.UMKM_CONFIG = Object.assign({}, window.UMKM_CONFIG || {}, CFG);

  // Kompatibilitas lama: beberapa halaman membaca __WORKER_BASE__
  window.__WORKER_BASE__ = window.UMKM_CONFIG.WORKER_URL;

  // Preconnect dinamis ke Worker untuk percepat handshake awal
  try {
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = window.UMKM_CONFIG.WORKER_URL;
    link.crossOrigin = "anonymous";
    document.head && document.head.appendChild(link);
  } catch (_) {}
})();
