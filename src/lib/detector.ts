export type Severity = 'none' | 'low' | 'moderate' | 'high' | 'severe';

export type ModelDetails = {
  name: string;
  label: string;
  probabilities: {
    hateful: number;
    neutral: number;
  };
};

export type ModelServiceHealth = {
  status: 'checking' | 'ready' | 'unavailable';
  detail?: string;
  model?: {
    name: string;
    maxInputTokens: number;
  };
};

export type DetectionResult = {
  statement: string;
  isHateful: boolean;
  confidence: number;
  categories: string[];
  severity: Severity;
  explanation: string;
  flaggedTerms: string[];
  model?: ModelDetails;
};

type ModelAnalysisResponse = {
  isHateful: boolean;
  confidence: number;
  label: string;
  probabilities: {
    hateful: number;
    neutral: number;
  };
  model: {
    name: string;
    maxInputTokens: number;
  };
};

type ModelHealthResponse = {
  status: 'ok' | 'unavailable';
  detail?: string;
  model: {
    name: string;
    maxInputTokens: number;
  };
};

const DEFAULT_API_BASE_URL = '/api';
const REQUEST_TIMEOUT_MS = 120_000;
const HEALTH_CHECK_TIMEOUT_MS = 10_000;

export class ModelApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelApiError';
  }
}

function getApiBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_MODEL_API_URL ?? DEFAULT_API_BASE_URL;
  return configuredUrl.replace(/\/$/, '');
}

function getSeverity(confidence: number, isHateful: boolean): Severity {
  if (!isHateful) return 'none';
  if (confidence >= 90) return 'severe';
  if (confidence >= 75) return 'high';
  if (confidence >= 60) return 'moderate';
  return 'low';
}

function isModelAnalysisResponse(value: unknown): value is ModelAnalysisResponse {
  if (!value || typeof value !== 'object') return false;

  const response = value as Partial<ModelAnalysisResponse>;
  return (
    typeof response.isHateful === 'boolean' &&
    typeof response.confidence === 'number' &&
    typeof response.label === 'string' &&
    Boolean(response.probabilities) &&
    typeof response.probabilities?.hateful === 'number' &&
    typeof response.probabilities?.neutral === 'number' &&
    Boolean(response.model) &&
    typeof response.model?.name === 'string'
  );
}

function isModelHealthResponse(value: unknown): value is ModelHealthResponse {
  if (!value || typeof value !== 'object') return false;

  const response = value as Partial<ModelHealthResponse>;
  return (
    (response.status === 'ok' || response.status === 'unavailable') &&
    Boolean(response.model) &&
    typeof response.model?.name === 'string' &&
    typeof response.model?.maxInputTokens === 'number'
  );
}

function buildExplanation(response: ModelAnalysisResponse): string {
  const percentage = Math.round(response.confidence);
  const result = response.isHateful ? 'hateful content' : 'neutral or non-hateful content';

  return `${response.model.name} classified this statement as ${result} (${percentage}% confidence). This binary model does not identify target groups or highlight individual words.`;
}

/** Checks whether the local inference service has finished loading its model. */
export async function getModelServiceHealth(): Promise<ModelServiceHealth> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`${getApiBaseUrl()}/health`, { signal: controller.signal });
    const payload: unknown = await response.json().catch(() => null);

    if (isModelHealthResponse(payload)) {
      if (response.ok && payload.status === 'ok') {
        return { status: 'ready', model: payload.model };
      }
      return {
        status: 'unavailable',
        model: payload.model,
        detail: payload.detail ?? 'The local model is not ready yet.',
      };
    }

    return {
      status: 'unavailable',
      detail: 'The local model service returned an unexpected health response.',
    };
  } catch (error) {
    return {
      status: 'unavailable',
      detail:
        error instanceof DOMException && error.name === 'AbortError'
          ? 'The local model service took too long to respond.'
          : 'The local model service is unavailable. Start it and try again.',
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Sends text to the locally hosted XLM-RoBERTa API. The 1 GB model stays on
 * the server so the browser receives only the prediction, not model weights.
 */
export async function detectHateSpeech(text: string): Promise<DetectionResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${getApiBaseUrl()}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const detail =
        payload && typeof payload === 'object' && 'detail' in payload && typeof payload.detail === 'string'
          ? payload.detail
          : 'The AI model could not analyze this statement.';
      throw new ModelApiError(detail);
    }

    if (!isModelAnalysisResponse(payload)) {
      throw new ModelApiError('The AI model returned an unexpected response.');
    }

    const confidence = Math.round(Math.max(0, Math.min(100, payload.confidence)));
    return {
      statement: text,
      isHateful: payload.isHateful,
      confidence,
      categories: payload.isHateful ? ['Hateful content'] : [],
      severity: getSeverity(confidence, payload.isHateful),
      explanation: buildExplanation(payload),
      flaggedTerms: [],
      model: {
        name: payload.model.name,
        label: payload.label,
        probabilities: payload.probabilities,
      },
    };
  } catch (error) {
    if (error instanceof ModelApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ModelApiError('The AI model took too long to respond. Please try again.');
    }
    throw new ModelApiError(
      'The AI model service is unavailable. Start the local model server and try again.'
    );
  } finally {
    window.clearTimeout(timeout);
  }
}
