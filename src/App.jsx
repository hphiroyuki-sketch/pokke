import { useState, useEffect, useCallback, useRef } from "react";

// ============================================================
// Pokke — NFC Contact Capture App (PWA Edition)
// ============================================================

// --- Utility: UUID ---
const uuid = () => crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);

// --- Utility: Date formatting ---
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

// --- IndexedDB wrapper ---
const DB_NAME = "pokke_db";
const DB_VERSION = 1;
const STORE = "contacts";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(contact) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put(contact);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- SNS detection ---
const SNS_DOMAINS = [
  { domain: "instagram.com", platform: "Instagram" },
  { domain: "twitter.com", platform: "Twitter" },
  { domain: "x.com", platform: "X" },
  { domain: "facebook.com", platform: "Facebook" },
  { domain: "linkedin.com", platform: "LinkedIn" },
  { domain: "tiktok.com", platform: "TikTok" },
  { domain: "youtube.com", platform: "YouTube" },
  { domain: "github.com", platform: "GitHub" },
  { domain: "note.com", platform: "note" },
  { domain: "lit.link", platform: "lit.link" },
  { domain: "linktr.ee", platform: "Linktree" },
  { domain: "prairie.cards", platform: "Prairie" },
];

function detectSource(url) {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    if (host.includes("lit.link")) return "litlink";
    if (host.includes("linktr.ee")) return "linktree";
    if (host.includes("canva.")) return "canva";
    if (host.includes("prairie.cards")) return "prairie";
    for (const s of SNS_DOMAINS) {
      if (host.includes(s.domain)) return "sns";
    }
    return "other";
  } catch { return "other"; }
}

function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    for (const s of SNS_DOMAINS) {
      if (host.includes(s.domain)) return s.platform;
    }
    return host;
  } catch { return "Link"; }
}

// --- NFC URL extraction (handles NDEF URI prefix bytes) ---
const NDEF_URI_PREFIXES = [
  "", "http://www.", "https://www.", "http://", "https://",
  "tel:", "mailto:", "ftp://anonymous:anonymous@", "ftp://ftp.",
  "ftps://", "sftp://", "smb://", "nfs://", "ftp://", "dav://",
  "news:", "telnet://", "imap:", "rtsp://", "urn:", "pop:",
  "sip:", "sips:", "tftp:", "btspp://", "btl2cap://", "btgoep://",
  "tcpobex://", "irdaobex://", "file://", "urn:epc:id:", "urn:epc:tag:",
  "urn:epc:pat:", "urn:epc:raw:", "urn:epc:", "urn:nfc:",
];

function extractNFCUrl(record) {
  if (record.recordType === "url") {
    return new TextDecoder().decode(record.data);
  }
  if (record.recordType === "uri" || record.recordType === "U") {
    const bytes = new Uint8Array(record.data.buffer || record.data);
    const prefixIndex = bytes[0];
    const rest = new TextDecoder().decode(bytes.slice(1));
    return (NDEF_URI_PREFIXES[prefixIndex] || "") + rest;
  }
  if (record.recordType === "smart-poster" || record.recordType === "text") {
    const text = new TextDecoder().decode(record.data);
    const m = text.match(/https?:\/\/[^\s]+/);
    if (m) return m[0];
  }
  try {
    const text = new TextDecoder().decode(record.data);
    if (text.startsWith("http")) return text;
    const m = text.match(/https?:\/\/[^\s]+/);
    if (m) return m[0];
  } catch {}
  return null;
}

// --- OGP fetch (mock for demo) ---
async function fetchOGP(url) {
  const source = detectSource(url);
  await new Promise(r => setTimeout(r, 600 + Math.random() * 300));

  if (["litlink", "linktree", "canva", "prairie"].includes(source)) {
    const pathParts = new URL(url).pathname.split("/").filter(Boolean);
    const username = pathParts[pathParts.length - 1] || "User";
    return { name: username.charAt(0).toUpperCase() + username.slice(1), avatarUrl: null, links: [{ platform: detectPlatform(url), url }], sourceType: source };
  }
  if (source === "sns") {
    const pathParts = new URL(url).pathname.split("/").filter(Boolean);
    const username = pathParts[pathParts.length - 1] || "";
    return { name: username ? `@${username}` : null, avatarUrl: null, links: [{ platform: detectPlatform(url), url }], sourceType: "sns" };
  }
  return { name: null, avatarUrl: null, links: [{ platform: detectPlatform(url), url }], sourceType: "other" };
}

