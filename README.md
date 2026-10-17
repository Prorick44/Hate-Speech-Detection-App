# Hate Speech Detector

A local web application that classifies submitted text with an XLM-RoBERTa
binary model loaded from a local checkpoint. The React interface keeps a
detection history in the browser by default; Supabase storage is optional.

## What is included

- React + Vite frontend with analysis results, confidence scores, searchable and filterable history, and CSV export
- Line-by-line analysis for pasted batches of up to 20 Bengali lines
- FastAPI service that loads the local model once and exposes `POST /api/analyze`
- Optional Supabase migration for a shared, persistent history
- Local-only model inference: the model weights never reach the browser

## Detect a line

Start the API and frontend using the steps below, then enter a Bengali line or
paste multiple lines (one per row) and choose **Analyze**. Blank rows are
ignored, and up to 20 lines are analyzed separately. Each result shows the
exact line, the model's hateful or non-hateful prediction, and its score.
Successful predictions are saved individually in history. The score is not a
guarantee of accuracy; review results before using them for moderation.

## Run locally

1. Make sure the exported model is available at
   `D:\Documents\final-project\xlm_roberta_model`, or set `MODEL_PATH` to its
   folder in `backend/.env`.
2. Create the backend environment file and install its dependencies:

   ```powershell
   Copy-Item backend/.env.example backend/.env
   .\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
   ```

3. Start the model API in one terminal:

   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
   ```

4. In another terminal, install frontend dependencies and start Vite:

   ```powershell
   npm ci
   npm run dev
   ```

   Open the URL Vite prints (normally `http://localhost:5173`). During
   development, Vite forwards `/api/*` requests to the FastAPI service.

   For a static production build or `npm run preview`, copy `.env.example` to
   `.env.local` and set `VITE_MODEL_API_URL` to the FastAPI server's
   `/api` URL (for example, `http://127.0.0.1:8000/api`). Alternatively,
   configure your web server to proxy `/api` to FastAPI.

## API

- `GET /api/health` returns the model readiness state.
- `POST /api/analyze` accepts `{ "text": "..." }` (1–2000 characters) and
  returns the predicted label, confidence, class probabilities, and model
  metadata.

The model uses output index `1` for the hateful class; this mapping is
documented in the training notebook that accompanies the model. Change
`HATEFUL_LABEL_INDEX` in `backend/.env` only when using a differently trained
export.

## Optional Supabase history

Without `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, history is stored in
the current browser's local storage. To use Supabase instead, run the migration
in `supabase/migrations/` and add both variables to a root `.env.local` file.

## Notes

The included model was fine-tuned on Bengali-language data. Use Bengali input
for its intended scope; predictions for other languages, mixed-language text,
or nuanced context are not reliable. This is an educational binary classifier,
not an automated moderation system. During development, the current checkpoint
classified the hostile Bengali examples tested as non-hateful. Validate it
against a labeled Bengali evaluation set before relying on its output. Model
predictions can be wrong or lack context, so they should be reviewed by a
person before any moderation decision.
