"""Funções auxiliares para conversão de imagens enviadas pelo frontend."""
from __future__ import annotations

import base64
import re

import cv2
import numpy as np


def bytes_to_bgr(raw: bytes) -> np.ndarray:
    """Decodifica bytes de uma imagem (JPEG/PNG) em um array BGR do OpenCV."""
    arr = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Não foi possível decodificar a imagem enviada.")
    return image


_DATA_URL_RE = re.compile(r"^data:image/\w+;base64,")


def data_url_to_bgr(data_url: str) -> np.ndarray:
    """Decodifica uma Data URL (data:image/jpeg;base64,...) em BGR.

    O frontend captura o frame do <video> em um <canvas> e gera essa string.
    """
    cleaned = _DATA_URL_RE.sub("", data_url)
    raw = base64.b64decode(cleaned)
    return bytes_to_bgr(raw)


def save_jpeg(image_bgr: np.ndarray, path) -> None:
    """Salva uma imagem BGR como JPEG."""
    cv2.imwrite(str(path), image_bgr)
