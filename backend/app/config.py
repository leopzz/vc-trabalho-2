"""Configurações centrais da aplicação.

Todos os caminhos e parâmetros do reconhecimento ficam aqui para facilitar
ajustes sem precisar mexer no restante do código.
"""
from pathlib import Path

# Diretório raiz do backend (pasta que contém a pasta "app").
BASE_DIR = Path(__file__).resolve().parent.parent

# Onde os dados persistentes ficam armazenados.
DATA_DIR = BASE_DIR / "data"
STUDENTS_DIR = DATA_DIR / "students"          # fotos recortadas dos alunos
STUDENTS_DB = DATA_DIR / "students.json"        # nome + embedding facial
ATTENDANCE_DB = DATA_DIR / "attendance.json"    # registros de presença

# Pasta com o frontend estático (HTML/CSS/JS).
FRONTEND_DIR = BASE_DIR.parent / "frontend"

# ---------------------------------------------------------------------------
# Parâmetros de Visão Computacional
# ---------------------------------------------------------------------------

# Modelo usado pelo DeepFace para extrair o "embedding" (vetor de
# características) de cada rosto. Facenet512 oferece bom equilíbrio entre
# precisão e velocidade.
DEEPFACE_MODEL = "Facenet512"

# Métrica de comparação entre embeddings.
DISTANCE_METRIC = "cosine"

# Limiar de distância: faces com distância MENOR que esse valor são
# consideradas a mesma pessoa. Para Facenet512 + cosseno, ~0.30 é um valor
# conservador (poucos falsos positivos).
RECOGNITION_THRESHOLD = 0.30

# Parâmetros do detector Haarcascade (OpenCV).
HAAR_SCALE_FACTOR = 1.1
HAAR_MIN_NEIGHBORS = 6
HAAR_MIN_SIZE = (60, 60)

# Cadastro: número mínimo de fotos válidas (rosto detectado) exigido para
# concluir o cadastro de um aluno. O wizard captura ~10 fotos em poses
# diferentes; algumas podem falhar na detecção e tudo bem.
MIN_VALID_CAPTURES = 4



def ensure_dirs() -> None:
    """Garante que os diretórios de dados existam."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STUDENTS_DIR.mkdir(parents=True, exist_ok=True)
