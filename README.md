# Chamada por Reconhecimento Facial

Aplicação **web** para registro de presença (chamada) de alunos a partir da
**webcam**. A detecção de rostos é feita com o classificador **Haarcascade
(OpenCV)** e o reconhecimento facial com **DeepFace**.

> Trabalho de Visão Computacional — detecção + reconhecimento de faces aplicado
> ao registro de presença em sala de aula.

---

## Funcionalidades

- **Cadastro guiado em etapas (wizard):** informe o nome e **capture várias
  fotos** pela webcam (frente e laterais), com **guia oval de posicionamento** e
  feedback em tempo real, **ou faça o upload** de fotos do aluno.
- **Múltiplas poses por aluno:** o sistema captura ~10 fotos em ângulos
  diferentes e guarda um embedding de cada uma, tornando o reconhecimento bem
  mais robusto.
- **Detecção de rostos** com Haarcascade (OpenCV) tanto no cadastro quanto na chamada.
- **Reconhecimento facial** com DeepFace (embeddings `Facenet512` + distância de cosseno).
- **Chamada ao vivo:** vídeo com caixas desenhadas sobre cada rosto
  (verde = reconhecido com a % de confiança, laranja = desconhecido).
- **Revisão e confirmação:** o reconhecimento **não** salva presença sozinho.
  O professor revisa a lista, **edita manualmente** quem está presente e só
  então **confirma** a chamada.
- **Histórico de chamadas:** tela para consultar as chamadas anteriores
  organizadas por dia, com presentes/ausentes e horários.
- **Persistência simples em arquivos JSON** (sem necessidade de banco de dados).

---

## Arquitetura

```
vc-trabalho-2/
├── backend/                  # API (FastAPI + OpenCV + DeepFace)
│   ├── app/
│   │   ├── main.py           # rotas da API e serve o frontend
│   │   ├── face_engine.py    # Haarcascade (detecção) + DeepFace (reconhecimento)
│   │   ├── storage.py        # persistência em JSON (alunos + presenças)
│   │   ├── imaging.py        # conversão de imagens (bytes / Data URL -> OpenCV)
│   │   └── config.py         # caminhos e parâmetros do reconhecimento
│   ├── run.py                # atalho para subir o servidor
│   └── requirements.txt
└── frontend/                 # HTML/CSS/JS puro (sem build)
    ├── index.html            # página inicial
    ├── cadastro.html         # wizard de cadastro de alunos
    ├── chamada.html          # reconhecimento -> revisão -> confirmação
    ├── historico.html        # histórico de chamadas por dia
    ├── css/style.css
    └── js/{common,cadastro,chamada,historico}.js
```

### Fluxo do cadastro
1. **Etapa 1 (Dados):** informa o nome do aluno.
2. **Etapa 2 (Captura):** dois modos disponíveis —
   - **Webcam:** liga a câmera, mostra um guia oval e conduz o aluno por
     várias poses (frente, laterais, inclinações), capturando automaticamente
     com contagem regressiva; **ou**
   - **Upload:** seleção (ou arrastar-e-soltar) de uma ou mais fotos do aluno.
3. **Etapa 3 (Revisão):** as fotos capturadas são exibidas; ao concluir, todas
   são enviadas ao backend, que detecta o rosto em cada uma (Haarcascade),
   extrai o embedding (DeepFace) e guarda os embeddings válidos.

### Fluxo da chamada
1. **Reconhecimento ao vivo:** o frontend captura frames da webcam e envia para
   `POST /api/recognize`. O backend detecta os rostos (Haarcascade), extrai o
   embedding (DeepFace) e compara (distância de cosseno) com os alunos. Os
   reconhecidos vão se acumulando na sessão. **Nada é salvo ainda.**
2. **Revisão:** lista de todos os alunos; os reconhecidos já vêm marcados como
   presentes. O professor pode ajustar manualmente cada um.
3. **Confirmação:** ao confirmar, `POST /api/attendance/confirm` persiste a
   presença no JSON com o horário do registro.

---

## Instalação e Execução

### Pré-requisitos
- **Python 3.10, 3.11 ou 3.12** (testado em 3.11).
  > **Não use Python 3.13/3.14** — o TensorFlow (dependência do DeepFace) ainda
  > não tem suporte a essas versões e a instalação do numpy/tensorflow falha.
- Uma **webcam**
- Navegador moderno (Chrome, Edge ou Firefox)

> A câmera só é liberada pelo navegador em **`localhost`** ou via **HTTPS**.
> Rodando localmente em `http://localhost:8000` funciona normalmente.

### 1. Clonar o repositório
```bash
git clone https://github.com/leopzz/vc-trabalho-2.git
cd vc-trabalho-2
```

### 2. Criar o ambiente virtual e instalar as dependências

