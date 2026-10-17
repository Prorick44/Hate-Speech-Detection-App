"""Local FastAPI inference service for the bundled XLM-R sequence classifier.

Run from the repository root after installing ``backend/requirements.txt``:

    uvicorn backend.app:app --host 127.0.0.1 --port 8000

The model is intentionally loaded only from MODEL_PATH (never downloaded) and
only once during application startup.
"""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool


BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")

# Keep this aligned with the exported model directory supplied with the
# project.  The architecture is XLM-RoBERTa (not XML-RoBERTa).
DEFAULT_MODEL_PATH = r"D:\Documents\final-project\xlm_roberta_model"
MAX_INPUT_CHARS = 2000
DEFAULT_MAX_INPUT_TOKENS = 512
DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)
LOGGER = logging.getLogger("hate_speech_api")


def _resolve_model_path(raw_value: str | None) -> Path:
    """Prefer a configured path, then a few project-local fallbacks."""
    candidates: list[Path] = []
    if raw_value and raw_value.strip():
        candidates.append(Path(raw_value).expanduser())

    project_root = BACKEND_DIR.parent
    candidates.extend(
        [
            Path(DEFAULT_MODEL_PATH).expanduser(),
            project_root / "xlm_roberta_model",
            BACKEND_DIR / "xlm_roberta_model",
            Path.cwd() / "xlm_roberta_model",
        ]
    )

    for candidate in candidates:
        if candidate.exists():
            return candidate

    return candidates[0] if candidates else Path(DEFAULT_MODEL_PATH).expanduser()


def _read_integer_setting(name: str, default: int, minimum: int) -> int:
    raw_value = os.getenv(name, str(default)).strip()
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer; received {raw_value!r}.") from exc

    if value < minimum:
        raise RuntimeError(f"{name} must be at least {minimum}; received {value}.")
    return value


@dataclass(frozen=True)
class Settings:
    """Runtime configuration read from backend/.env or process environment."""

    model_path: Path
    hateful_label_index: int
    device: str
    max_input_tokens: int
    cors_origins: tuple[str, ...]

    @classmethod
    def from_environment(cls) -> "Settings":
        device = os.getenv("DEVICE", "auto").strip().lower()
        if device not in {"auto", "cpu", "cuda"}:
            raise RuntimeError("DEVICE must be one of: auto, cpu, cuda.")

        origins = tuple(
            origin.strip()
            for origin in os.getenv("CORS_ORIGINS", ",".join(DEFAULT_CORS_ORIGINS)).split(",")
            if origin.strip()
        )

        return cls(
            model_path=_resolve_model_path(os.getenv("MODEL_PATH")),
            hateful_label_index=_read_integer_setting("HATEFUL_LABEL_INDEX", 1, 0),
            device=device,
            max_input_tokens=_read_integer_setting(
                "MAX_INPUT_TOKENS", DEFAULT_MAX_INPUT_TOKENS, 1
            ),
            cors_origins=origins or DEFAULT_CORS_ORIGINS,
        )


class AnalyzeRequest(BaseModel):
    text: str


class ModelUnavailableError(RuntimeError):
    """Raised when a request arrives before the model loaded successfully."""


