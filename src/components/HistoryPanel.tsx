import { useMemo, useState } from 'react';
import { History, Trash2, Clock, Download, Search } from 'lucide-react';
import type { Detection } from '@/lib/supabase';

type Props = {
  history: Detection[];
  onSelect: (detection: Detection) => void;
  onDelete: (id: string) => void;
};

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export default function HistoryPanel({ history, onSelect, onDelete }: Props) {
  const [query, setQuery] = useState('');
  const [classification, setClassification] = useState<'all' | 'hateful' | 'safe'>('all');
  const filteredHistory = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return history.filter((item) => {
      const matchesQuery = item.statement.toLocaleLowerCase().includes(normalizedQuery);
      const matchesClassification =
        classification === 'all' ||
        (classification === 'hateful' ? item.is_hateful : !item.is_hateful);
      return matchesQuery && matchesClassification;
    });
  }, [history, query, classification]);

  const handleExport = () => {
    const columns = ['statement', 'classification', 'confidence', 'severity', 'explanation', 'flagged_terms', 'created_at'];
    const rows = filteredHistory.map((item) => [
      item.statement,
      item.is_hateful ? 'Hateful' : 'Safe',
      item.confidence,
      item.severity,
      item.explanation ?? '',
      (item.flagged_terms ?? []).join('; '),
      item.created_at,
    ]);
    const escapeCsv = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [columns, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `detection-history-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <History size={18} className="text-gray-500" />
          <h3 className="font-semibold text-gray-800">Detection History</h3>
          <span className="ml-auto text-sm text-gray-400">
            {filteredHistory.length === history.length
              ? `${history.length} entries`
              : `${filteredHistory.length} of ${history.length} entries`}
          </span>
          <button
            type="button"
            onClick={handleExport}
            disabled={filteredHistory.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Export matching history entries as CSV"
            title="Export matching entries as CSV"
          >
            <Download size={14} />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
        {history.length > 0 && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">Search detection history</span>
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search statements..."
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </label>
            <label>
              <span className="sr-only">Filter by classification</span>
              <select
                value={classification}
                onChange={(event) => {
                  const value = event.target.value;
                  setClassification(value === 'hateful' || value === 'safe' ? value : 'all');
                }}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 sm:w-auto"
              >
                <option value="all">All results</option>
                <option value="hateful">Hateful only</option>
                <option value="safe">Safe only</option>
              </select>
            </label>
          </div>
        )}
      </div>

      {history.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <Clock size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-400">No detections yet. Analyze a statement to get started.</p>
        </div>
      ) : filteredHistory.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <Search size={28} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">No history entries match your search.</p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setClassification('all');
            }}
            className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="max-h-[500px] overflow-y-auto divide-y divide-gray-50">
          {filteredHistory.map((item) => (
            <div
              key={item.id}
              className="group flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-gray-50"
            >
              <div
                className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${item.is_hateful ? 'bg-red-500' : 'bg-green-500'}`}
              />
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded"
                aria-label={`View ${item.is_hateful ? 'hateful' : 'safe'} detection: ${item.statement}`}
              >
                <p className="text-sm text-gray-700 truncate">{item.statement}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${item.is_hateful ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}
                  >
                    {item.is_hateful ? 'Hateful' : 'Safe'}
                  </span>
                  <span className="text-xs text-gray-400">{item.confidence}%</span>
                  <span className="text-xs text-gray-400">{formatTimeAgo(item.created_at)}</span>
                </div>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(item.id);
                }}
                aria-label="Delete history entry"
                title="Delete history entry"
                className="rounded-lg p-1.5 text-gray-400 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 sm:opacity-0"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
