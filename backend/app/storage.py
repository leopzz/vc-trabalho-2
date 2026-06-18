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


def add_student(name: str, photo_filename: str, embedding: List[float]) -> dict:
    """Adiciona (ou atualiza) um aluno na base."""
    with _lock:
        students = load_students()
        # Se já existe um aluno com o mesmo nome, atualizamos a foto/embedding.
        for student in students:
            if student["name"].lower() == name.lower():
                student["photo"] = photo_filename
                student["embedding"] = embedding
                save_students(students)
                return student

        student = {
            "id": _next_id(students),
            "name": name,
            "photo": photo_filename,
            "embedding": embedding,
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


def mark_present(name: str, date: str | None = None) -> bool:
    """Marca presença de um aluno. Retorna True se foi um NOVO registro."""
    date = date or _today()
    with _lock:
        attendance = load_attendance()
        day = attendance.setdefault(date, {})
        if name in day:
            return False
        day[name] = datetime.now().strftime("%H:%M:%S")
        _write_json(config.ATTENDANCE_DB, attendance)
        return True


def attendance_for_date(date: str | None = None) -> dict:
    """Monta a lista de chamada de uma data, cruzando com todos os alunos.

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
    for student in sorted(students, key=lambda s: s["name"].lower()):
        name = student["name"]
        rows.append({
            "name": name,
            "present": name in day,
            "time": day.get(name),
        })
    return {"date": date, "students": rows}
