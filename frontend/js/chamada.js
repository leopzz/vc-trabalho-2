// Lógica da tela de chamada (reconhecimento ao vivo).

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");

const startBtn = document.getElementById("start");
const autoBtn = document.getElementById("auto");
const snapBtn = document.getElementById("snap");
const resetBtn = document.getElementById("reset");

const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const dateEl = document.getElementById("date");
const presentCountEl = document.getElementById("presentCount");
const totalCountEl = document.getElementById("totalCount");
const attendanceBody = document.getElementById("attendanceBody");

let camStream = null;
let autoTimer = null;
let busy = false; // evita sobrepor requisições

const AUTO_INTERVAL_MS = 2500; // intervalo entre reconhecimentos automáticos

// --- Câmera -------------------------------------------------------------
startBtn.addEventListener("click", async () => {
  if (camStream) {
    stopAuto();
    stopCamera(camStream);
    camStream = null;
    clearOverlay();
    startBtn.textContent = "▶ Iniciar câmera";
    autoBtn.disabled = snapBtn.disabled = true;
    setStatus(false, "Câmera desligada.");
    return;
  }
  try {
    camStream = await startCamera(video);
    // O canvas usa a MESMA resolução intrínseca do vídeo, então as caixas
    // (em coordenadas de pixel do frame) alinham perfeitamente com o overlay.
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    startBtn.textContent = "⏹ Desligar câmera";
    autoBtn.disabled = snapBtn.disabled = false;
    setStatus(true, "Câmera ligada. Inicie a chamada automática ou reconheça manualmente.");
  } catch (err) {
    toast("Não foi possível acessar a webcam: " + err.message, "err");
  }
});

// --- Reconhecimento -----------------------------------------------------
snapBtn.addEventListener("click", () => recognizeOnce());

autoBtn.addEventListener("click", () => {
  if (autoTimer) {
    stopAuto();
  } else {
    autoBtn.textContent = "⏹ Parar automática";
    setStatus(true, "Chamada automática em andamento...");
    recognizeOnce();
    autoTimer = setInterval(recognizeOnce, AUTO_INTERVAL_MS);
  }
});

function stopAuto() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  autoBtn.textContent = "⏱ Chamada automática";
}

async function recognizeOnce() {
  if (busy || !camStream) return;
  busy = true;
  try {
    const image = captureFrame(video, 0.85);
    const res = await api("/api/recognize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });
    drawDetections(res.detections);
    renderAttendance(res.attendance);
    if (res.newly_present && res.newly_present.length) {
      toast("Presença registrada: " + res.newly_present.join(", "), "ok");
    }
    setStatus(true, `${res.faces_detected} rosto(s) detectado(s).`);
  } catch (err) {
    toast(err.message, "err");
  } finally {
    busy = false;
  }
}

// --- Desenho das caixas -------------------------------------------------
function clearOverlay() { ctx.clearRect(0, 0, overlay.width, overlay.height); }

function drawDetections(detections) {
  clearOverlay();
  ctx.lineWidth = Math.max(2, overlay.width / 200);
  ctx.font = `${Math.max(14, overlay.width / 28)}px "Segoe UI", sans-serif`;
  ctx.textBaseline = "top";

  for (const d of detections) {
    const { x, y, w, h } = d.box;
    const color = d.recognized ? "#22c55e" : "#f59e0b";
    const label = d.recognized ? d.name : "Desconhecido";

    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);

    // Fundo do rótulo.
    const padding = 6;
    const textW = ctx.measureText(label).width;
    const textH = parseInt(ctx.font, 10) + padding;
    ctx.fillStyle = color;
    ctx.fillRect(x, Math.max(y - textH, 0), textW + padding * 2, textH);
    ctx.fillStyle = "#0f172a";
    ctx.fillText(label, x + padding, Math.max(y - textH, 0) + padding / 2);
  }
}

// --- Lista de chamada ---------------------------------------------------
function renderAttendance(attendance) {
  if (!attendance) return;
  dateEl.textContent = formatDate(attendance.date);
  const rows = attendance.students || [];
  totalCountEl.textContent = rows.length;
  presentCountEl.textContent = rows.filter((r) => r.present).length;

  attendanceBody.innerHTML = "";
  if (rows.length === 0) {
    attendanceBody.innerHTML = '<tr><td colspan="3" class="muted">Nenhum aluno cadastrado.</td></tr>';
    return;
  }
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.name}</td>
      <td><span class="badge ${r.present ? "present" : "absent"}">${r.present ? "Presente" : "Ausente"}</span></td>
      <td>${r.time || "—"}</td>
    `;
    attendanceBody.appendChild(tr);
  }
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// --- Reset --------------------------------------------------------------
resetBtn.addEventListener("click", async () => {
  if (!confirm("Zerar todas as presenças de hoje?")) return;
  try {
    const att = await api("/api/attendance/reset", { method: "POST" });
    renderAttendance(att);
    toast("Chamada zerada.", "ok");
  } catch (err) {
    toast(err.message, "err");
  }
});

// --- Util ---------------------------------------------------------------
function setStatus(live, text) {
  dot.className = "status-dot" + (live ? " live" : "");
  statusText.textContent = text;
}

window.addEventListener("beforeunload", () => { stopAuto(); stopCamera(camStream); });

// Carrega a lista inicial (mesmo sem câmera ligada).
(async function init() {
  try { renderAttendance(await api("/api/attendance")); } catch (_) {}
})();
