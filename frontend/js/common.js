// Utilitários compartilhados entre as páginas.
// A API é servida na mesma origem (FastAPI + StaticFiles).
const API_BASE = "";

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, options);
  let data = null;
  try { data = await res.json(); } catch (_) { /* sem corpo */ }
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `Erro ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

const postJSON = (path, body) =>
  api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let _toastTimer = null;
function toast(message, type = "") {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = message;
  el.className = "show " + type;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = ""; }, 3400);
}

// Captura o frame atual de um <video> como Data URL JPEG.
function captureFrame(video, quality = 0.85) {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function startCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

function stopCamera(stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}

// Avalia se o maior rosto está bem posicionado (centralizado e com tamanho
// adequado) a partir da resposta do endpoint /api/detect. Independe de
// resolução — usa proporções relativas à imagem.
function evaluatePlacement(detect) {
  if (!detect || !detect.faces || detect.faces.length === 0) {
    return { ok: false, reason: "Nenhum rosto detectado" };
  }
  const { width: W, height: H, faces } = detect;
  const f = faces.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  const offX = Math.abs(cx - W / 2) / W;
  const offY = Math.abs(cy - H / 2) / H;
  const sizeR = f.w / W;
  if (sizeR < 0.22) return { ok: false, reason: "Aproxime-se da câmera" };
  if (sizeR > 0.72) return { ok: false, reason: "Afaste-se um pouco" };
  if (offX > 0.20 || offY > 0.20) return { ok: false, reason: "Centralize o rosto no guia" };
  return { ok: true, reason: "Rosto bem posicionado" };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateBR(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