// --- Geolocation ---
async function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        let placeName = null;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&accept-language=ja`);
          const data = await res.json();
          const a = data.address || {};
          placeName = [a.city || a.town || a.village, a.state].filter(Boolean).join(", ") || data.display_name?.split(",").slice(0, 2).join(",");
        } catch {}
        resolve({ latlng: [latitude, longitude], placeName });
      },
      () => resolve(null), { timeout: 8000 }
    );
  });
}

// --- PWA Hooks ---
function usePWAInstall() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone) {
      setIsInstalled(true); return;
    }
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => { setIsInstalled(true); setInstallPrompt(null); });
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const install = async () => {
    if (!installPrompt) return false;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") { setIsInstalled(true); setInstallPrompt(null); }
    return outcome === "accepted";
  };

  return { canInstall: !!installPrompt && !isInstalled && !dismissed, isInstalled, install, dismiss: () => setDismissed(true) };
}

function useServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      const swCode = `
        const CACHE='pokke-v1';
        self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/'])));self.skipWaiting()});
        self.addEventListener('activate',e=>{e.waitUntil(self.clients.claim())});
        self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
      `;
      const blob = new Blob([swCode], { type: "application/javascript" });
      navigator.serviceWorker.register(URL.createObjectURL(blob)).catch(() => {});
    }
  }, []);
}

const POKKE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0D0F14"/><rect x="96" y="120" width="220" height="200" rx="28" fill="none" stroke="#3DEFE9" stroke-width="7"/><circle cx="192" cy="196" r="32" fill="none" stroke="#3DEFE9" stroke-width="6"/><path d="M142 288Q142 254 192 246Q242 254 242 288" fill="none" stroke="#3DEFE9" stroke-width="6" stroke-linecap="round"/><circle cx="340" cy="220" r="12" fill="#3DEFE9"/><path d="M358 182A48 48 0 01358 258" fill="none" stroke="#3DEFE9" stroke-width="6" stroke-linecap="round" opacity=".5"/><path d="M378 158A78 78 0 01378 282" fill="none" stroke="#3DEFE9" stroke-width="6" stroke-linecap="round" opacity=".65"/><path d="M398 134A108 108 0 01398 306" fill="none" stroke="#3DEFE9" stroke-width="6" stroke-linecap="round" opacity=".8"/><text x="256" y="408" text-anchor="middle" font-family="Helvetica Neue,Arial,sans-serif" font-weight="800" font-size="68" letter-spacing="5" fill="#3DEFE9">Pokke</text></svg>`;

function useManifest() {
  useEffect(() => {
    if (document.querySelector('link[rel="manifest"]')) return;
    const manifest = {
      name: "Pokke — NFC Contact Capture",
      short_name: "Pokke",
      description: "NFCタッチで名刺情報を自動取得・管理",
      start_url: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: "#0D0F14",
      theme_color: "#3DEFE9",
      categories: ["business", "productivity"],
      icons: [{ src: "data:image/svg+xml," + encodeURIComponent(POKKE_ICON_SVG), sizes: "any", type: "image/svg+xml" }],
    };
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: "application/json" }));
    document.head.appendChild(link);
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
    meta.content = "#0D0F14";
  }, []);
}

// --- SVG Icons ---
const Icon = ({ d, size = 20, color = "currentColor", ...props }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d={d} />
  </svg>
);
const icons = {
  nfc: "M2 7v10m4-12v14m4-12v10m4-14v14m4-12v10",
  search: "M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z",
  plus: "M12 5v14m-7-7h14",
  x: "M18 6L6 18M6 6l12 12",
  chevLeft: "M15 18l-6-6 6-6",
  settings: "M12 8a4 4 0 100 8 4 4 0 000-8zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
  user: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 3a4 4 0 100 8 4 4 0 000-8z",
  link: "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71",
  trash: "M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2",
  download: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  clock: "M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2",
  mapPin: "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0zM12 7a3 3 0 100 6 3 3 0 000-6z",
  smartphone: "M17 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V4a2 2 0 00-2-2zM12 18h.01",
};

// --- Colors ---
const C = {
  bg: "#0D0F14", surface: "#161922", card: "#1A1D28", border: "#2A2D3A",
  accent: "#3DEFE9", accentDim: "rgba(61,239,233,0.12)", accentGlow: "rgba(61,239,233,0.25)",
  text: "#E8EAF0", textSec: "#8B8FA3", textDim: "#5A5E72",
  danger: "#FF5A5A", dangerDim: "rgba(255,90,90,0.12)", success: "#4AE68A",
};