class LocalClassifier:
    """Loads a local Hugging Face classifier once and serializes inference calls."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model: Any | None = None
        self._tokenizer: Any | None = None
        self._torch: Any | None = None
        self._device: str | None = None
        self._model_name = "XLMRobertaForSequenceClassification"
        self._max_input_tokens = settings.max_input_tokens
        self._load_error: str | None = None
        self._lock = threading.Lock()

    @property
    def is_ready(self) -> bool:
        return self._model is not None and self._tokenizer is not None

    @property
    def load_error(self) -> str | None:
        return self._load_error

    def metadata(self) -> dict[str, Any]:
        return {
            "name": self._model_name,
            "maxInputTokens": self._max_input_tokens,
        }

    def _select_device(self, torch: Any) -> str:
        if self.settings.device == "auto":
            return "cuda" if torch.cuda.is_available() else "cpu"
        if self.settings.device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("DEVICE is set to cuda, but CUDA is not available to PyTorch.")
        return self.settings.device

    def _effective_token_limit(self, model: Any, tokenizer: Any) -> int:
        """Honor the safest limit advertised by config, tokenizer, and .env."""

        limits = [self.settings.max_input_tokens]
        for candidate in (
            getattr(model.config, "max_position_embeddings", None),
            getattr(tokenizer, "model_max_length", None),
        ):
            try:
                candidate_int = int(candidate)
            except (TypeError, ValueError):
                continue

            # Some tokenizer implementations use a huge sentinel for no limit.
            if 0 < candidate_int <= 100_000:
                limits.append(candidate_int)

        return min(limits)

    def load(self) -> None:
        """Load weights/tokenizer from disk. Failures leave health reporting 503."""

        try:
            if not self.settings.model_path.is_dir():
                raise RuntimeError(
                    f"MODEL_PATH does not exist or is not a directory: {self.settings.model_path}"
                )

            # Imports are delayed so /health can still explain a missing install.
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer

            device = self._select_device(torch)
            LOGGER.info("Loading local model from %s on %s", self.settings.model_path, device)

            # The local model has sentencepiece.bpe.model but no tokenizer.json.
            tokenizer = AutoTokenizer.from_pretrained(
                self.settings.model_path,
                local_files_only=True,
                use_fast=False,
            )
            model = AutoModelForSequenceClassification.from_pretrained(
                self.settings.model_path,
                local_files_only=True,
                use_safetensors=True,
            )
            model.to(device)
            model.eval()

            num_labels = int(model.config.num_labels)
            if num_labels != 2:
                raise RuntimeError(
                    "This API exposes a binary hateful/neutral contract, but the loaded "
                    f"model has {num_labels} output labels."
                )
            if self.settings.hateful_label_index >= num_labels:
                raise RuntimeError(
                    "HATEFUL_LABEL_INDEX must select an existing model output label "
                    f"(0..{num_labels - 1}); received {self.settings.hateful_label_index}."
                )

            self._torch = torch
            self._tokenizer = tokenizer
            self._model = model
            self._device = device
            self._model_name = model.__class__.__name__
            self._max_input_tokens = self._effective_token_limit(model, tokenizer)
            self._load_error = None
            LOGGER.info(
                "Model ready: %s (max input tokens: %s)",
                self._model_name,
                self._max_input_tokens,
            )
        except Exception as exc:  # Preserve a usable health endpoint on setup errors.
            self._model = None
            self._tokenizer = None
            self._torch = None
            self._device = None
            self._load_error = f"{type(exc).__name__}: {exc}"
            LOGGER.exception("Could not load the local inference model")

    def unload(self) -> None:
        with self._lock:
            self._model = None
            self._tokenizer = None
            if self._torch is not None and self._torch.cuda.is_available():
                self._torch.cuda.empty_cache()
            self._torch = None
            self._device = None

    def predict(self, text: str) -> dict[str, Any]:
        if not self.is_ready:
            raise ModelUnavailableError("The local model is not ready.")

        # A single loaded model is safer and more predictable than concurrent CPU/GPU calls.
        with self._lock:
            if not self.is_ready:
                raise ModelUnavailableError("The local model is not ready.")

            assert self._model is not None
            assert self._tokenizer is not None
            assert self._torch is not None
            assert self._device is not None

            encoded = self._tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=self._max_input_tokens,
            )
            inputs = {name: value.to(self._device) for name, value in encoded.items()}

            with self._torch.inference_mode():
                logits = self._model(**inputs).logits
                probabilities = self._torch.softmax(logits, dim=-1)[0].detach().cpu().tolist()

            if len(probabilities) != 2:
                raise RuntimeError(
                    "The loaded model returned an unexpected number of probabilities."
                )

            hateful_index = self.settings.hateful_label_index
            neutral_index = 1 - hateful_index
            predicted_index = max(range(2), key=lambda index: probabilities[index])
            is_hateful = predicted_index == hateful_index

            # This mapping is controlled by HATEFUL_LABEL_INDEX; it is not inferred
            # from the model files, which do not contain semantic label names.
            hateful_probability = float(probabilities[hateful_index])
            neutral_probability = float(probabilities[neutral_index])
            winning_probability = float(probabilities[predicted_index])

            return {
                "isHateful": is_hateful,
                "confidence": round(winning_probability * 100, 2),
                "label": "hateful" if is_hateful else "neutral",
                "probabilities": {
                    "hateful": round(hateful_probability, 6),
                    "neutral": round(neutral_probability, 6),
                },
                "model": self.metadata(),
            }


SETTINGS = Settings.from_environment()


@asynccontextmanager
async def lifespan(app: FastAPI):
    classifier = LocalClassifier(SETTINGS)
    app.state.classifier = classifier
    await run_in_threadpool(classifier.load)
    try:
        yield
    finally:
        await run_in_threadpool(classifier.unload)


app = FastAPI(
    title="Local XLM-R Hate Speech Inference API",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(SETTINGS.cors_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _get_classifier(request: Request) -> LocalClassifier:
    classifier: LocalClassifier = request.app.state.classifier
    if not classifier.is_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The local model is unavailable. Check GET /health and the server logs.",
        )
    return classifier


@app.get("/health", include_in_schema=False)
@app.get("/api/health")
async def health(request: Request) -> JSONResponse:
    classifier: LocalClassifier = request.app.state.classifier
    if classifier.is_ready:
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"status": "ok", "model": classifier.metadata()},
        )

    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "status": "unavailable",
            "model": classifier.metadata(),
            "detail": "The local model could not be loaded. Check the server logs.",
        },
    )


@app.post("/api/analyze")
async def analyze(payload: AnalyzeRequest, request: Request) -> dict[str, Any]:
    # Keep the public limit exact while rejecting whitespace-only submissions.
    text = payload.text.strip()
    if not text or not 1 <= len(text) <= MAX_INPUT_CHARS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"text must contain between 1 and {MAX_INPUT_CHARS} characters "
                "and cannot be only whitespace."
            ),
        )

    classifier = _get_classifier(request)
    try:
        return await run_in_threadpool(classifier.predict, text)
    except ModelUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The local model is unavailable. Check GET /health and the server logs.",
        ) from exc
