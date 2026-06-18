# 🎓 Chamada por Reconhecimento Facial

Aplicação **web** para registro automático de presença (chamada) de alunos a
partir da **webcam**. A detecção de rostos é feita com o classificador
**Haarcascade (OpenCV)** e o reconhecimento facial com **DeepFace**.

> Trabalho de Visão Computacional — detecção + reconhecimento de faces aplicado
> ao registro de presença em sala de aula.

---

## ✨ Funcionalidades

- **Cadastro de alunos** pelo navegador: upload de foto **ou** captura direta pela webcam.
- **Detecção de rostos** com Haarcascade (OpenCV) no momento do cadastro e da chamada.
- **Reconhecimento facial** com DeepFace (embeddings `Facenet512` + distância de cosseno).
- **Chamada ao vivo**: feed de vídeo com caixas desenhadas sobre cada rosto
  (verde = reconhecido, laranja = desconhecido).
- **Modo automático**: o sistema captura frames periodicamente e marca presença sozinho.
- **Lista de chamada** atualizada em tempo real, com horário de registro e total de presentes.
- Persistência simples em arquivos JSON (sem necessidade de banco de dados).

---

## 🧱 Arquitetura

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
    ├── cadastro.html         # cadastro de alunos
    ├── chamada.html          # reconhecimento ao vivo / chamada
    ├── css/style.css
    └── js/{common,cadastro,chamada}.js
```

### Fluxo do reconhecimento

1. O navegador acessa a webcam via `getUserMedia` e captura um frame (`<canvas>` → JPEG base64).
2. O frame é enviado ao backend (`POST /api/recognize`).
3. O backend **detecta** os rostos com Haarcascade, **recorta** cada um e
   extrai o **embedding** com DeepFace.
4. Cada embedding é comparado (distância de cosseno) com os alunos cadastrados.
   Abaixo do limiar → aluno reconhecido → presença registrada.
5. O backend devolve as caixas detectadas + a lista de chamada atualizada, que o
   frontend desenha sobre o vídeo e exibe na tabela.

---

## 🚀 Instalação e Execução

### Pré-requisitos
- **Python 3.10, 3.11 ou 3.12** (testado em 3.11).
  ⚠️ **Não use Python 3.13/3.14** — o TensorFlow (dependência do DeepFace)
  ainda não tem suporte a essas versões e a instalação falha.
- Uma **webcam**
- Navegador moderno (Chrome, Edge ou Firefox)

> ℹ️ A câmera só é liberada pelo navegador em **`localhost`** ou via **HTTPS**.
> Rodando localmente em `http://localhost:8000` funciona normalmente.

### 1. Clonar o repositório
```bash
git clone https://github.com/leopzz/vc-trabalho-2.git
cd vc-trabalho-2
```

### 2. Criar o ambiente virtual e instalar dependências
```bash
cd backend
python -m venv .venv

# Linux / macOS
source .venv/bin/activate
# Windows (PowerShell)
# .venv\Scripts\Activate.ps1

pip install -r requirements.txt
```

> ⚠️ A **primeira execução** do DeepFace baixa automaticamente os pesos do
> modelo `Facenet512` (~90 MB). É necessário ter conexão com a internet nesse
> primeiro uso; depois os modelos ficam em cache (`~/.deepface`).

### 3. Iniciar o servidor
```bash
# dentro de backend/, com o ambiente virtual ativo
python run.py
```
ou, equivalentemente:
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Abrir a aplicação
Acesse no navegador: **http://localhost:8000**

A documentação interativa da API (Swagger) fica em **http://localhost:8000/docs**.

---

## 📋 Como usar

1. **Cadastro** (`/cadastro.html`):
   - Digite o nome do aluno.
   - Faça o upload de uma foto **ou** clique em *Usar webcam* → *Capturar foto*.
   - Clique em **Salvar cadastro**. Use fotos frontais e bem iluminadas.
2. **Chamada** (`/chamada.html`):
   - Clique em **Iniciar câmera** e permita o acesso à webcam.
   - Use **Reconhecer agora** (manual) ou **Chamada automática** (a cada ~2,5 s).
   - Os rostos reconhecidos ficam verdes e a presença é registrada na tabela.
   - **Zerar chamada de hoje** limpa os registros do dia.

---

## 🔌 Endpoints da API

| Método | Rota                          | Descrição                                  |
|--------|-------------------------------|--------------------------------------------|
| POST   | `/api/students`               | Cadastra aluno (`name` + arquivo `photo`)  |
| GET    | `/api/students`               | Lista alunos cadastrados                   |
| GET    | `/api/students/{id}/photo`    | Retorna a foto recortada do aluno          |
| DELETE | `/api/students/{id}`          | Remove um aluno                            |
| POST   | `/api/recognize`              | Recebe um frame e faz detecção + chamada   |
| GET    | `/api/attendance?date=YYYY-MM-DD` | Lista de chamada de uma data           |
| POST   | `/api/attendance/reset`       | Zera a chamada de uma data (padrão: hoje)  |
| GET    | `/api/health`                 | Status da API                              |

Exemplo de corpo do `POST /api/recognize`:
```json
{ "image": "data:image/jpeg;base64,/9j/4AAQSk...", "date": "2026-06-18" }
```

---

## ⚙️ Ajustes finos

Os parâmetros de visão computacional ficam em `backend/app/config.py`:

| Parâmetro              | Padrão        | Descrição                                                 |
|------------------------|---------------|-----------------------------------------------------------|
| `DEEPFACE_MODEL`       | `Facenet512`  | Modelo de embeddings (ex.: `VGG-Face`, `ArcFace`).        |
| `RECOGNITION_THRESHOLD`| `0.30`        | Limiar de distância. Menor = mais rígido (menos falsos +).|
| `HAAR_SCALE_FACTOR`    | `1.1`         | Escala do Haarcascade.                                     |
| `HAAR_MIN_NEIGHBORS`   | `6`           | Vizinhos mínimos (maior = menos detecções falsas).        |

Se houver muitos "Desconhecido" para alunos já cadastrados, **aumente** o
`RECOGNITION_THRESHOLD` (ex.: `0.35`). Se houver confusão entre alunos,
**diminua** o limiar.

---

## 🧪 Tecnologias

- **Backend:** FastAPI, Uvicorn
- **Visão Computacional:** OpenCV (Haarcascade), DeepFace (TensorFlow)
- **Frontend:** HTML, CSS e JavaScript puro (`getUserMedia`, Canvas, Fetch API)
- **Persistência:** arquivos JSON

---

## 🎥 Demonstração

> Vídeo demonstrativo (cadastro, acesso à webcam e realização da chamada):
>
> **[➡️ Link do vídeo no YouTube (não listado)](ADICIONAR_LINK_AQUI)**

---

## 📝 Observações

- Os dados gerados em runtime (fotos, embeddings e presenças) ficam em
  `backend/data/` e **não** são versionados (ver `.gitignore`).
- O projeto usa um banco JSON por simplicidade acadêmica; para produção,
  recomenda-se um banco de dados real (SQLite/PostgreSQL).
