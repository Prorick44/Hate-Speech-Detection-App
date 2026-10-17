import { ShieldCheck, ShieldAlert, BarChart3, Activity } from 'lucide-react';

type Props = {
  total: number;
  hateful: number;
  safe: number;
};

export default function StatsBar({ total, hateful, safe }: Props) {
  const hatefulPct = total > 0 ? Math.round((hateful / total) * 100) : 0;

  const stats = [
    {
      label: 'Total Analyzed',
      value: total,
      icon: BarChart3,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Safe Statements',
      value: safe,
      icon: ShieldCheck,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      label: 'Hateful Detected',
      value: hateful,
      icon: ShieldAlert,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
    {
      label: 'Detection Rate',
      value: `${hatefulPct}%`,
      icon: Activity,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3 hover:shadow-md transition-shadow"
          >
            <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center flex-shrink-0`}>
              <Icon size={20} className={stat.color} />
            </div>
            <div className="min-w-0">
              <div className="text-xl font-bold text-gray-800 tabular-nums">{stat.value}</div>
              <div className="text-xs text-gray-500 truncate">{stat.label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
