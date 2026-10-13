import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearch, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { CheckCircle2, Pencil, RotateCcw } from 'lucide-react';
import { useProject, useSetProjectCompleted } from '@/hooks/useProjects';
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
import { ProjectSwitcher } from '@/components/project/ProjectSwitcher';
import { CompletedBadge } from '@/components/project/CompletedBadge';
import { cn } from '@/lib/utils';
import { useCurrentOrg } from '@/lib/currentOrg';
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
  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const { data: workItems = [] } = useWorkItems(projectId);
  const { data: dependencies = [] } = useDependencies(projectId);
  const { data: nonWorkingDays = [] } = useNonWorkingDays(projectId);
  const { data: members = [] } = useMembers(projectId);
  const { data: role } = useMyRole(projectId);
  const setCompleted = useSetProjectCompleted();
  const { org, setOrgId } = useCurrentOrg();

  // Opening a project of another organization (a link, a notification) makes
  // that org the current one, so the top bar and every list match it. Once per
  // project: picking another org in the top bar from here must not bounce back.
  const syncedOrgFor = useRef<string | null>(null);
  useEffect(() => {
    if (!project || syncedOrgFor.current === project.id) return;
    syncedOrgFor.current = project.id;
    if (project.org_id !== org.id) setOrgId(project.org_id);
  }, [project, org.id, setOrgId]);

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
    // null (not undefined) once loaded: deleted, or access removed.
    if (projectLoading || project === undefined) {
      return <div className="p-6 text-sm text-neutral-500 dark:text-neutral-400">{t('project.loading')}</div>;
    }
    return (
      <div className="p-6 text-sm text-neutral-500 dark:text-neutral-400 space-y-2">
        <div>{t('project.notFound')}</div>
        <Link to="/projects" className="text-sky-700 dark:text-sky-400 hover:underline">
          {t('project.backToProjects')}
        </Link>
      </div>
    );
  }

  const canEdit: boolean = role === 'owner' || role === 'editor';
  // Project settings (name, description, organization, delete) are for owners:
  // org owners/admins, the creator, or whoever was made owner.
  const isOwner = role === 'owner';
  const myRole: ProjectRole | null = role ?? null;
  const completed = !!project.completed_at;

  function toggleCompleted() {
    setCompleted.mutate(
      { id: projectId, completed: !completed },
      {
        onSuccess: () =>
          toast.success(t(completed ? 'projects.reopened_toast' : 'projects.completed_toast')),
        onError: (err) => toast.error((err as Error).message),
      },
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="relative h-12 px-4 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex items-center gap-3 shrink-0">
        <ProjectSwitcher currentProjectId={projectId} name={project.name} description={project.description} />
        {completed && <CompletedBadge />}
        {project.description && (
          <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate max-w-md">{project.description}</div>
        )}
        {isOwner && (
          <button
            onClick={() => setEditOpen(true)}
            className="p-1 text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded"
            aria-label={t('projects.editProjectAria')}
            title={t('projects.editProject')}
          >
            <Pencil size={14} />
          </button>
        )}
        <ProjectClientField projectId={projectId} orgId={project.org_id} canEdit={isOwner} />
        <div className="flex-1" />
        <ProjectSummary
          workItems={workItems}
          workingDays={project.working_days}
          nonWorkingDays={nonWorkingDays}
          members={members}
        />
        {canEdit && (
          <button
            onClick={toggleCompleted}
            disabled={setCompleted.isPending}
            className="flex items-center gap-1 px-1.5 h-6 rounded text-[11px] text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 whitespace-nowrap disabled:opacity-50"
            title={completed ? t('projects.reopenHint') : t('projects.markCompletedHint')}
          >
            {completed ? <RotateCcw size={12} /> : <CheckCircle2 size={12} />}
            {completed ? t('projects.reopen') : t('projects.markCompleted')}
          </button>
        )}
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
            key={projectId}
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
          <MembersPanel project={project} members={members} myRole={myRole} />
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
      {isOwner && <EditProjectDialog project={project} open={editOpen} onOpenChange={setEditOpen} />}
    </div>
  );
}
