import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  Link,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/routes/login';
import { ProjectsListPage } from '@/routes/projects';
import { ProjectPage } from '@/routes/project';
import { InvitePage } from '@/routes/invite';
import { AuthCallbackPage } from '@/routes/authCallback';
import { ProfilePage } from '@/routes/profile';

interface RouterContext {
  queryClient: QueryClient;
}

async function requireAuth() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    throw redirect({ to: '/login' });
  }
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
  component: AuthCallbackPage,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  component: InvitePage,
});

const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_app',
  beforeLoad: requireAuth,
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/projects' });
  },
  component: () => null,
});

const projectsListRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/projects',
  component: ProjectsListPage,
});

const profileRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/profile',
  component: ProfilePage,
});

interface ProjectSearch {
  item?: string;
  view?: 'tree' | 'gantt' | 'members';
}

const projectRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/projects/$projectId',
  validateSearch: (s: Record<string, unknown>): ProjectSearch => ({
    item: typeof s.item === 'string' ? s.item : undefined,
    view: s.view === 'gantt' || s.view === 'members' || s.view === 'tree' ? s.view : undefined,
  }),
  component: ProjectPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  authCallbackRoute,
  inviteRoute,
  appLayoutRoute.addChildren([indexRoute, projectsListRoute, profileRoute, projectRoute]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}

export { Link };