const baseInput = {
  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
  padding: "10px 14px", color: C.text, fontSize: 14, outline: "none",
  width: "100%", boxSizing: "border-box", fontFamily: "inherit", transition: "border-color 0.2s",
};

// --- UI Components ---
function Avatar({ url, name, size = 48 }) {
  const initials = (name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const colors = ["#3DEFE9", "#E94E77", "#F5A623", "#7B68EE", "#50C878"];
  const ci = (name || "").length % colors.length;
  if (url) return <div style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: C.surface }}><img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>;
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: `linear-gradient(135deg, ${colors[ci]}44, ${colors[ci]}22)`,
      border: `1.5px solid ${colors[ci]}55`,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: colors[ci], fontSize: size * 0.38, fontWeight: 700, letterSpacing: 1,
    }}>{initials}</div>
  );
}

function Button({ children, onClick, variant = "primary", style = {}, disabled = false }) {
  const base = { border: "none", borderRadius: 10, padding: "11px 22px", fontSize: 14, fontWeight: 600, cursor: disabled ? "default" : "pointer", transition: "all 0.2s", display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "inherit", opacity: disabled ? 0.5 : 1 };
  const v = { primary: { background: C.accent, color: C.bg }, ghost: { background: "transparent", color: C.textSec, border: `1px solid ${C.border}` }, danger: { background: C.dangerDim, color: C.danger, border: `1px solid ${C.danger}33` } };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...v[variant], ...style }}>{children}</button>;
}

function TagBadge({ label, onRemove }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.accentDim, color: C.accent, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>
      {label}{onRemove && <span onClick={onRemove} style={{ cursor: "pointer", opacity: 0.7, marginLeft: 2 }}>×</span>}
    </span>
  );
}