**Linux / macOS:**
```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

**Windows (PowerShell)** — garanta o Python 3.12 (`py -0` lista as versões):
```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe --version          # deve mostrar 3.12.x
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

> A **primeira chamada de reconhecimento** faz o DeepFace baixar os pesos do
> modelo `Facenet512` (~90 MB), exigindo internet nesse momento. Depois fica em
> cache (`~/.deepface`).

### 3. Iniciar o servidor
```bash
cd backend
python run.py
```
ou:
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
No Windows, sem ativar a venv, use o python dela diretamente:
```powershell
cd backend
..\.venv\Scripts\python.exe run.py
```

### 4. Abrir a aplicação
- Aplicação: **http://localhost:8000**
- Documentação da API (Swagger): **http://localhost:8000/docs**

---

## Como usar

1. **Cadastro** (aba *Cadastro*): digite o nome, clique em **Continuar** e
   escolha **Capturar pela webcam** (siga as instruções de pose) ou **Enviar
   fotos** (upload). Ao final, revise as fotos e clique em **Concluir
   cadastro**. Repita para cada aluno.
2. **Chamada** (aba *Chamada*): clique em **Iniciar câmera** e aponte para os
   alunos — os reconhecidos aparecem na lista da sessão. Clique em **Revisar
   chamada**, ajuste manualmente se necessário e clique em **Confirmar chamada**.
3. **Histórico** (aba *Histórico*): consulte as chamadas anteriores por dia,
   com presentes, ausentes e horários.

---

## Endpoints da API

| Método | Rota                              | Descrição                                       |
|--------|-----------------------------------|-------------------------------------------------|
| POST   | `/api/students`                   | Cadastra aluno (`name` + lista de `images`)     |
| GET    | `/api/students`                   | Lista alunos cadastrados                        |
| GET    | `/api/students/{id}/photo`        | Foto (miniatura) do aluno                       |
| DELETE | `/api/students/{id}`              | Remove um aluno                                 |
| POST   | `/api/detect`                     | Detecta rostos (guia de posicionamento)         |
| POST   | `/api/recognize`                  | Reconhece rostos em um frame (não salva)        |
| GET    | `/api/attendance?date=YYYY-MM-DD` | Lista de chamada de uma data                    |
| GET    | `/api/attendance/dates`           | Datas que já tiveram chamada (histórico)        |
| POST   | `/api/attendance/confirm`         | Confirma e salva a chamada revisada             |
| POST   | `/api/attendance/reset`           | Zera a chamada de uma data (padrão: hoje)       |
| GET    | `/api/health`                     | Status da API                                   |

Exemplos de corpo (JSON):
```jsonc
// POST /api/students
{ "name": "Maria Silva", "images": ["data:image/jpeg;base64,...", "..."] }

// POST /api/recognize
{ "image": "data:image/jpeg;base64,...", "date": "2026-06-18" }

// POST /api/attendance/confirm
{ "present": ["Maria Silva", "João Souza"], "date": "2026-06-18" }
```

---

## Ajustes finos

Os parâmetros de visão computacional ficam em `backend/app/config.py`:

| Parâmetro               | Padrão       | Descrição                                                   |
|-------------------------|--------------|-------------------------------------------------------------|
| `DEEPFACE_MODEL`        | `Facenet512` | Modelo de embeddings (ex.: `VGG-Face`, `ArcFace`).          |
| `RECOGNITION_THRESHOLD` | `0.30`       | Limiar de distância. Menor = mais rígido (menos falsos +).  |
| `MIN_VALID_CAPTURES`    | `4`          | Mínimo de fotos com rosto detectado para concluir cadastro. |
| `HAAR_SCALE_FACTOR`     | `1.1`        | Escala do Haarcascade.                                      |
| `HAAR_MIN_NEIGHBORS`    | `6`          | Vizinhos mínimos (maior = menos detecções falsas).          |

Muitos "Desconhecido" para alunos já cadastrados? **Aumente** o
`RECOGNITION_THRESHOLD` (ex.: `0.35`). Confusão entre alunos? **Diminua** o limiar.

---

## Tecnologias

- **Backend:** FastAPI, Uvicorn
- **Visão Computacional:** OpenCV (Haarcascade), DeepFace (TensorFlow)
- **Frontend:** HTML, CSS e JavaScript puro (`getUserMedia`, Canvas, Fetch API)
- **Persistência:** arquivos JSON

---

## Demonstração

> Vídeo demonstrativo (cadastro, acesso à webcam e realização da chamada):
>
> **[Link do vídeo no YouTube (não listado)](ADICIONAR_LINK_AQUI)**

---

## Observações

- Os dados gerados em runtime (fotos, embeddings e presenças) ficam em
  `backend/data/` e **não** são versionados (ver `.gitignore`).
- O projeto usa um banco JSON por simplicidade; para produção, recomenda-se um
  banco de dados real (SQLite/PostgreSQL).
