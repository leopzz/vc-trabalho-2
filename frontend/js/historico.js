// Histórico de chamadas: lista de dias + detalhe do dia selecionado.

const el = (id) => document.getElementById(id);
let selectedDate = null;

async function loadDays() {
  const days = el("daysList");
  try {
    const dates = await api("/api/attendance/dates");
    if (!dates.length) {
      days.innerHTML = '<div class="empty">Nenhuma chamada registrada ainda.</div>';
      return;
    }
    days.innerHTML = "";
    for (const d of dates) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "day-item";
      row.dataset.date = d.date;
      row.innerHTML = `
        <span class="day-date">${formatDateBR(d.date)}</span>
        <span class="badge present">${d.present} presente${d.present === 1 ? "" : "s"}</span>`;
      row.addEventListener("click", () => selectDay(d.date));
      days.appendChild(row);
    }
    // Seleciona automaticamente o dia mais recente.
    selectDay(dates[0].date);
  } catch (err) {
    days.innerHTML = `<div class="empty">Falha ao carregar: ${err.message}</div>`;
  }
}

async function selectDay(date) {
  selectedDate = date;
  document.querySelectorAll(".day-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.date === date));
  el("detailTitle").textContent = "Chamada de " + formatDateBR(date);
  el("resetDay").hidden = false;
  const detail = el("detail");
  detail.innerHTML = '<div class="empty">Carregando…</div>';
  try {
    const att = await api("/api/attendance?date=" + encodeURIComponent(date));
    renderDetail(att);
  } catch (err) {
    detail.innerHTML = `<div class="empty">Erro: ${err.message}</div>`;
  }
}

function renderDetail(att) {
  const rows = att.students || [];
  const present = rows.filter((r) => r.present).length;
  const absent = rows.length - present;

  let html = `
    <div class="stats">
      <div class="stat"><b>${present}</b><span>Presentes</span></div>
      <div class="stat"><b>${absent}</b><span>Ausentes</span></div>
      <div class="stat"><b>${rows.length}</b><span>Total</span></div>
    </div>`;

  if (!rows.length) {
    html += '<div class="empty">Nenhum aluno registrado neste dia.</div>';
    el("detail").innerHTML = html;
    return;
  }

  html += '<table><thead><tr><th>Aluno</th><th>Situação</th><th>Horário</th></tr></thead><tbody>';
  for (const r of rows) {
    html += `<tr>
      <td>${r.name}</td>
      <td>${r.present
        ? '<span class="badge present">Presente</span>'
        : '<span class="badge absent">Ausente</span>'}</td>
      <td>${r.time || "—"}</td>
    </tr>`;
  }
  html += "</tbody></table>";
  el("detail").innerHTML = html;
}

el("resetDay").addEventListener("click", async () => {
  if (!selectedDate) return;
  if (!confirm(`Zerar a chamada de ${formatDateBR(selectedDate)}? Esta ação não pode ser desfeita.`)) return;
  try {
    await api("/api/attendance/reset?date=" + encodeURIComponent(selectedDate), { method: "POST" });
    toast("Chamada zerada.", "ok");
    await loadDays();
  } catch (err) {
    toast(err.message, "err");
  }
});

loadDays();
