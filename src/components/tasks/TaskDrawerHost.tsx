import { Drawer } from '@/components/ui/Drawer';
import { WorkItemDrawer } from '@/components/workitem/WorkItemDrawer';
import { useWorkItems } from '@/hooks/useWorkItems';
import { useDependencies } from '@/hooks/useDependencies';
import { useMembers } from '@/hooks/useMembers';
import { useProject } from '@/hooks/useProjects';
import { useNonWorkingDays } from '@/hooks/useNonWorkingDays';
import { useT } from '@/lib/i18n';
import type { WorkItem } from '@/types/db';

interface Props {
  item: WorkItem;
  canEdit: boolean;
  onClose: () => void;
  onNavigate: (id: string) => void;
}

// Opens the full work-item editor from the global Tasks page without sending the
// user to the gantt. WorkItemDrawer needs a project-scoped bundle, so the five
// per-project hooks are mounted here, keyed on the selected item's project.
//
// This also warms two caches that useRescheduleFrom reads directly rather than
// fetching — projectKey and nonWorkingDaysKey. Cold, its optimistic cascade
// silently falls back to Mon–Fri with no non-working days, so mounting them
// before any date edit is possible keeps the cascade correct here.
export function TaskDrawerHost({ item, canEdit, onClose, onNavigate }: Props) {
  const t = useT();
  const projectId = item.project_id;

  const { data: items } = useWorkItems(projectId);
  const { data: dependencies } = useDependencies(projectId);
  const { data: members } = useMembers(projectId);
  const { data: project } = useProject(projectId);
  const { data: nonWorkingDays } = useNonWorkingDays(projectId);

  // Prefer the project cache's copy: it is what the drawer's own mutations patch.
  const current = items?.find((w) => w.id === item.id) ?? item;

  if (!items || !project) {
    return (
      <Drawer open onClose={onClose} title={item.name}>
        <div className="p-4 text-sm text-neutral-500 dark:text-neutral-400">
          {t('common.loading')}
        </div>
      </Drawer>
    );
  }

  return (
    <WorkItemDrawer
      workItem={current}
      allItems={items}
      dependencies={dependencies ?? []}
      workingDays={project.working_days}
      nonWorkingDays={nonWorkingDays ?? []}
      members={members ?? []}
      canEdit={canEdit}
      initialTab="details"
      onClose={onClose}
      onNavigate={onNavigate}
    />
  );
}
