"""Persistência simples baseada em arquivos JSON.

Para um projeto acadêmico, um banco JSON é suficiente e transparente.
  * students.json  -> lista de alunos com nome, arquivo da foto e embedding.
  * attendance.json -> presenças por data: { "2026-06-18": { "Ana": "08:01:22" } }
"""
from __future__ import annotations

import json
import threading
from datetime import datetime
from typing import Dict, List

from . import config

# Lock para evitar condições de corrida ao gravar (FastAPI é assíncrono).
_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Utilitários genéricos de leitura/escrita JSON
# ---------------------------------------------------------------------------

def _read_json(path, default):
    if not path.exists():
        return default
    with open(path, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return default


def _write_json(path, data) -> None:
    config.ensure_dirs()
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(path)  # escrita atômica


# ---------------------------------------------------------------------------
# Alunos
# ---------------------------------------------------------------------------

def load_students() -> List[dict]:
    return _read_json(config.STUDENTS_DB, [])


def save_students(students: List[dict]) -> None:
    _write_json(config.STUDENTS_DB, students)


def add_student(name: str, photo_filename: str,
                embeddings: List[List[float]]) -> dict:
    """Adiciona (ou atualiza) um aluno na base.

    ``embeddings`` é uma LISTA de vetores (um por foto capturada). Guardar
    várias poses do rosto torna o reconhecimento muito mais robusto.
    """
    with _lock:
        students = load_students()
        # Se já existe um aluno com o mesmo nome, atualizamos foto/embeddings.
        for student in students:
            if student["name"].lower() == name.lower():
                student["photo"] = photo_filename
                student["embeddings"] = embeddings
                student["created_at"] = datetime.now().isoformat(timespec="seconds")
                save_students(students)
                return student

        student = {
            "id": _next_id(students),
            "name": name,
            "photo": photo_filename,
            "embeddings": embeddings,
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
        students.append(student)
        save_students(students)
        return student


def delete_student(student_id: int) -> bool:
    with _lock:
        students = load_students()
        new_students = [s for s in students if s["id"] != student_id]
        if len(new_students) == len(students):
            return False
        save_students(new_students)
        return True


def _next_id(students: List[dict]) -> int:
    return max((s["id"] for s in students), default=0) + 1


# ---------------------------------------------------------------------------
# Presença / Chamada
# ---------------------------------------------------------------------------

def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def load_attendance() -> Dict[str, Dict[str, str]]:
    return _read_json(config.ATTENDANCE_DB, {})


def confirm_attendance(present_names: List[str],
                       date: str | None = None) -> dict:
    """Confirma (persiste) a chamada de uma data.

    Sobrescreve o registro do dia com a lista revisada pelo professor. Os
    alunos que já tinham horário registrado mantêm o horário; os novos
    recebem o horário atual.
    """
    date = date or _today()
    names = set(present_names)
    with _lock:
        attendance = load_attendance()
        previous = attendance.get(date, {})
        now = datetime.now().strftime("%H:%M:%S")
        day = {name: previous.get(name, now) for name in names}
        attendance[date] = day
        _write_json(config.ATTENDANCE_DB, attendance)
    return attendance_for_date(date)


def reset_attendance(date: str | None = None) -> dict:
    """Zera a chamada de uma data."""
    date = date or _today()
    with _lock:
        attendance = load_attendance()
        attendance[date] = {}
        _write_json(config.ATTENDANCE_DB, attendance)
    return attendance_for_date(date)


def list_attendance_dates() -> List[dict]:
    """Lista as datas que possuem chamada registrada (mais recentes primeiro).

    Retorna ``[{"date": "2026-06-18", "present": 12}, ...]``.
    """
    attendance = load_attendance()
    items = [{"date": d, "present": len(names)} for d, names in attendance.items()]
    items.sort(key=lambda x: x["date"], reverse=True)
    return items


def attendance_for_date(date: str | None = None) -> dict:
    """Monta a lista de chamada de uma data, cruzando com todos os alunos.

    Inclui também nomes que foram marcados presentes naquele dia mas que não
    estão mais na turma (alunos removidos depois), para o histórico ficar fiel.

    Retorna algo como:
        {
          "date": "2026-06-18",
          "students": [
            {"name": "Ana", "present": true,  "time": "08:01:22"},
            {"name": "Bob", "present": false, "time": null}
          ]
        }
    """
    date = date or _today()
    students = load_students()
    day = load_attendance().get(date, {})

    rows = []
    current_names = set()
    for student in sorted(students, key=lambda s: s["name"].lower()):
        name = student["name"]
        current_names.add(name)
        rows.append({
            "name": name,
            "present": name in day,
            "time": day.get(name),
        })

    # Presentes que não estão mais na turma atual.
    for name in sorted(n for n in day if n not in current_names):
        rows.append({"name": name, "present": True, "time": day.get(name)})

    return {"date": date, "students": rows}
