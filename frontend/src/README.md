# Frontend architecture

- `app/`: route definitions and route-level metadata only.
- `components/layouts/`: reusable structural components shared by route groups.
- `components/providers/`: client-side context providers configured at the root.
- `components/ui/`: reusable, composable UI primitives. shadcn/ui components belong here.
- `features/`: self-contained product domains. Each feature owns its components, hooks, services, and types.
- `hooks/`: application-wide React hooks.
- `services/`: transport and external-service clients, kept independent of UI.
- `lib/`: framework-neutral shared libraries and configuration helpers.
- `types/`: application-wide TypeScript types.
- `utils/`: small pure utilities that do not belong to a feature.

Use the `@/` alias for imports from `src/`. Keep feature-specific code within its feature directory; promote code to a shared folder only after it is used across domains.
