import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useProfile, useUpdateProfile } from '@/hooks/useProfile';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { toast } from 'sonner';
import { displayName } from '@/lib/userDisplay';
import { useT } from '@/lib/i18n';

export function ProfilePage() {
  const { user } = useAuth();
  const { data: profile, isLoading } = useProfile(user?.id);
  const update = useUpdateProfile();
  const t = useT();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [notif, setNotif] = useState(true);

  useEffect(() => {
    setFirstName(profile?.first_name ?? '');
    setLastName(profile?.last_name ?? '');
    setNotif(profile?.notifications_enabled ?? true);
  }, [profile]);

  if (!user) return null;

  const previewUser = {
    user_id: user.id,
    email: user.email ?? null,
    first_name: firstName || null,
    last_name: lastName || null,
  };

  async function save() {
    if (!user) return;
    try {
      await update.mutateAsync({
        user_id: user.id,
        patch: {
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          notifications_enabled: notif,
        },
      });
      toast.success(t('profile.saved_toast'));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6 overflow-y-auto h-full">
      <h2 className="text-base font-semibold">{t('profile.title')}</h2>

      <div className="flex items-center gap-4 border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900 p-4">
        <Avatar user={previewUser} size="lg" />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{displayName(previewUser)}</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{user.email}</div>
        </div>
      </div>

      <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900 p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('profile.firstName')}>
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder={t('profile.firstNamePlaceholder')}
              autoFocus
            />
          </Field>
          <Field label={t('profile.lastName')}>
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder={t('profile.lastNamePlaceholder')}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notif}
            onChange={(e) => setNotif(e.target.checked)}
          />
          {t('profile.enableNotifications')}
        </label>

        <div className="flex justify-end pt-2">
          <Button onClick={save} disabled={isLoading || update.isPending}>
            {update.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}
