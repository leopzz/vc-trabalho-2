"""API FastAPI da aplicação de chamada por reconhecimento facial.

Endpoints principais:
  POST   /api/students            -> cadastra aluno (nome + foto)
  GET    /api/students            -> lista alunos cadastrados
  DELETE /api/students/{id}       -> remove aluno
  GET    /api/students/{id}/photo -> retorna a foto recortada do aluno
  POST   /api/recognize           -> recebe um frame, detecta + reconhece rostos
  GET    /api/attendance          -> lista de chamada de uma data
  POST   /api/attendance/reset    -> zera a chamada de uma data

O frontend estático é servido na raiz "/".
"""
from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, face_engine, imaging, storage

config.ensure_dirs()

app = FastAPI(
    title="Chamada por Reconhecimento Facial",
    description="Detecção com Haarcascade (OpenCV) + reconhecimento com DeepFace.",
    version="1.0.0",
)

# Libera o frontend para chamar a API (útil em desenvolvimento, caso o
# frontend seja servido por outra porta).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Modelos de dados (entrada/saída)
# ---------------------------------------------------------------------------

class RecognizePayload(BaseModel):
    image: str          # Data URL (data:image/jpeg;base64,...)
    date: Optional[str] = None


# ---------------------------------------------------------------------------
# Cadastro de alunos
# ---------------------------------------------------------------------------

@app.post("/api/students")
async def create_student(name: str = Form(...), photo: UploadFile = File(...)):
    """Cadastra um aluno: detecta o rosto na foto e armazena o embedding."""
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="O nome é obrigatório.")

    raw = await photo.read()
    try:
        image = imaging.bytes_to_bgr(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # 1) Detecção com Haarcascade.
    faces = face_engine.detect_faces(image)
    if not faces:
        raise HTTPException(
            status_code=422,
            detail="Nenhum rosto detectado na foto. Tente uma foto mais nítida e frontal.",
        )

    # Usa o maior rosto (área) — geralmente o aluno em primeiro plano.
    largest = max(faces, key=lambda b: b[2] * b[3])
    face_crop = face_engine.crop_face(image, largest)

    # 2) Embedding com DeepFace.
    try:
        embedding = face_engine.get_embedding(face_crop)
    except Exception as exc:  # noqa: BLE001 - erro do DeepFace
        raise HTTPException(status_code=500, detail=f"Falha ao processar o rosto: {exc}")

    # 3) Salva a foto recortada e registra o aluno.
    safe_name = "".join(c if c.isalnum() else "_" for c in name).strip("_").lower()
    filename = f"{safe_name or 'aluno'}.jpg"
    imaging.save_jpeg(face_crop, config.STUDENTS_DIR / filename)

    student = storage.add_student(name, filename, embedding.tolist())
    return {
        "id": student["id"],
        "name": student["name"],
        "photo_url": f"/api/students/{student['id']}/photo",
        "message": f"Aluno '{name}' cadastrado com sucesso.",
    }


@app.get("/api/students")
async def list_students():
    students = storage.load_students()
    return [
        {
            "id": s["id"],
            "name": s["name"],
            "photo_url": f"/api/students/{s['id']}/photo",
            "created_at": s.get("created_at"),
        }
        for s in students
    ]


@app.get("/api/students/{student_id}/photo")
async def get_student_photo(student_id: int):
    students = storage.load_students()
    student = next((s for s in students if s["id"] == student_id), None)
    if student is None:
        raise HTTPException(status_code=404, detail="Aluno não encontrado.")
    path = config.STUDENTS_DIR / student["photo"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Foto não encontrada.")
    return FileResponse(path, media_type="image/jpeg")


@app.delete("/api/students/{student_id}")
async def remove_student(student_id: int):
    if not storage.delete_student(student_id):
        raise HTTPException(status_code=404, detail="Aluno não encontrado.")
    return {"message": "Aluno removido."}


# ---------------------------------------------------------------------------
# Reconhecimento / Chamada
# ---------------------------------------------------------------------------

@app.post("/api/recognize")
async def recognize(payload: RecognizePayload):
    """Recebe um frame da webcam, detecta rostos e marca presença.

    Retorna as caixas detectadas (com nome/confiança) e a lista de chamada
    atualizada, permitindo ao frontend desenhar os retângulos e atualizar a
    tabela em tempo real.
    """
    try:
        image = imaging.data_url_to_bgr(payload.image)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Imagem inválida: {exc}")

    students = storage.load_students()
    faces = face_engine.detect_faces(image)

    detections = []
    newly_present = []

    for box in faces:
        x, y, w, h = box
        result = {
            "box": {"x": x, "y": y, "w": w, "h": h},
            "name": None,
            "recognized": False,
            "distance": None,
        }

        if students:
            face_crop = face_engine.crop_face(image, box)
            try:
                embedding = face_engine.get_embedding(face_crop)
            except Exception:  # noqa: BLE001 - rosto ruim, ignora
                detections.append(result)
                continue

            match, distance = face_engine.find_best_match(embedding, students)
            result["distance"] = round(distance, 4)
            if match is not None:
                result["name"] = match["name"]
                result["recognized"] = True
                if storage.mark_present(match["name"], payload.date):
                    newly_present.append(match["name"])

        detections.append(result)

    return {
        "faces_detected": len(faces),
        "detections": detections,
        "newly_present": newly_present,
        "attendance": storage.attendance_for_date(payload.date),
    }


@app.get("/api/attendance")
async def get_attendance(date: Optional[str] = None):
    return storage.attendance_for_date(date)


@app.post("/api/attendance/reset")
async def reset_attendance(date: Optional[str] = None):
    """Zera a chamada de uma data (padrão: hoje)."""
    import json
    from datetime import datetime

    attendance = storage.load_attendance()
    date = date or datetime.now().strftime("%Y-%m-%d")
    if date in attendance:
        attendance[date] = {}
        with open(config.ATTENDANCE_DB, "w", encoding="utf-8") as f:
            json.dump(attendance, f, ensure_ascii=False, indent=2)
    return storage.attendance_for_date(date)


@app.get("/api/health")
async def health():
    return {"status": "ok", "model": config.DEEPFACE_MODEL}


# ---------------------------------------------------------------------------
# Frontend estático (deve ser montado por último para não capturar /api/*)
# ---------------------------------------------------------------------------

if config.FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIR), html=True), name="frontend")
