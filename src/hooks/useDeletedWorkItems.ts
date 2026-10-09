import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { siblingCompare } from '@/lib/levels';
import type { WorkItem } from '@/types/db';
import { deletedWorkItemsKey, workItemsKey } from './useWorkItems';
import { dependenciesKey } from './useDependencies';
import { tasksDataKey } from './useTasksData';

// Soft-deleted work items are invisible to the client: wi_select is
// `is_member(project_id) and deleted_at is null`. The audit trail is not —
// audit_select only checks membership, and log_changes() writes a 'delete' row
// carrying the full row (deleted_at included) whenever deleted_at goes from null
// to a value. So the bin is reconstructed from audit_log without any new
// server-side surface: an item is in the bin when its most recent delete/restore
// event is a soft delete.
//
// Deleted items are kept until someone purges them ("Delete permanently") —
// there is deliberately no scheduled purge. A purge is a real DELETE, which
// log_changes() records as 'delete' with after = null, so a purged item drops
// out of the bin on its own.

// No time window: nothing prunes audit_log, so a window would hide items that
// are still deleted (and still restorable) just because they are old.
const PAGE = 1000;
const MAX_ROWS = 10000;

interface AuditRow {
  entity_id: string;
  project_id: string;
  actor_id: string | null;
  action: 'delete' | 'restore';
  after: WorkItem | null;
  at: string;
}

export interface DeletedItem {
  /** The row as it was at the moment it was deleted. */
  item: WorkItem;
  deletedAt: string;
  deletedBy: string | null;
}

/**
 * One deletion as the user performed it: the item they deleted plus every
 * sub-item soft_delete_work_item took down with it. Recursive deletes stamp the
 * whole subtree with the same transaction timestamp, which is what ties them
 * together.
 */
export interface TrashEntry {
  root: DeletedItem;
  /** Same-batch descendants in outline order, parents before children. */
  descendants: { entry: DeletedItem; depth: number }[];
}

export function useDeletedWorkItems(liveItems: WorkItem[] | undefined) {
  const query = useQuery({
    queryKey: deletedWorkItemsKey,
    staleTime: 30_000,
    queryFn: async (): Promise<DeletedItem[]> => {
      const rows: AuditRow[] = [];
      for (let from = 0; from < MAX_ROWS; from += PAGE) {
        const { data, error } = await supabase
          .from('audit_log')
          .select('entity_id,project_id,actor_id,action,after,at')
          .eq('entity_type', 'work_item')
          .in('action', ['delete', 'restore'])
          .order('at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...((data ?? []) as AuditRow[]));
        if (!data || data.length < PAGE) break;
      }

      // Newest first, so the first event seen per entity is its current state.
      const seen = new Set<string>();
      const out: DeletedItem[] = [];
      for (const r of rows) {
        if (seen.has(r.entity_id)) continue;
        seen.add(r.entity_id);
        if (r.action !== 'delete' || !r.after || !r.after.deleted_at) continue;
        out.push({ item: r.after, deletedAt: r.after.deleted_at, deletedBy: r.actor_id });
      }
      return out;
    },
  });

  // Cross-check against what is actually live: anything the Tasks dataset can
  // see is not deleted, whatever the log says (e.g. restored by a path that
  // bypassed the trigger).
  const entries = useMemo(() => {
    if (!query.data) return undefined;
    const live = new Set((liveItems ?? []).map((w) => w.id));
    return buildEntries(query.data.filter((d) => !live.has(d.item.id)));
  }, [query.data, liveItems]);

  const byId = useMemo(() => {
    const m = new Map<string, DeletedItem>();
    for (const d of query.data ?? []) m.set(d.item.id, d);
    return m;
  }, [query.data]);

  return { ...query, entries, byId };
}

function buildEntries(deleted: DeletedItem[]): TrashEntry[] {
  const batchOf = (d: DeletedItem) => `${d.item.project_id}|${d.deletedAt}`;
  const byId = new Map(deleted.map((d) => [d.item.id, d]));

  const kids = new Map<string, DeletedItem[]>();
  const roots: DeletedItem[] = [];
  for (const d of deleted) {
    const parent = d.item.parent_id ? byId.get(d.item.parent_id) : undefined;
    if (parent && batchOf(parent) === batchOf(d)) {
      const arr = kids.get(parent.item.id);
      if (arr) arr.push(d);
      else kids.set(parent.item.id, [d]);
    } else {
      roots.push(d);
    }
  }
  for (const arr of kids.values()) arr.sort((a, b) => siblingCompare(a.item, b.item));

  const entries: TrashEntry[] = roots.map((root) => {
    const descendants: TrashEntry['descendants'] = [];
    const walk = (id: string, depth: number) => {
      for (const c of kids.get(id) ?? []) {
        descendants.push({ entry: c, depth });
        walk(c.item.id, depth + 1);
      }
    };
    walk(root.item.id, 1);
    return { root, descendants };
  });
  entries.sort((a, b) => (a.root.deletedAt < b.root.deletedAt ? 1 : a.root.deletedAt > b.root.deletedAt ? -1 : 0));
  return entries;
}

/** Thrown when the purge RPC has not been installed on the database yet. */
export class PurgeUnavailableError extends Error {}

// restore_work_item brings back the item, every descendant deleted in the same
// batch (same deleted_at), and any deleted ancestors — just the ancestor rows,
// not the rest of their batch, so a live item never has a deleted parent.
async function restoreEntry(e: TrashEntry): Promise<void> {
  const { error } = await supabase.rpc('restore_work_item', { p_id: e.root.item.id });
  if (error) throw error;
}

function useInvalidateAfterBinChange() {
  const qc = useQueryClient();
  return (projectIds: Iterable<string>) => {
    for (const p of new Set(projectIds)) {
      qc.invalidateQueries({ queryKey: workItemsKey(p) });
      qc.invalidateQueries({ queryKey: dependenciesKey(p) });
    }
    qc.invalidateQueries({ queryKey: tasksDataKey });
    qc.invalidateQueries({ queryKey: deletedWorkItemsKey });
  };
}

export function useRestoreTrashEntries() {
  const invalidate = useInvalidateAfterBinChange();
  return useMutation({
    mutationFn: async (entries: TrashEntry[]) => {
      // Shallowest first. Restoring a child first would revive its deleted
      // parent on its own; the parent's entry would then be a no-op (the RPC
      // returns early for a live item) and its other sub-tasks stay deleted.
      const ordered = [...entries].sort((a, b) => a.root.item.level - b.root.item.level);
      for (const e of ordered) await restoreEntry(e);
    },
    onSettled: (_d, _e, entries) => invalidate(entries.map((e) => e.root.item.project_id)),
  });
}

export function usePurgeTrashEntries() {
  const invalidate = useInvalidateAfterBinChange();
  return useMutation({
    mutationFn: async (entries: TrashEntry[]) => {
      for (const e of entries) {
        const { error } = await supabase.rpc('purge_work_item', { p_id: e.root.item.id });
        if (error) {
          // PGRST202: PostgREST has no function by that name/signature.
          if (error.code === 'PGRST202') throw new PurgeUnavailableError(error.message);
          throw error;
        }
      }
    },
    onSettled: (_d, _e, entries) => invalidate(entries.map((e) => e.root.item.project_id)),
  });
}
