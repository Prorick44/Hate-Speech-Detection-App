import { useState, useEffect, useCallback } from 'react';
import { Shield, Search, Loader2, Sparkles, X, CircleAlert, CircleCheck, RefreshCw } from 'lucide-react';
import { supabase, type Detection } from '@/lib/supabase';
import {
  detectHateSpeech,
  getModelServiceHealth,
  type DetectionResult,
  type ModelServiceHealth,
} from '@/lib/detector';
import ResultCard from '@/components/ResultCard';
import HistoryPanel from '@/components/HistoryPanel';
import StatsBar from '@/components/StatsBar';

const MAX_LENGTH = 2000;
const MAX_LINES = 20;
const LOCAL_HISTORY_KEY = 'hate-speech-detector-history';

function readLocalHistory(): Detection[] {
  try {
    const saved = window.localStorage.getItem(LOCAL_HISTORY_KEY);
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? (parsed as Detection[]) : [];
  } catch {
    return [];
  }
}

function saveLocalHistory(history: Detection[]) {
  try {
    window.localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // The result is still visible even if the browser blocks local storage.
  }
}

function createLocalDetection(statement: string, detection: DetectionResult): Detection {
  return {
    id: crypto.randomUUID(),
    statement,
    is_hateful: detection.isHateful,
    confidence: detection.confidence,
    categories: detection.categories,
    severity: detection.severity,
    explanation: detection.explanation,
    flagged_terms: detection.flaggedTerms,
    created_at: new Date().toISOString(),
  };
}

const exampleStatements = [
  'তুমি ভালো মানুষ',
  'এদের দেশ থেকে বের করে দেওয়া উচিত',
  'আজ আকাশ খুব সুন্দর',
  'এই লোকগুলো সমাজের জন্য বিপদ',
];

