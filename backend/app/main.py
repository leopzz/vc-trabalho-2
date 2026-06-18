"""API FastAPI da aplicação de chamada por reconhecimento facial.

Endpoints principais:
  POST   /api/students            -> cadastra aluno (nome + várias fotos)
  GET    /api/students            -> lista alunos cadastrados
  DELETE /api/students/{id}       -> remove aluno
  GET    /api/students/{id}/photo -> retorna a foto do aluno
  POST   /api/detect              -> detecta rostos (guia de posicionamento)
  POST   /api/recognize           -> reconhece rostos em um frame (sem salvar)
  GET    /api/attendance          -> lista de chamada de uma data
  POST   /api/attendance/confirm  -> confirma/salva a chamada revisada
  POST   /api/attendance/reset    -> zera a chamada de uma data

O reconhecimento NÃO grava presença automaticamente: ele apenas identifica os
rostos. A presença só é persistida quando o professor revisa e confirma a
chamada (POST /api/attendance/confirm).

O frontend estático é servido na raiz "/".
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, face_engine, imaging, storage

config.ensure_dirs()

app = FastAPI(
    title="Chamada por Reconhecimento Facial",
    description="Detecção com Haarcascade (OpenCV) + reconhecimento com DeepFace.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Modelos de entrada
# ---------------------------------------------------------------------------

class EnrollPayload(BaseModel):
    name: str
    images: List[str]            # lista de Data URLs (várias poses do rosto)


class ImagePayload(BaseModel):
    image: str                   # Data URL única


class RecognizePayload(BaseModel):
    image: str
    date: Optional[str] = None


class ConfirmPayload(BaseModel):
    present: List[str]           # nomes marcados como presentes
    date: Optional[str] = None


# ---------------------------------------------------------------------------
# Cadastro de alunos
# ---------------------------------------------------------------------------

@app.post("/api/students")
async def create_student(payload: EnrollPayload):
    """Cadastra um aluno a partir de VÁRIAS fotos (poses diferentes).

    Para cada foto: detecta o rosto (Haarcascade), recorta e extrai o
    embedding (DeepFace). Guardamos todos os embeddings válidos — isso deixa o
    reconhecimento bem mais robusto a variações de ângulo e iluminação.
    """
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="O nome é obrigatório.")
    if not payload.images:
        raise HTTPException(status_code=400, detail="Nenhuma foto foi enviada.")

    embeddings: List[list] = []
    thumbnail = None

    for data_url in payload.images:
        try:
            image = imaging.data_url_to_bgr(data_url)
        except Exception:  # noqa: BLE001 - foto inválida, ignora
            continue

        faces = face_engine.detect_faces(image)
        if not faces:
            continue

        largest = max(faces, key=lambda b: b[2] * b[3])
        face_crop = face_engine.crop_face(image, largest)

        try:
            embedding = face_engine.get_embedding(face_crop)
        except Exception:  # noqa: BLE001 - rosto ruim, ignora
            continue

        embeddings.append(embedding.tolist())
        if thumbnail is None:           # usa a 1ª foto válida como miniatura
            thumbnail = face_crop

    if len(embeddings) < config.MIN_VALID_CAPTURES:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Detectamos rosto em apenas {len(embeddings)} foto(s) "
                f"(mínimo {config.MIN_VALID_CAPTURES}). Refaça a captura com "
                "boa iluminação e o rosto dentro do guia."
            ),
        )

    safe_name = "".join(c if c.isalnum() else "_" for c in name).strip("_").lower()
    filename = f"{safe_name or 'aluno'}.jpg"
    imaging.save_jpeg(thumbnail, config.STUDENTS_DIR / filename)

    student = storage.add_student(name, filename, embeddings)
    return {
        "id": student["id"],
        "name": student["name"],
        "captures": len(embeddings),
        "photo_url": f"/api/students/{student['id']}/photo",
        "message": f"Aluno '{name}' cadastrado com {len(embeddings)} foto(s).",
    }


def _capture_count(student: dict) -> int:
    if "embeddings" in student:
        return len(student["embeddings"])
    return 1 if "embedding" in student else 0


@app.get("/api/students")
async def list_students():
    students = storage.load_students()
    return [
        {
            "id": s["id"],
            "name": s["name"],
            "captures": _capture_count(s),
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
# Detecção ao vivo (guia de posicionamento durante a captura)
# ---------------------------------------------------------------------------

@app.post("/api/detect")
async def detect(payload: ImagePayload):
    """Detecta rostos em um frame e devolve as caixas + tamanho da imagem.

    Usado pelo wizard de cadastro para dar feedback em tempo real ("rosto bem
    posicionado") sem precisar rodar o DeepFace, que é mais pesado.
    """
    try:
        image = imaging.data_url_to_bgr(payload.image)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Imagem inválida: {exc}")

    h, w = image.shape[:2]
    faces = face_engine.detect_faces(image)
    return {
        "width": w,
        "height": h,
        "faces": [{"x": x, "y": y, "w": fw, "h": fh} for (x, y, fw, fh) in faces],
    }


# ---------------------------------------------------------------------------
# Reconhecimento (NÃO persiste presença)
# ---------------------------------------------------------------------------

@app.post("/api/recognize")
async def recognize(payload: RecognizePayload):
    """Recebe um frame da webcam e identifica os rostos.

    Retorna as caixas detectadas com nome/confiança. A presença NÃO é salva
    aqui — o frontend acumula os reconhecidos e o professor confirma depois.
    """
    try:
        image = imaging.data_url_to_bgr(payload.image)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Imagem inválida: {exc}")

    students = storage.load_students()
    faces = face_engine.detect_faces(image)

    detections = []
    for box in faces:
        x, y, w, h = box
        result = {
            "box": {"x": x, "y": y, "w": w, "h": h},
            "name": None,
            "recognized": False,
            "confidence": None,
        }
        if students:
            face_crop = face_engine.crop_face(image, box)
            try:
                embedding = face_engine.get_embedding(face_crop)
            except Exception:  # noqa: BLE001
                detections.append(result)
                continue
            match, distance = face_engine.find_best_match(embedding, students)
            if match is not None:
                result["name"] = match["name"]
                result["recognized"] = True
                # Confiança aproximada (0..1) a partir da distância e do limiar.
                conf = max(0.0, 1.0 - distance / config.RECOGNITION_THRESHOLD)
                result["confidence"] = round(conf, 3)
        detections.append(result)

    recognized_names = sorted({d["name"] for d in detections if d["recognized"]})
    return {
        "faces_detected": len(faces),
        "detections": detections,
        "recognized": recognized_names,
    }


# ---------------------------------------------------------------------------
# Chamada / Presença
# ---------------------------------------------------------------------------

@app.get("/api/attendance")
async def get_attendance(date: Optional[str] = None):
    return storage.attendance_for_date(date)


@app.post("/api/attendance/confirm")
async def confirm_attendance(payload: ConfirmPayload):
    """Persiste a chamada revisada pelo professor."""
    return storage.confirm_attendance(payload.present, payload.date)


@app.post("/api/attendance/reset")
async def reset_attendance(date: Optional[str] = None):
    return storage.reset_attendance(date)


@app.get("/api/health")
async def health():
    return {"status": "ok", "model": config.DEEPFACE_MODEL}


# ---------------------------------------------------------------------------
# Frontend estático (montado por último para não capturar /api/*)
# ---------------------------------------------------------------------------

if config.FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIR), html=True), name="frontend")
