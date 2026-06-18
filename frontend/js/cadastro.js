// Wizard de cadastro: Dados -> Captura guiada -> Revisão.

// Roteiro de poses (10 fotos): frente + laterais + inclinações.
// `require: true` => espera o rosto estar bem posicionado antes de capturar.
const POSES = [
  { text: "Olhe para a câmera", require: true },
  { text: "Olhe para a câmera", require: true },
  { text: "Olhe para a câmera", require: true },
  { text: "Vire o rosto levemente para a sua ESQUERDA", require: false },
  { text: "Vire o rosto levemente para a sua ESQUERDA", require: false },
  { text: "Vire o rosto levemente para a sua DIREITA", require: false },
  { text: "Vire o rosto levemente para a sua DIREITA", require: false },
  { text: "Levante levemente o queixo", require: false },
  { text: "Abaixe levemente o queixo", require: false },
  { text: "Sorria, olhando para a câmera", require: true },
];

// ---- elementos --------------------------------------------------------
const el = (id) => document.getElementById(id);
const nameInput = el("name");
const video = el("video");
const guide = el("guide");
const poseEl = el("pose");
const chip = el("chip");
const chipText = el("chipText");
const countdown = el("countdown");
const flash = el("flash");
const camPlaceholder = el("camPlaceholder");
const progBar = el("progBar");
const progLabel = el("progLabel");
const progPct = el("progPct");
const captureHint = el("captureHint");
const startBtn = el("startCapture");

// ---- estado -----------------------------------------------------------
let camStream = null;
let captures = [];        // Data URLs que serão enviadas (webcam ou upload)
let uploadCaptures = [];  // Data URLs escolhidas no modo upload
let capturing = false;    // sequência de captura em andamento
let idleLoop = false;     // loop de detecção ocioso ativo
let studentName = "";
let mode = "webcam";      // "webcam" | "upload"

// ---- navegação entre etapas ------------------------------------------
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

// ETAPA 1 -> 2
el("toStep2").addEventListener("click", async () => {
  studentName = nameInput.value.trim();
  if (!studentName) { toast("Informe o nome do aluno.", "err"); nameInput.focus(); return; }
  goStep(2);
  await setMode("webcam");
});

el("backTo1").addEventListener("click", () => { leaveCaptureStep(); goStep(1); });
el("backTo1b").addEventListener("click", () => { leaveCaptureStep(); goStep(1); });

// ---- alternância webcam / upload -------------------------------------
document.querySelectorAll("#modeSwitch .seg").forEach((btn) =>
  btn.addEventListener("click", () => setMode(btn.dataset.mode)));

async function setMode(m) {
  mode = m;
  document.querySelectorAll("#modeSwitch .seg").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === m));
  el("webcamMode").hidden = m !== "webcam";
  el("uploadMode").hidden = m !== "upload";
  if (m === "webcam") {
    resetUpload();
    await enterCaptureStep();
  } else {
    leaveCaptureStep();
    resetUpload();
  }
}

// ---- modo upload ------------------------------------------------------
const fileInput = el("fileInput");
const uploadbox = el("uploadbox");

el("pickFiles").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
uploadbox.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => handleFiles(fileInput.files));

["dragenter", "dragover"].forEach((ev) =>
  uploadbox.addEventListener(ev, (e) => { e.preventDefault(); uploadbox.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) =>
  uploadbox.addEventListener(ev, (e) => { e.preventDefault(); uploadbox.classList.remove("drag"); }));
uploadbox.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function handleFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/"));
  for (const f of files) {
    try { uploadCaptures.push(await readFileAsDataURL(f)); } catch (_) {}
  }
  renderUploadThumbs();
}

function renderUploadThumbs() {
  const box = el("uploadThumbs");
  box.innerHTML = "";
  uploadCaptures.forEach((src, i) => {
    const div = document.createElement("div");
    div.className = "thumb";
    div.innerHTML = `<img src="${src}" alt="foto" />`;
    div.title = "Clique para remover";
    div.style.cursor = "pointer";
    div.addEventListener("click", () => { uploadCaptures.splice(i, 1); renderUploadThumbs(); });
    box.appendChild(div);
  });
  el("uploadContinue").disabled = uploadCaptures.length === 0;
}

function resetUpload() {
  uploadCaptures = [];
  fileInput.value = "";
  renderUploadThumbs();
}

el("uploadContinue").addEventListener("click", () => {
  if (!uploadCaptures.length) { toast("Selecione ao menos uma foto.", "err"); return; }
  captures = uploadCaptures.slice();
  goReview();
});

// ---- ETAPA 2: câmera + detecção ao vivo ------------------------------
async function enterCaptureStep() {
  resetCapture();
  try {
    camStream = await startCamera(video);
    camPlaceholder.hidden = true;
    guide.hidden = false;
    chip.hidden = false;
    poseEl.hidden = true;
    startIdleDetect();
  } catch (err) {
    camPlaceholder.hidden = false;
    camPlaceholder.textContent = "Não foi possível acessar a câmera. Verifique as permissões do navegador.";
    toast("Falha ao acessar a câmera: " + err.message, "err");
  }
}

function leaveCaptureStep() {
  idleLoop = false;
  capturing = false;
  stopCamera(camStream);
  camStream = null;
}

function resetCapture() {
  captures = [];
  updateProgress();
  startBtn.hidden = false;
  startBtn.disabled = false;
  captureHint.textContent = "Posicione o rosto e inicie a captura.";
  poseEl.hidden = true;
  countdown.hidden = true;
}