function NFCPulse({ scanning }) {
  return (
    <div style={{ position: "relative", width: 180, height: 180, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{`@keyframes pokke-pulse{0%{transform:scale(.8);opacity:.6}50%{transform:scale(1.2);opacity:.15}100%{transform:scale(1.6);opacity:0}}`}</style>
      {scanning && [0, 1, 2].map(i => <div key={i} style={{ position: "absolute", width: 120, height: 120, borderRadius: "50%", border: `2px solid ${C.accent}`, animation: `pokke-pulse 2s ease-out infinite`, animationDelay: `${i * 0.6}s` }} />)}
      <div style={{
        width: 100, height: 100, borderRadius: "50%",
        background: scanning ? `radial-gradient(circle,${C.accent}30,${C.accent}08)` : `radial-gradient(circle,${C.border}40,${C.border}10)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        border: `2px solid ${scanning ? C.accent : C.border}`, transition: "all 0.5s",
        boxShadow: scanning ? `0 0 40px ${C.accentGlow}` : "none",
      }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={scanning ? C.accent : C.textDim} strokeWidth="1.5">
          <path d="M6 8.32a7.43 7.43 0 010 7.36"/><path d="M9.46 6.21a11.76 11.76 0 010 11.58"/><path d="M12.91 4.1a16.09 16.09 0 010 15.8"/><path d="M16.37 2a20.4 20.4 0 010 20"/>
        </svg>
      </div>
    </div>
  );
}

function TabBar({ active, onChange }) {
  const tabs = [{ id: "scan", label: "スキャン", icon: icons.nfc }, { id: "contacts", label: "コンタクト", icon: icons.user }, { id: "settings", label: "設定", icon: icons.settings }];
  return (
    <div style={{ display: "flex", borderTop: `1px solid ${C.border}`, background: C.surface, padding: "6px 0 env(safe-area-inset-bottom, 8px)" }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
          background: "none", border: "none", cursor: "pointer", padding: "8px 0",
          color: active === t.id ? C.accent : C.textDim, transition: "color 0.2s", fontFamily: "inherit",
        }}>
          <Icon d={t.icon} size={20} /><span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.5 }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function Header({ title, left, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", minHeight: 52 }}>
      <div style={{ width: 60, display: "flex", justifyContent: "flex-start" }}>{left}</div>
      <span style={{ fontSize: 16, fontWeight: 700, color: C.text, letterSpacing: 0.5 }}>{title}</span>
      <div style={{ width: 60, display: "flex", justifyContent: "flex-end" }}>{right}</div>
    </div>
  );
}

function InstallBanner({ onInstall, onDismiss }) {
  return (
    <div style={{
      position: "absolute", bottom: 70, left: 16, right: 16, zIndex: 100,
      background: `linear-gradient(135deg, #161922, #1A1D28)`,
      border: `1px solid ${C.accent}33`, borderRadius: 16,
      padding: 18, boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 20px ${C.accentGlow}`,
    }}>
      <style>{`@keyframes pokke-slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div style={{ animation: "pokke-slideUp 0.4s ease-out" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: C.accentDim, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${C.accent}33` }}>
            <Icon d={icons.smartphone} size={22} color={C.accent} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 3 }}>ホーム画面に追加</div>
            <div style={{ fontSize: 12, color: C.textSec, lineHeight: 1.5 }}>インストールするとアプリのように起動でき、NFCタッチ時に自動で開きます</div>
          </div>
          <button onClick={onDismiss} style={{ background: "none", border: "none", cursor: "pointer", color: C.textDim, padding: 4, flexShrink: 0 }}><Icon d={icons.x} size={16} /></button>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <Button variant="ghost" onClick={onDismiss} style={{ flex: 1, justifyContent: "center", padding: "9px 0" }}>あとで</Button>
          <Button onClick={onInstall} style={{ flex: 1, justifyContent: "center", padding: "9px 0" }}>インストール</Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SCREENS
// ============================================================

function ScanScreen({ onContactScanned, onManualAdd }) {
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState("タッチしてスキャン開始");
  const [nfcSupported] = useState(() => "NDEFReader" in window);
  const abortRef = useRef(null);

  const startScan = useCallback(async () => {
    if (!nfcSupported) {
      setScanning(true); setStatus("デモモード：NFC読み取り中...");
      setTimeout(() => {
        const urls = ["https://lit.link/tanakayuki", "https://linktr.ee/satokana", "https://www.instagram.com/demo_user", "https://www.linkedin.com/in/yamada-taro"];
        setScanning(false); setStatus("読み取り完了！");
        onContactScanned(urls[Math.floor(Math.random() * urls.length)]);
      }, 2000);
      return;
    }
    try {
      const ndef = new window.NDEFReader();
      abortRef.current = new AbortController();
      await ndef.scan({ signal: abortRef.current.signal });
      setScanning(true); setStatus("NFCカードをかざしてください...");
      ndef.addEventListener("reading", ({ message }) => {
        for (const record of message.records) {
          const url = extractNFCUrl(record);
          if (url && url.startsWith("http")) {
            setScanning(false); setStatus("読み取り完了！");
            abortRef.current?.abort(); onContactScanned(url); return;
          }
        }
        if (message.records.length > 0) {
          try { const t = new TextDecoder().decode(message.records[0].data); if (t) { setScanning(false); setStatus("テキストデータを検出"); onContactScanned(t); return; } } catch {}
        }
        setStatus("URLが見つかりませんでした。もう一度タッチしてください。");
      });
      ndef.addEventListener("readingerror", () => setStatus("読み取りエラー。もう一度タッチしてください。"));
    } catch (e) {
      setStatus(e.name === "NotAllowedError" ? "NFC許可が必要です。ブラウザ設定を確認してください。" : "NFCエラー: " + e.message);
      setScanning(false);
    }
  }, [nfcSupported, onContactScanned]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: 24 }}>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: 2, background: `linear-gradient(135deg,${C.accent},#7B68EE)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: 4 }}>Pokke</div>
        <div style={{ fontSize: 12, color: C.textDim, letterSpacing: 1 }}>NFC CONTACT CAPTURE</div>
      </div>
      <NFCPulse scanning={scanning} />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 14, color: scanning ? C.accent : C.textSec, fontWeight: 500, marginBottom: 8 }}>{status}</div>
        {!nfcSupported && <div style={{ fontSize: 11, color: C.textDim, background: C.surface, borderRadius: 8, padding: "8px 16px", marginBottom: 8, border: `1px solid ${C.border}` }}>⚠️ Web NFC非対応 — デモモードで動作中</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 280 }}>
        <Button onClick={startScan} disabled={scanning} style={{ justifyContent: "center", width: "100%" }}><Icon d={icons.nfc} size={18} />{scanning ? "スキャン中..." : "NFCスキャン"}</Button>
        <Button variant="ghost" onClick={onManualAdd} style={{ justifyContent: "center", width: "100%" }}><Icon d={icons.plus} size={18} />手動で追加</Button>
      </div>
    </div>
  );
}

function ConfirmScreen({ initialData, onSave, onCancel, isEdit = false }) {
  const [form, setForm] = useState({ name: "", company: "", title: "", email: "", phone: "", memo: "", tags: [], sourceUrl: "", links: [], avatarUrl: null, sourceType: "other", ...initialData });
  const [tagInput, setTagInput] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const addTag = () => { const t = tagInput.trim(); if (t && !form.tags.includes(t)) set("tags", [...form.tags, t]); setTagInput(""); };
  const removeTag = (t) => set("tags", form.tags.filter(x => x !== t));
  const addLink = () => set("links", [...form.links, { platform: "", url: "" }]);
  const updateLink = (i, k, v) => { const ls = [...form.links]; ls[i] = { ...ls[i], [k]: v }; set("links", ls); };
  const removeLink = (i) => set("links", form.links.filter((_, j) => j !== i));
  const L = { fontSize: 12, fontWeight: 600, color: C.textSec, marginBottom: 4, display: "block" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Header title={isEdit ? "コンタクト編集" : "コンタクト確認"}
        left={<button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: C.textSec, display: "flex", alignItems: "center", fontFamily: "inherit" }}><Icon d={icons.chevLeft} size={20} /></button>}
        right={<button onClick={() => onSave(form)} style={{ background: "none", border: "none", cursor: "pointer", color: C.accent, fontWeight: 700, fontSize: 14, fontFamily: "inherit" }}>保存</button>}
      />
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {form.sourceUrl && <div style={{ background: C.accentDim, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: C.accent, wordBreak: "break-all", border: `1px solid ${C.accent}22` }}>🔗 {form.sourceUrl}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Avatar url={form.avatarUrl} name={form.name} size={64} />
          <div style={{ flex: 1 }}><label style={L}>名前</label><input style={baseInput} value={form.name || ""} onChange={e => set("name", e.target.value)} placeholder="山田 太郎" /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><label style={L}>会社</label><input style={baseInput} value={form.company || ""} onChange={e => set("company", e.target.value)} placeholder="株式会社〇〇" /></div>
          <div><label style={L}>役職</label><input style={baseInput} value={form.title || ""} onChange={e => set("title", e.target.value)} placeholder="営業部長" /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><label style={L}>メール</label><input style={baseInput} type="email" value={form.email || ""} onChange={e => set("email", e.target.value)} placeholder="email@example.com" /></div>
          <div><label style={L}>電話</label><input style={baseInput} type="tel" value={form.phone || ""} onChange={e => set("phone", e.target.value)} placeholder="090-1234-5678" /></div>
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <label style={{ ...L, marginBottom: 0 }}>SNSリンク</label>
            <button onClick={addLink} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>+ 追加</button>
          </div>
          {form.links.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <input style={{ ...baseInput, width: 90, flexShrink: 0 }} value={l.platform} onChange={e => updateLink(i, "platform", e.target.value)} placeholder="SNS名" />
              <input style={{ ...baseInput, flex: 1 }} value={l.url} onChange={e => updateLink(i, "url", e.target.value)} placeholder="URL" />
              <button onClick={() => removeLink(i)} style={{ background: "none", border: "none", color: C.danger, cursor: "pointer", flexShrink: 0, padding: 4 }}><Icon d={icons.x} size={16} /></button>
            </div>
          ))}
        </div>
        <div><label style={L}>メモ</label><textarea style={{ ...baseInput, minHeight: 72, resize: "vertical" }} value={form.memo || ""} onChange={e => set("memo", e.target.value)} placeholder="出会った状況、印象など..." /></div>
        <div>
          <label style={L}>タグ</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>{form.tags.map(t => <TagBadge key={t} label={t} onRemove={() => removeTag(t)} />)}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...baseInput, flex: 1 }} value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addTag())} placeholder="タグを追加..." />
            <Button variant="ghost" onClick={addTag} style={{ padding: "8px 14px" }}>追加</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailScreen({ contact, onBack, onEdit, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Header title="コンタクト詳細"
        left={<button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: C.textSec, display: "flex", alignItems: "center", fontFamily: "inherit" }}><Icon d={icons.chevLeft} size={20} /></button>}
        right={<button onClick={onEdit} style={{ background: "none", border: "none", cursor: "pointer", color: C.accent, fontWeight: 600, fontSize: 13, fontFamily: "inherit" }}>編集</button>}
      />
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 24px" }}>
        <div style={{ background: C.card, borderRadius: 16, padding: 24, textAlign: "center", marginBottom: 20, border: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}><Avatar url={contact.avatarUrl} name={contact.name} size={80} /></div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 4 }}>{contact.name || "名前未登録"}</div>
          {(contact.title || contact.company) && <div style={{ fontSize: 13, color: C.textSec }}>{[contact.title, contact.company].filter(Boolean).join(" / ")}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
          {contact.capturedAt && <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.textSec, fontSize: 13 }}><Icon d={icons.clock} size={16} color={C.textDim} />{fmtDate(contact.capturedAt)}</div>}
          {contact.location?.placeName && <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.textSec, fontSize: 13 }}><Icon d={icons.mapPin} size={16} color={C.textDim} />{contact.location.placeName}</div>}
          {contact.email && <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.textSec, fontSize: 13 }}><span style={{ width: 16, textAlign: "center", color: C.textDim }}>✉</span>{contact.email}</div>}
          {contact.phone && <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.textSec, fontSize: 13 }}><span style={{ width: 16, textAlign: "center", color: C.textDim }}>☎</span>{contact.phone}</div>}
        </div>
        {contact.links?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textDim, marginBottom: 10, letterSpacing: 1, textTransform: "uppercase" }}>Links</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {contact.links.map((l, i) => <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface, borderRadius: 10, padding: "10px 14px", textDecoration: "none", color: C.text, fontSize: 13, border: `1px solid ${C.border}` }}><Icon d={icons.link} size={16} color={C.accent} /><span style={{ fontWeight: 600, minWidth: 70 }}>{l.platform || "Link"}</span><span style={{ color: C.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{l.url}</span></a>)}
            </div>
          </div>
        )}
        {contact.tags?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textDim, marginBottom: 10, letterSpacing: 1, textTransform: "uppercase" }}>Tags</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{contact.tags.map(t => <TagBadge key={t} label={t} />)}</div>
          </div>
        )}
        {contact.memo && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textDim, marginBottom: 10, letterSpacing: 1, textTransform: "uppercase" }}>Memo</div>
            <div style={{ background: C.surface, borderRadius: 10, padding: 14, color: C.textSec, fontSize: 13, lineHeight: 1.6, border: `1px solid ${C.border}`, whiteSpace: "pre-wrap" }}>{contact.memo}</div>
          </div>
        )}
        {contact.sourceUrl && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textDim, marginBottom: 10, letterSpacing: 1, textTransform: "uppercase" }}>Source</div>
            <a href={contact.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: C.accent, wordBreak: "break-all" }}>{contact.sourceUrl}</a>
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          {!confirmDelete
            ? <Button variant="danger" onClick={() => setConfirmDelete(true)} style={{ width: "100%", justifyContent: "center" }}><Icon d={icons.trash} size={16} />削除</Button>
            : <div style={{ display: "flex", gap: 10 }}><Button variant="ghost" onClick={() => setConfirmDelete(false)} style={{ flex: 1, justifyContent: "center" }}>キャンセル</Button><Button variant="danger" onClick={() => onDelete(contact.id)} style={{ flex: 1, justifyContent: "center" }}>本当に削除</Button></div>
          }
        </div>
      </div>
    </div>
  );
}

