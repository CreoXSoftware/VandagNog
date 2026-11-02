import type { TKey } from '@/lib/i18n';
import type { FeedbackPriority, FeedbackStatus, FeedbackType } from '@/types/db';

// Labels and badge colours for feature requests / bug reports.

export const FEEDBACK_STATUSES: FeedbackStatus[] = ['new', 'approved', 'in_progress', 'done', 'rejected'];
export const FEEDBACK_PRIORITIES: FeedbackPriority[] = ['low', 'medium', 'high', 'critical'];

export const feedbackStatusKey: Record<FeedbackStatus, TKey> = {
  new: 'feedback.statusNew',
  approved: 'feedback.statusApproved',
  in_progress: 'feedback.statusInProgress',
  done: 'feedback.statusDone',
  rejected: 'feedback.statusRejected',
};

export const feedbackPriorityKey: Record<FeedbackPriority, TKey> = {
  low: 'feedback.priorityLow',
  medium: 'feedback.priorityMedium',
  high: 'feedback.priorityHigh',
  critical: 'feedback.priorityCritical',
};

export const feedbackTypeKey: Record<FeedbackType, TKey> = {
  feature: 'feedback.typeFeature',
  bug: 'feedback.typeBug',
};

export const feedbackStatusClass: Record<FeedbackStatus, string> = {
  new: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  approved: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  in_progress: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  rejected: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
};

export const feedbackTypeClass: Record<FeedbackType, string> = {
  feature: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  bug: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

export const feedbackPriorityClass: Record<FeedbackPriority, string> = {
  low: 'text-neutral-500 dark:text-neutral-400',
  medium: 'text-neutral-700 dark:text-neutral-300',
  high: 'text-amber-700 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400',
};
