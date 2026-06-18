// Lógica da tela de cadastro de alunos.

const nameInput = document.getElementById("name");
const fileInput = document.getElementById("file");
const preview = document.getElementById("preview");
const toggleCamBtn = document.getElementById("toggleCam");
const camBlock = document.getElementById("camBlock");
const video = document.getElementById("video");
const snapBtn = document.getElementById("snap");
const saveBtn = document.getElementById("save");
const listEl = document.getElementById("list");
const countEl = document.getElementById("count");

let camStream = null;
let capturedDataUrl = null; // foto vinda da webcam (Data URL)

// --- Upload de arquivo -> pré-visualização -----------------------------
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  capturedDataUrl = null; // prioriza o arquivo escolhido
  preview.src = URL.createObjectURL(file);
  preview.style.display = "block";
});

// --- Webcam -------------------------------------------------------------
toggleCamBtn.addEventListener("click", async () => {
  if (camStream) {
    stopCamera(camStream);
    camStream = null;
    camBlock.style.display = "none";
    toggleCamBtn.textContent = "📷 Usar webcam";
    return;
  }
  try {
    camStream = await startCamera(video);
    camBlock.style.display = "block";
    toggleCamBtn.textContent = "✖ Fechar webcam";
  } catch (err) {
    toast("Não foi possível acessar a webcam: " + err.message, "err");
  }
});

snapBtn.addEventListener("click", () => {
  capturedDataUrl = captureFrame(video);
  fileInput.value = ""; // a captura tem prioridade sobre o upload
  preview.src = capturedDataUrl;
  preview.style.display = "block";
  toast("Foto capturada!", "ok");
});

// Converte uma Data URL em Blob para enviar via FormData.
function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(",");
  const mime = meta.match(/:(.*?);/)[1];
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// --- Salvar cadastro ----------------------------------------------------
saveBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) { toast("Informe o nome do aluno.", "err"); return; }

  let fileToSend = null;
  if (fileInput.files[0]) {
    fileToSend = fileInput.files[0];
  } else if (capturedDataUrl) {
    fileToSend = dataUrlToBlob(capturedDataUrl);
  } else {
    toast("Escolha uma foto ou capture pela webcam.", "err");
    return;
  }

  const form = new FormData();
  form.append("name", name);
  form.append("photo", fileToSend, "foto.jpg");

  saveBtn.disabled = true;
  saveBtn.textContent = "Processando rosto...";
  try {
    const res = await api("/api/students", { method: "POST", body: form });
    toast(res.message || "Aluno cadastrado!", "ok");
    nameInput.value = "";
    fileInput.value = "";
    capturedDataUrl = null;
    preview.style.display = "none";
    await loadStudents();
  } catch (err) {
    toast(err.message, "err");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Salvar cadastro";
  }
});

// --- Listagem -----------------------------------------------------------
async function loadStudents() {
  try {
    const students = await api("/api/students");
    countEl.textContent = students.length;
    listEl.innerHTML = "";
    if (students.length === 0) {
      listEl.innerHTML = '<p class="muted">Nenhum aluno cadastrado ainda.</p>';
      return;
    }
    for (const s of students) {
      const card = document.createElement("div");
      card.className = "student-card";
      card.innerHTML = `
        <img src="${s.photo_url}" alt="${s.name}" />
        <div class="name">${s.name}</div>
        <button class="danger" data-id="${s.id}">Remover</button>
      `;
      card.querySelector("button").addEventListener("click", () => removeStudent(s.id, s.name));
      listEl.appendChild(card);
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

// Encerra a câmera ao sair da página.
window.addEventListener("beforeunload", () => stopCamera(camStream));

loadStudents();