function ContactsScreen({ contacts, onSelect }) {
  const [query, setQuery] = useState("");
  const filtered = contacts.filter(c => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (c.name || "").toLowerCase().includes(q) || (c.company || "").toLowerCase().includes(q) || (c.memo || "").toLowerCase().includes(q) || (c.location?.placeName || "").toLowerCase().includes(q) || (c.tags || []).some(t => t.toLowerCase().includes(q));
  }).sort((a, b) => new Date(b.capturedAt || 0) - new Date(a.capturedAt || 0));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Header title={`コンタクト (${contacts.length})`} />
      <div style={{ padding: "0 20px 12px" }}>
        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}><Icon d={icons.search} size={16} color={C.textDim} /></div>
          <input style={{ ...baseInput, paddingLeft: 36 }} value={query} onChange={e => setQuery(e.target.value)} placeholder="名前・会社・メモで検索..." />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px" }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: C.textDim }}>
            {contacts.length === 0 ? <div><div style={{ fontSize: 40, marginBottom: 12 }}>📇</div><div style={{ fontSize: 14 }}>コンタクトがありません</div><div style={{ fontSize: 12, marginTop: 4 }}>NFCスキャンで追加しましょう</div></div> : <div style={{ fontSize: 14 }}>検索結果なし</div>}
          </div>
        )}
        {filtered.map(c => (
          <button key={c.id} onClick={() => onSelect(c)} style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 10, cursor: "pointer", textAlign: "left", transition: "border-color 0.2s", fontFamily: "inherit" }}>
            <Avatar url={c.avatarUrl} name={c.name} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 2 }}>{c.name || "名前未登録"}</div>
              <div style={{ fontSize: 12, color: C.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[c.company, c.title].filter(Boolean).join(" / ") || c.sourceUrl || "—"}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: C.textDim }}>{c.capturedAt ? new Date(c.capturedAt).toLocaleDateString("ja-JP", { month: "short", day: "numeric" }) : ""}</div>
              {c.location?.placeName && <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>📍 {c.location.placeName.split(",")[0]}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsScreen({ contacts, onClearAll, isInstalled, canInstall, onInstall }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const exportJSON = () => { const b = new Blob([JSON.stringify(contacts, null, 2)], { type: "application/json" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `pokke_${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(u); };
  const exportCSV = () => {
    const h = ["name", "company", "title", "email", "phone", "sourceUrl", "capturedAt", "location", "memo", "tags"];
    const rows = contacts.map(c => h.map(k => k === "location" ? c.location?.placeName || "" : k === "tags" ? (c.tags || []).join(";") : c[k] || ""));
    const csv = [h.join(","), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const b = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `pokke_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(u);
  };
  const S = (t) => <div style={{ fontSize: 12, fontWeight: 700, color: C.textDim, marginBottom: 12, letterSpacing: 1, textTransform: "uppercase" }}>{t}</div>;
  const Box = ({ children }) => <div style={{ background: C.surface, borderRadius: 10, padding: 14, marginBottom: 24, fontSize: 13, color: C.textSec, lineHeight: 1.6, border: `1px solid ${C.border}` }}>{children}</div>;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Header title="設定" />
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 24px" }}>
        <div style={{ background: C.card, borderRadius: 14, padding: 20, marginBottom: 20, border: `1px solid ${C.border}`, textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 2, marginBottom: 4, background: `linear-gradient(135deg,${C.accent},#7B68EE)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Pokke</div>
          <div style={{ fontSize: 12, color: C.textDim }}>v1.0 PWA — NFC Contact Capture</div>
          <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>保存済み: {contacts.length}件</div>
        </div>

        {S("インストール状態")}
        <Box>{isInstalled ? <span style={{ color: C.success }}>✅ PWAインストール済み — スタンドアロンで動作中</span> : canInstall ? <div><div style={{ marginBottom: 10 }}>📱 ホーム画面に追加するとアプリのように使えます</div><Button onClick={onInstall} style={{ width: "100%", justifyContent: "center" }}><Icon d={icons.smartphone} size={16} />ホーム画面に追加</Button></div> : <div>💡 Android Chromeでアクセスすると「ホーム画面に追加」が利用できます</div>}</Box>

        {S("NFC対応")}
        <Box>{"NDEFReader" in window ? <span style={{ color: C.success }}>✅ Web NFC対応</span> : <div><div>⚠️ Web NFC非対応 — デモモード</div><div style={{ fontSize: 11, color: C.textDim, marginTop: 6 }}>対応: Android Chrome 89+ / HTTPS</div></div>}</Box>

        {S("NFC自動起動の仕組み")}
        <Box>
          <div style={{ marginBottom: 8 }}><strong style={{ color: C.text }}>① </strong>Pokkeをホーム画面にインストール</div>
          <div style={{ marginBottom: 8 }}><strong style={{ color: C.text }}>② </strong>NFCカードのURLをPokkeのドメインに設定</div>
          <div><strong style={{ color: C.text }}>③ </strong>カードタッチ → Android がURL検知 → Pokke自動起動</div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>※ NFCカードのURLドメインとPWAドメインが一致するとAndroidが自動でPWAを起動します</div>
        </Box>

        {S("エクスポート")}
        <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
          <Button variant="ghost" onClick={exportJSON} style={{ flex: 1, justifyContent: "center" }}><Icon d={icons.download} size={16} />JSON</Button>
          <Button variant="ghost" onClick={exportCSV} style={{ flex: 1, justifyContent: "center" }}><Icon d={icons.download} size={16} />CSV</Button>
        </div>

        {S("プライバシー")}
        <Box>すべてのデータはデバイス内にのみ保存。外部通信はOGPプロキシのみ。</Box>

        <div style={{ fontSize: 12, fontWeight: 700, color: C.danger, marginBottom: 12, letterSpacing: 1, textTransform: "uppercase" }}>デンジャーゾーン</div>
        {!confirmClear
          ? <Button variant="danger" onClick={() => setConfirmClear(true)} style={{ width: "100%", justifyContent: "center" }}><Icon d={icons.trash} size={16} />全コンタクト削除</Button>
          : <div style={{ display: "flex", gap: 10 }}><Button variant="ghost" onClick={() => setConfirmClear(false)} style={{ flex: 1, justifyContent: "center" }}>キャンセル</Button><Button variant="danger" onClick={() => { onClearAll(); setConfirmClear(false); }} style={{ flex: 1, justifyContent: "center" }}>全件削除する</Button></div>
        }
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================

export default function App() {
  const [tab, setTab] = useState("scan");
  const [contacts, setContacts] = useState([]);
  const [screen, setScreen] = useState({ type: "tabs" });
  const [loading, setLoading] = useState(false);

  const pwa = usePWAInstall();
  useServiceWorker();
  useManifest();

  const loadContacts = useCallback(async () => { try { setContacts(await dbGetAll()); } catch (e) { console.error(e); } }, []);
  useEffect(() => { loadContacts(); }, [loadContacts]);

  const handleScanned = async (url) => {
    setLoading(true);
    try {
      const ogp = await fetchOGP(url);
      const loc = await getLocation();
      setScreen({ type: "confirm", data: { id: uuid(), sourceUrl: url, sourceType: ogp.sourceType || "other", name: ogp.name || "", avatarUrl: ogp.avatarUrl || null, avatarBase64: null, company: "", title: "", email: "", phone: "", links: ogp.links || [], capturedAt: new Date().toISOString(), location: loc || { latlng: null, placeName: null }, memo: "", tags: [] } });
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleManualAdd = () => setScreen({ type: "confirm", data: { id: uuid(), sourceUrl: "", sourceType: "other", name: "", avatarUrl: null, avatarBase64: null, company: "", title: "", email: "", phone: "", links: [], capturedAt: new Date().toISOString(), location: { latlng: null, placeName: null }, memo: "", tags: [] } });
  const handleSave = async (c) => { await dbPut(c); await loadContacts(); setScreen({ type: "tabs" }); setTab("contacts"); };
  const handleDelete = async (id) => { await dbDelete(id); await loadContacts(); setScreen({ type: "tabs" }); };
  const handleClearAll = async () => { await dbClear(); await loadContacts(); };

  return (
    <div style={{ fontFamily: "'Noto Sans JP','Helvetica Neue',sans-serif", background: C.bg, color: C.text, height: "100vh", width: "100%", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}body{margin:0;background:${C.bg}}
        input:focus,textarea:focus{border-color:${C.accent}!important}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${C.border};border-radius:4px}
        ::placeholder{color:${C.textDim}}
      `}</style>

      {loading && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(13,15,20,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, flexDirection: "column", gap: 16 }}>
          <style>{`@keyframes pokke-spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}`}</style>
          <div style={{ width: 40, height: 40, border: `3px solid ${C.border}`, borderTopColor: C.accent, borderRadius: "50%", animation: "pokke-spin 0.8s linear infinite" }} />
          <div style={{ color: C.textSec, fontSize: 13 }}>プロフィール取得中...</div>
        </div>
      )}

      {pwa.canInstall && screen.type === "tabs" && <InstallBanner onInstall={pwa.install} onDismiss={pwa.dismiss} />}

      {screen.type === "tabs" && (
        <>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {tab === "scan" && <ScanScreen onContactScanned={handleScanned} onManualAdd={handleManualAdd} />}
            {tab === "contacts" && <ContactsScreen contacts={contacts} onSelect={(c) => setScreen({ type: "detail", data: c })} />}
            {tab === "settings" && <SettingsScreen contacts={contacts} onClearAll={handleClearAll} isInstalled={pwa.isInstalled} canInstall={pwa.canInstall} onInstall={pwa.install} />}
          </div>
          <TabBar active={tab} onChange={setTab} />
        </>
      )}
      {screen.type === "confirm" && <ConfirmScreen initialData={screen.data} onSave={handleSave} onCancel={() => setScreen({ type: "tabs" })} />}
      {screen.type === "detail" && <DetailScreen contact={screen.data} onBack={() => setScreen({ type: "tabs" })} onEdit={() => setScreen({ type: "edit", data: screen.data })} onDelete={handleDelete} />}
      {screen.type === "edit" && <ConfirmScreen initialData={screen.data} isEdit onSave={handleSave} onCancel={() => setScreen({ type: "detail", data: screen.data })} />}
    </div>
  );
}