// Detecta o rosto no frame atual e atualiza o guia/indicador.
async function detectNow() {
  if (!camStream || !video.videoWidth) return { ok: false };
  let placement = { ok: false, reason: "Procurando rosto…" };
  try {
    const frame = captureFrame(video, 0.5);
    const det = await postJSON("/api/detect", { image: frame });
    placement = evaluatePlacement(det);
  } catch (_) { /* ignora falhas pontuais */ }
  guide.classList.toggle("ok", placement.ok);
  chip.classList.toggle("ok", placement.ok);
  chipText.textContent = placement.reason;
  return placement;
}

// Loop de detecção enquanto a câmera está ligada e sem captura em curso.
async function startIdleDetect() {
  if (idleLoop) return;
  idleLoop = true;
  while (idleLoop) {
    if (!capturing && !el("s2").hidden) await detectNow();
    await sleep(450);
  }
}

// ---- sequência de captura --------------------------------------------
startBtn.addEventListener("click", runCaptureSequence);

async function runCaptureSequence() {
  if (capturing) return;
  if (!camStream || !video.videoWidth) { toast("A câmera não está pronta.", "err"); return; }
  capturing = true;
  startBtn.hidden = true;
  poseEl.hidden = false;
  captures = [];
  updateProgress();

  for (let i = 0; i < POSES.length; i++) {
    const pose = POSES[i];
    poseEl.textContent = `${i + 1}/${POSES.length} — ${pose.text}`;
    captureHint.textContent = pose.text;

    // Em poses frontais, espera o rosto ficar bem posicionado (com timeout).
    if (pose.require) {
      chipText.textContent = "Posicione o rosto no guia…";
      const ok = await waitForPlacement(6000);
      if (!ok) chipText.textContent = "Capturando assim mesmo…";
    } else {
      await sleep(900); // tempo para o aluno ajustar a pose lateral
    }

    await doCountdown(3);
    captures.push(captureFrame(video, 0.85));
    triggerFlash();
    updateProgress();
    await sleep(550);
  }

  countdown.hidden = true;
  poseEl.hidden = true;
  capturing = false;
  goReview();
}

function waitForPlacement(timeoutMs) {
  return new Promise(async (resolve) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const p = await detectNow();
      if (p.ok) { resolve(true); return; }
      await sleep(300);
    }
    resolve(false);
  });
}

async function doCountdown(from) {
  countdown.hidden = false;
  for (let n = from; n >= 1; n--) {
    countdown.textContent = n;
    await sleep(650);
  }
  countdown.hidden = true;
}

function triggerFlash() {
  flash.classList.add("go");
  setTimeout(() => flash.classList.remove("go"), 360);
}

function updateProgress() {
  const total = POSES.length;
  const n = captures.length;
  const pct = Math.round((n / total) * 100);
  progBar.style.width = pct + "%";
  progLabel.textContent = `${n} de ${total} fotos`;
  progPct.textContent = pct + "%";
}

// ---- ETAPA 3: revisão -------------------------------------------------
function goReview() {
  el("reviewName").textContent = studentName;
  el("reviewCount").textContent = captures.length;
  const thumbs = el("thumbs");
  thumbs.innerHTML = "";
  for (const src of captures) {
    const div = document.createElement("div");
    div.className = "thumb";
    div.innerHTML = `<img src="${src}" alt="captura" />`;
    thumbs.appendChild(div);
  }
  goStep(3);
}

el("redo").addEventListener("click", async () => {
  goStep(2);
  await setMode(mode);
});

el("finish").addEventListener("click", async () => {
  const finishBtn = el("finish");
  finishBtn.disabled = true;
  finishBtn.textContent = "Processando…";
  try {
    const res = await postJSON("/api/students", { name: studentName, images: captures });
    toast(res.message || "Aluno cadastrado!", "ok");
    leaveCaptureStep();
    nameInput.value = "";
    studentName = "";
    captures = [];
    goStep(1);
    await loadStudents();
  } catch (err) {
    toast(err.message, "err");
  } finally {
    finishBtn.disabled = false;
    finishBtn.textContent = "Concluir cadastro";
  }
});

// ---- lista de alunos --------------------------------------------------
async function loadStudents() {
  try {
    const students = await api("/api/students");
    el("count").textContent = students.length;
    const list = el("list");
    list.innerHTML = "";
    if (!students.length) {
      list.innerHTML = '<div class="empty">Nenhum aluno cadastrado ainda.</div>';
      return;
    }
    for (const s of students) {
      const card = document.createElement("div");
      card.className = "student";
      card.innerHTML = `
        <img src="${s.photo_url}" alt="${s.name}" />
        <div class="name">${s.name}</div>
        <div class="meta">${s.captures} foto(s)</div>
        <button class="btn btn-soft-danger btn-block" data-id="${s.id}">Remover</button>`;
      card.querySelector("button").addEventListener("click", () => removeStudent(s.id, s.name));
      list.appendChild(card);
    }
  } catch (err) {
    toast("Falha ao carregar alunos: " + err.message, "err");
  }
}

async function removeStudent(id, name) {
  if (!confirm(`Remover o aluno "${name}"?`)) return;
  try {
    await api(`/api/students/${id}`, { method: "DELETE" });
    toast("Aluno removido.", "ok");
    await loadStudents();
  } catch (err) {
    toast(err.message, "err");
  }
}

window.addEventListener("beforeunload", leaveCaptureStep);

goStep(1);
loadStudents();
