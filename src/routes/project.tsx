import { useState } from 'react';
import { useParams, useSearch, useNavigate } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import { useProject } from '@/hooks/useProjects';
import { useProjectRealtime } from '@/hooks/useProjectRealtime';
import { useWorkItems } from '@/hooks/useWorkItems';
import { useDependencies } from '@/hooks/useDependencies';
import { useNonWorkingDays } from '@/hooks/useNonWorkingDays';
import { useMembers, useMyRole } from '@/hooks/useMembers';
import { WorkItemDrawer } from '@/components/workitem/WorkItemDrawer';
import { GanttView } from '@/components/gantt/GanttView';
import { CalendarView } from '@/components/calendar/CalendarView';
import { MembersPanel } from '@/components/members/MembersPanel';
import { EditProjectDialog } from '@/components/project/EditProjectDialog';
import { ProjectSummary } from '@/components/project/ProjectSummary';
import { ProjectExportMenu } from '@/components/project/ProjectExportMenu';
import { ProjectClientField } from '@/components/client/ProjectClientField';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip';
import { cn } from '@/lib/utils';
import type { ProjectRole } from '@/types/db';
import { useT, type TKey } from '@/lib/i18n';

export function ProjectPage() {
  const { projectId } = useParams({ from: '/_app/projects/$projectId' });
  const search = useSearch({ from: '/_app/projects/$projectId' });
  const nav = useNavigate();
  const t = useT();

  useProjectRealtime(projectId);

  const [editOpen, setEditOpen] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const { data: project } = useProject(projectId);
  const { data: workItems = [] } = useWorkItems(projectId);
  const { data: dependencies = [] } = useDependencies(projectId);
  const { data: nonWorkingDays = [] } = useNonWorkingDays(projectId);
  const { data: members = [] } = useMembers(projectId);
  const { data: role } = useMyRole(projectId);

  const view = search.view ?? 'gantt';
  const selectedItem = search.item ? workItems.find((w) => w.id === search.item) : undefined;

  function setView(v: 'gantt' | 'calendar' | 'members') {
    nav({ to: '/projects/$projectId', params: { projectId }, search: { ...search, view: v, item: v === 'gantt' ? search.item : undefined } });
  }

  function selectItem(id: string | undefined) {
    nav({ to: '/projects/$projectId', params: { projectId }, search: { ...search, item: id } });
  }

  function createdItem(id: string) {
    setCreatedId(id);
    selectItem(id);
  }

  if (!project) {
    return <div className="p-6 text-sm text-neutral-500 dark:text-neutral-400">{t('project.loading')}</div>;
  }

  const canEdit: boolean = role === 'owner' || role === 'editor';
  const myRole: ProjectRole | null = role ?? null;

  return (
    <div className="h-full flex flex-col">
      <div className="relative h-12 px-4 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex items-center gap-3 shrink-0">
        {project.description ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="font-medium text-sm cursor-help">{project.name}</div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-sm whitespace-pre-wrap">
              {project.description}
            </TooltipContent>
          </Tooltip>
        ) : (
          <div className="font-medium text-sm">{project.name}</div>
        )}
        {project.description && (
          <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate max-w-md">{project.description}</div>
        )}
        {canEdit && (
          <button
            onClick={() => setEditOpen(true)}
            className="p-1 text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded"
            aria-label={t('projects.editProjectAria')}
            title={t('projects.editProject')}
          >
            <Pencil size={14} />
          </button>
        )}
        <ProjectClientField projectId={projectId} canEdit={role === 'owner'} />
        <div className="flex-1" />
        <ProjectSummary
          workItems={workItems}
          workingDays={project.working_days}
          nonWorkingDays={nonWorkingDays}
          members={members}
        />
        <ProjectExportMenu
          projectName={project.name}
          workItems={workItems}
          dependencies={dependencies}
        />
        <div className="absolute left-1/2 -translate-x-1/2 flex gap-1 bg-neutral-100 dark:bg-neutral-800 rounded p-0.5">
          {(['gantt', 'calendar', 'members'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'px-3 h-7 text-xs rounded capitalize',
                view === v
                  ? 'bg-white dark:bg-neutral-900 shadow-sm'
                  : 'hover:bg-neutral-200 dark:hover:bg-neutral-700',
              )}
            >
              {t(`project.view.${v}` as TKey)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {view === 'gantt' && (
          <GanttView
            projectId={projectId}
            workItems={workItems}
            dependencies={dependencies}
            workingDays={project.working_days}
            nonWorkingDays={nonWorkingDays}
            members={members}
            onSelect={selectItem}
            onCreate={createdItem}
            canEdit={canEdit}
            selectedId={search.item}
          />
        )}
        {view === 'calendar' && (
          <CalendarView
            projectId={projectId}
            workingDays={project.working_days}
            nonWorkingDays={nonWorkingDays}
            canEdit={canEdit}
          />
        )}
        {view === 'members' && (
          <MembersPanel projectId={projectId} members={members} myRole={myRole} />
        )}
      </div>
      {selectedItem && (
        <WorkItemDrawer
          key={selectedItem.id}
          workItem={selectedItem}
          allItems={workItems}
          dependencies={dependencies}
          workingDays={project.working_days}
          nonWorkingDays={nonWorkingDays}
          members={members}
          canEdit={canEdit}
          autoFocusName={createdId === selectedItem.id}
          initialTab={search.tab}
          onNameFocused={() => setCreatedId(null)}
          onClose={() => selectItem(undefined)}
          onNavigate={(id) => selectItem(id)}
        />
      )}
      <EditProjectDialog project={project} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}
