// Fluxo da chamada: Reconhecimento ao vivo -> Revisão -> Confirmação.

const el = (id) => document.getElementById(id);
const video = el("video");
const overlay = el("overlay");
const ctx = overlay.getContext("2d");

let camStream = null;
let recognizing = false;
let busy = false;
let students = [];                 // [{id,name,photo_url,...}]
const sessionRecognized = new Set();
let currentDate = todayISO();

const RECOGNIZE_INTERVAL = 1700;

// ---- navegação --------------------------------------------------------
function goStep(n) {
  for (const s of [1, 2, 3]) el("s" + s).hidden = s !== n;
  document.querySelectorAll(".step").forEach((stepEl) => {
    const step = +stepEl.dataset.step;
    stepEl.classList.toggle("active", step === n);
    stepEl.classList.toggle("done", step < n);
  });
  document.querySelectorAll(".step-line").forEach((line, i) => {
    line.classList.toggle("done", i + 1 < n);
  });
}

// ---- carregamento -----------------------------------------------------
async function loadStudents() {
  students = await api("/api/students");
  el("recTotal").textContent = students.length;
}

// ---- ETAPA 1: câmera + reconhecimento --------------------------------
el("camToggle").addEventListener("click", async () => {
  if (camStream) { stopRecognition(); return; }
  try {
    if (!students.length) await loadStudents();
    if (!students.length) { toast("Cadastre alunos antes de fazer a chamada.", "err"); return; }
    camStream = await startCamera(video);
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    el("camPlaceholder").hidden = true;
    el("camToggle").textContent = "Desligar câmera";
    setStatus(true, "Reconhecendo…");
    recognizing = true;
    recognitionLoop();
  } catch (err) {
    toast("Falha ao acessar a câmera: " + err.message, "err");
  }
});

function stopRecognition() {
  recognizing = false;
  stopCamera(camStream);
  camStream = null;
  clearOverlay();
  el("camToggle").textContent = "Iniciar câmera";
  el("camPlaceholder").hidden = false;
  setStatus(false, "Câmera desligada.");
}

async function recognitionLoop() {
  while (recognizing && camStream) {
    if (!busy) await recognizeOnce();
    await sleep(RECOGNIZE_INTERVAL);
  }
}

async function recognizeOnce() {
  busy = true;
  try {
    if (video.videoWidth && overlay.width !== video.videoWidth) {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
    }
    const image = captureFrame(video, 0.85);
    const res = await postJSON("/api/recognize", { image, date: currentDate });
    drawDetections(res.detections);
    let added = 0;
    for (const name of res.recognized) {
      if (!sessionRecognized.has(name)) { sessionRecognized.add(name); added++; }
    }
    if (added) updateReclist();
    setStatus(true, `${res.faces_detected} rosto(s) no quadro — ${sessionRecognized.size} reconhecido(s).`);
  } catch (err) {
    setStatus(true, "Erro: " + err.message);
  } finally {
    busy = false;
  }
}

function clearOverlay() { ctx.clearRect(0, 0, overlay.width, overlay.height); }

function drawDetections(detections) {
  clearOverlay();
  const lw = Math.max(2, overlay.width / 220);
  ctx.lineWidth = lw;
  ctx.font = `600 ${Math.max(14, overlay.width / 32)}px -apple-system, Segoe UI, sans-serif`;
  ctx.textBaseline = "top";
  for (const d of detections) {
    const { x, y, w, h } = d.box;
    const color = d.recognized ? "#22c55e" : "#f59e0b";
    let label = d.recognized ? d.name : "Desconhecido";
    if (d.recognized && d.confidence != null) label += `  ${Math.round(d.confidence * 100)}%`;
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);
    const pad = 6;
    const tw = ctx.measureText(label).width;
    const th = parseInt(ctx.font, 10) + pad;
    ctx.fillStyle = color;
    ctx.fillRect(x - lw / 2, Math.max(y - th, 0), tw + pad * 2, th);
    ctx.fillStyle = "#06210f";
    ctx.fillText(label, x + pad, Math.max(y - th, 0) + pad / 2);
  }
}

