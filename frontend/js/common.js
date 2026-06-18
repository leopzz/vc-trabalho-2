// Funções utilitárias compartilhadas entre as páginas.

// A API é servida na mesma origem do frontend (FastAPI + StaticFiles).
// Se quiser rodar o frontend separado, basta trocar para "http://localhost:8000".
const API_BASE = "";

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, options);
  let data = null;
  try { data = await res.json(); } catch (_) { /* sem corpo JSON */ }
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `Erro ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

let _toastTimer = null;
function toast(message, type = "") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = "show " + type;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = ""; }, 3200);
}

// Captura o frame atual de um <video> e devolve uma Data URL JPEG.
function captureFrame(video, quality = 0.8) {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

// Inicia a webcam em um elemento <video>.
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
