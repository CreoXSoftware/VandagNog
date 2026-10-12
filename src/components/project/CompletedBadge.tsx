import { CheckCircle2 } from 'lucide-react';
import { useT } from '@/lib/i18n';

export function CompletedBadge() {
  const t = useT();
  return (
    <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
      <CheckCircle2 size={10} /> {t('projects.completedBadge')}
    </span>
  );
}
