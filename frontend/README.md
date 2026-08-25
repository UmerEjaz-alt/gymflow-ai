# GymFlow AI frontend

The Next.js frontend foundation for GymFlow AI. It provides shared UI primitives, theme support, formatting, and a feature-oriented code structure without product functionality.

## Commands

```bash
npm run dev
npm run lint
npm run format:check
npm run build
```

## Conventions

- Use `@/` imports for files inside `src/`.
- Add reusable shadcn/ui components to `src/components/ui/`.
- Keep product-domain code self-contained in `src/features/<feature>/`.
- Refer to [`src/README.md`](src/README.md) for the folder ownership guide.