function updateReclist() {
  el("recCount").textContent = sessionRecognized.size;
  const list = el("reclist");
  if (!sessionRecognized.size) {
    list.innerHTML = '<span class="muted" style="font-size:.88rem;">Ninguém reconhecido ainda.</span>';
    return;
  }
  list.innerHTML = "";
  for (const name of [...sessionRecognized].sort()) {
    const tag = document.createElement("span");
    tag.className = "rectag";
    tag.textContent = name;
    list.appendChild(tag);
  }
}

function setStatus(live, text) {
  el("led").classList.toggle("live", live);
  el("statusText").textContent = text;
}

// ---- ETAPA 2: revisão -------------------------------------------------
el("toReview").addEventListener("click", async () => {
  if (!students.length) { try { await loadStudents(); } catch (_) {} }
  if (!students.length) { toast("Cadastre alunos antes de fazer a chamada.", "err"); return; }
  recognizing = false;
  stopCamera(camStream);
  camStream = null;
  clearOverlay();
  el("camToggle").textContent = "Iniciar câmera";
  el("camPlaceholder").hidden = false;
  buildReview();
  goStep(2);
});

el("backToCam").addEventListener("click", () => { goStep(1); });

function buildReview() {
  currentDate = todayISO();
  el("reviewDate").textContent = formatDateBR(currentDate);
  const body = el("reviewBody");
  body.innerHTML = "";
  const sorted = [...students].sort((a, b) => a.name.localeCompare(b.name));
  for (const s of sorted) {
    const recognized = sessionRecognized.has(s.name);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><div class="name-cell"><img class="avatar" src="${s.photo_url}" alt="">${s.name}</div></td>
      <td>${recognized
        ? '<span class="badge present">Sim</span>'
        : '<span class="badge absent">Não</span>'}</td>
      <td style="text-align:right;">
        <label class="switch">
          <input type="checkbox" data-name="${s.name}" ${recognized ? "checked" : ""}>
          <span class="slider"></span>
        </label>
      </td>`;
    body.appendChild(tr);
  }
  body.querySelectorAll("input[type=checkbox]").forEach((cb) =>
    cb.addEventListener("change", updateReviewStats));
  updateReviewStats();
}

function reviewChecks() {
  return [...el("reviewBody").querySelectorAll("input[type=checkbox]")];
}

function updateReviewStats() {
  const checks = reviewChecks();
  const present = checks.filter((c) => c.checked).length;
  el("stPresent").textContent = present;
  el("stAbsent").textContent = checks.length - present;
  el("stTotal").textContent = checks.length;
}

el("markAll").addEventListener("click", () => {
  reviewChecks().forEach((c) => (c.checked = true));
  updateReviewStats();
});
el("clearAll").addEventListener("click", () => {
  reviewChecks().forEach((c) => (c.checked = false));
  updateReviewStats();
});

// ---- confirmar --------------------------------------------------------
el("confirm").addEventListener("click", async () => {
  const present = reviewChecks().filter((c) => c.checked).map((c) => c.dataset.name);
  const btn = el("confirm");
  btn.disabled = true; btn.textContent = "Salvando…";
  try {
    const att = await postJSON("/api/attendance/confirm", { present, date: currentDate });
    buildSummary(att);
    goStep(3);
    toast("Chamada confirmada e salva.", "ok");
  } catch (err) {
    toast(err.message, "err");
  } finally {
    btn.disabled = false; btn.textContent = "Confirmar chamada";
  }
});

// ---- ETAPA 3: resumo --------------------------------------------------
function buildSummary(att) {
  const rows = att.students || [];
  const present = rows.filter((r) => r.present).length;
  el("summaryText").textContent =
    `${formatDateBR(att.date)} — ${present} de ${rows.length} alunos presentes.`;
  const body = el("summaryBody");
  body.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.name}</td>
      <td>${r.present
        ? '<span class="badge present">Presente</span>'
        : '<span class="badge absent">Ausente</span>'}</td>
      <td>${r.time || "—"}</td>`;
    body.appendChild(tr);
  }
}

el("newCall").addEventListener("click", () => {
  sessionRecognized.clear();
  updateReclist();
  goStep(1);
});

// ---- init -------------------------------------------------------------
window.addEventListener("beforeunload", () => { recognizing = false; stopCamera(camStream); });

goStep(1);
loadStudents().then(updateReclist).catch(() => {});
