"""Motor de Visão Computacional.

Responsável por:
  * Detecção de rostos usando o classificador Haarcascade (OpenCV).
  * Extração de embeddings faciais usando DeepFace.
  * Comparação de embeddings (distância de cosseno).

A separação em um módulo próprio mantém a API (main.py) enxuta e facilita
testes isolados da lógica de visão computacional.
"""
from __future__ import annotations

from typing import List, Tuple

import cv2
import numpy as np

from . import config

# ---------------------------------------------------------------------------
# Detecção de faces — Haarcascade
# ---------------------------------------------------------------------------

# Carrega o classificador uma única vez (operação relativamente cara).
_HAAR_PATH = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
_face_cascade = cv2.CascadeClassifier(_HAAR_PATH)

if _face_cascade.empty():  # pragma: no cover - falha de instalação do OpenCV
    raise RuntimeError(f"Não foi possível carregar o Haarcascade em {_HAAR_PATH}")


def detect_faces(image_bgr: np.ndarray) -> List[Tuple[int, int, int, int]]:
    """Detecta rostos em uma imagem BGR (formato do OpenCV).

    Retorna uma lista de bounding boxes no formato (x, y, w, h).
    """
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    # Equalização de histograma melhora a detecção em condições de luz ruins.
    gray = cv2.equalizeHist(gray)

    faces = _face_cascade.detectMultiScale(
        gray,
        scaleFactor=config.HAAR_SCALE_FACTOR,
        minNeighbors=config.HAAR_MIN_NEIGHBORS,
        minSize=config.HAAR_MIN_SIZE,
    )
    # detectMultiScale retorna um numpy array vazio ou Nx4.
    return [tuple(int(v) for v in box) for box in faces]


def crop_face(image_bgr: np.ndarray, box: Tuple[int, int, int, int],
              margin: float = 0.2) -> np.ndarray:
    """Recorta a região do rosto com uma pequena margem extra.

    A margem ajuda o DeepFace a alinhar melhor o rosto.
    """
    x, y, w, h = box
    mx, my = int(w * margin), int(h * margin)
    x0 = max(x - mx, 0)
    y0 = max(y - my, 0)
    x1 = min(x + w + mx, image_bgr.shape[1])
    y1 = min(y + h + my, image_bgr.shape[0])
    return image_bgr[y0:y1, x0:x1]


# ---------------------------------------------------------------------------
# Reconhecimento de faces — DeepFace
# ---------------------------------------------------------------------------

def get_embedding(face_bgr: np.ndarray) -> np.ndarray:
    """Extrai o embedding facial de uma imagem JÁ RECORTADA do rosto.

    Usamos ``detector_backend="skip"`` porque a detecção já foi feita pelo
    Haarcascade. ``enforce_detection=False`` evita exceções caso o DeepFace
    não tenha certeza de que há um rosto.
    """
    # Import tardio: o DeepFace carrega TensorFlow, que é pesado. Importar só
    # quando necessário deixa o startup da API mais rápido.
    from deepface import DeepFace

    representations = DeepFace.represent(
        img_path=face_bgr,
        model_name=config.DEEPFACE_MODEL,
        detector_backend="skip",
        enforce_detection=False,
        align=True,
    )
    # represent retorna uma lista (uma entrada por rosto). Pegamos a primeira.
    embedding = np.asarray(representations[0]["embedding"], dtype=np.float32)
    return embedding


def cosine_distance(a: np.ndarray, b: np.ndarray) -> float:
    """Distância de cosseno entre dois vetores (0 = idênticos)."""
    a = np.asarray(a, dtype=np.float32)
    b = np.asarray(b, dtype=np.float32)
    denom = (np.linalg.norm(a) * np.linalg.norm(b)) + 1e-10
    return float(1.0 - np.dot(a, b) / denom)


def _student_embeddings(student: dict) -> List[np.ndarray]:
    """Retorna a lista de embeddings de um aluno.

    Aceita tanto o formato novo (``embeddings``: lista de vetores) quanto o
    antigo (``embedding``: vetor único), por compatibilidade.
    """
    if "embeddings" in student:
        return [np.asarray(e, dtype=np.float32) for e in student["embeddings"]]
    if "embedding" in student:
        return [np.asarray(student["embedding"], dtype=np.float32)]
    return []


def find_best_match(embedding: np.ndarray,
                    students: List[dict]) -> Tuple[dict | None, float]:
    """Compara um embedding com a base de alunos.

    Para cada aluno usamos a MENOR distância entre o rosto recebido e todas as
    fotos/poses cadastradas daquele aluno. Retorna ``(aluno, distancia)`` do
    melhor candidato. Se nenhum aluno estiver abaixo do limiar, retorna
    ``(None, melhor_distancia)``.
    """
    best_student = None
    best_distance = float("inf")

    for student in students:
        for ref in _student_embeddings(student):
            dist = cosine_distance(embedding, ref)
            if dist < best_distance:
                best_distance = dist
                best_student = student

    if best_student is not None and best_distance <= config.RECOGNITION_THRESHOLD:
        return best_student, best_distance
    return None, best_distance