export default function App() {
  const [input, setInput] = useState('');
  const [results, setResults] = useState<DetectionResult[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [history, setHistory] = useState<Detection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modelHealth, setModelHealth] = useState<ModelServiceHealth>({ status: 'checking' });
  const inputLines = input
    .split(/\r?\n/)
    .map((line, index) => ({ text: line.trim(), number: index + 1 }))
    .filter((line) => line.text.length > 0);
  const tooManyLines = inputLines.length > MAX_LINES;

  const loadHistory = useCallback(async () => {
    if (!supabase) {
      setHistory(readLocalHistory());
      return;
    }

    const { data, error } = await supabase
      .from('detections')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      setError('Could not load history.');
      return;
    }
    setHistory(data ?? []);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const checkModelHealth = useCallback(async () => {
    setModelHealth({ status: 'checking' });
    const health = await getModelServiceHealth();
    setModelHealth(health);
    return health;
  }, []);

  useEffect(() => {
    void checkModelHealth();
  }, [checkModelHealth]);

  const handleAnalyze = async () => {
    if (inputLines.length === 0 || tooManyLines) return;

    setAnalyzing(true);
    setError(null);
    setResults([]);
    setAnalysisProgress(0);

    try {
      const health = await checkModelHealth();
      if (health.status !== 'ready') {
        throw new Error(health.detail ?? 'The local model is not ready yet.');
      }

      const detections: DetectionResult[] = [];
      let feedback: string | null = null;
      for (const [index, line] of inputLines.entries()) {
        setAnalysisProgress(index + 1);
        try {
          const detection = await detectHateSpeech(line.text);
          detections.push(detection);
          setResults([...detections]);
        } catch (analysisError) {
          const detail =
            analysisError instanceof Error
              ? analysisError.message
              : 'The AI model could not analyze this line.';
          feedback = `Could not analyze line ${line.number}: ${detail} Later lines were skipped.`;
          break;
        }
      }

      if (detections.length > 0 && supabase) {
        const { error: insertError } = await supabase.from('detections').insert(
          detections.map((detection) => ({
            statement: detection.statement,
            is_hateful: detection.isHateful,
            confidence: detection.confidence,
            categories: detection.categories,
            severity: detection.severity,
            explanation: detection.explanation,
            flagged_terms: detection.flaggedTerms,
          }))
        );

        if (insertError) {
          feedback = [feedback, 'Analysis finished, but it could not be saved to history.']
            .filter(Boolean)
            .join(' ');
        } else {
          void loadHistory();
        }
      } else if (detections.length > 0) {
        const nextHistory = [
          ...detections.map((detection) => createLocalDetection(detection.statement, detection)),
          ...history,
        ].slice(0, 100);
        setHistory(nextHistory);
        saveLocalHistory(nextHistory);
      }

      setError(feedback);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : 'The AI model could not analyze this statement.'
      );
    } finally {
      setAnalyzing(false);
      setAnalysisProgress(0);
    }
  };

  const handleDelete = async (id: string) => {
    if (!supabase) {
      const nextHistory = history.filter((h) => h.id !== id);
      setHistory(nextHistory);
      saveLocalHistory(nextHistory);
      return;
    }

    const { error } = await supabase.from('detections').delete().eq('id', id);
    if (!error) {
      setHistory((prev) => prev.filter((h) => h.id !== id));
    } else {
      setError('Could not delete this history entry.');
    }
  };

  const handleSelectHistory = (item: Detection) => {
    setResults([{
      statement: item.statement,
      isHateful: item.is_hateful,
      confidence: Number(item.confidence),
      categories: item.categories ?? [],
      severity: item.severity as DetectionResult['severity'],
      explanation: item.explanation ?? '',
      flaggedTerms: item.flagged_terms ?? [],
    }]);
    setInput(item.statement);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleExample = (text: string) => {
    setInput(text);
    setResults([]);
    setError(null);
  };

  const handleClear = () => {
    setInput('');
    setResults([]);
    setError(null);
  };

  const hatefulCount = history.filter((h) => h.is_hateful).length;
  const safeCount = history.length - hatefulCount;
  const isModelReady = modelHealth.status === 'ready';
  const modelStatusText =
    modelHealth.status === 'checking'
      ? 'Checking model…'
      : isModelReady
        ? 'Model ready'
        : 'Model unavailable';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <header className="border-b border-gray-200/60 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-sm">
            <Shield size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-800 leading-tight">Hate Speech Detector</h1>
            <p className="text-xs text-gray-500">Review Bengali lines for possible hateful content</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div
              role="status"
              aria-live="polite"
              className={`flex items-center gap-1.5 text-xs font-medium ${
                modelHealth.status === 'checking'
                  ? 'text-gray-400'
                  : isModelReady
                    ? 'text-green-600'
                    : 'text-amber-600'
              }`}
              title={modelHealth.detail}
            >
              {modelHealth.status === 'checking' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : isModelReady ? (
                <CircleCheck size={14} />
              ) : (
                <CircleAlert size={14} />
              )}
              <span className="hidden sm:inline">{modelStatusText}</span>
              <button
                onClick={() => void checkModelHealth()}
                disabled={modelHealth.status === 'checking'}
                aria-label="Refresh model status"
                title="Refresh model status"
                className="rounded p-0.5 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw size={13} />
              </button>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400">
              <Sparkles size={14} />
              <span>Powered by XLM-RoBERTa</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <StatsBar total={history.length} hateful={hatefulCount} safe={safeCount} />

        <div
          role="note"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900"
        >
          <strong>Experimental model:</strong> the current checkpoint did not flag the hostile Bengali
          examples tested during development. Verify its predictions against labeled Bengali data
          before relying on it; do not use the scores alone to make moderation decisions.
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Enter or paste Bengali lines to analyze
          </label>
          <div className="relative">
            <textarea
              value={input}
              aria-label="Bengali lines to analyze"
              onChange={(e) => {
                setInput(e.target.value.slice(0, MAX_LENGTH));
                setResults([]);
                setError(null);
              }}
              placeholder={'Type or paste one Bengali line per row...\nআজ আকাশ খুব সুন্দর\nতুমি ভালো মানুষ'}
              rows={4}
              disabled={analyzing}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 pr-10 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 resize-none transition-all"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleAnalyze();
                }
              }}
            />
            {input && (
              <button
                type="button"
                onClick={handleClear}
                disabled={analyzing}
                aria-label="Clear statement"
                className="absolute top-3 right-3 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between mt-3">
            <div className="text-xs text-gray-500">
              <span className="tabular-nums">{input.length} / {MAX_LENGTH} characters</span>
              <span className="ml-2">· {inputLines.length} / {MAX_LINES} lines</span>
              {tooManyLines && (
                <p className="mt-1 text-amber-700">Reduce the batch to {MAX_LINES} non-empty lines or fewer.</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline text-xs text-gray-400">
                Ctrl+Enter to analyze
              </span>
              <button
                onClick={handleAnalyze}
                disabled={inputLines.length === 0 || tooManyLines || analyzing}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {analyzing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Analyzing {analysisProgress} of {inputLines.length}...
                  </>
                ) : (
                  <>
                    <Search size={16} />
                    Analyze {inputLines.length > 1 ? `${inputLines.length} lines` : 'line'}
                  </>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>

        {results.length > 0 && (
          <section aria-label="Line analysis results" className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-lg font-semibold text-gray-800">Line-by-line results</h2>
              <div className="flex flex-wrap justify-end gap-2 text-xs">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
                  {results.length} analyzed
                </span>
                <span className="rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-700">
                  {results.filter((result) => result.isHateful).length} predicted hateful
                </span>
                <span className="rounded-full bg-green-50 px-2.5 py-1 font-medium text-green-700">
                  {results.filter((result) => !result.isHateful).length} predicted non-hateful
                </span>
              </div>
            </div>
            {results.map((result, index) => (
              <ResultCard key={`${index}-${result.statement}`} result={result} />
            ))}
          </section>
        )}

        {results.length === 0 && !analyzing && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={16} className="text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-700">Try a Bengali example</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {exampleStatements.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => handleExample(ex)}
                  className="text-left px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-600 hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        <HistoryPanel
          history={history}
          onSelect={handleSelectHistory}
          onDelete={handleDelete}
        />

        <footer className="text-center py-4">
          <p className="text-xs text-gray-400">
            This tool uses a locally hosted XLM-RoBERTa binary classifier trained on Bengali-language data. It is for educational use and is not a substitute for professional content moderation.
          </p>
        </footer>
      </main>
    </div>
  );
}
