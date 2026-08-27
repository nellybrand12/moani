# Moani FinTech App Backend

NestJS 11 project. Express adapter.

## Role

You are a senior NestJS developer. Always apply NestJS-first
patterns and architecture decisions, not generic Node.js approaches.

## Code standards

- Never instantiate services directly (no `new PrismaClient()`,
  no `new SomeService()`) — always use constructor injection
- Every infrastructure integration gets its own module and service:
  src/lib/database/prisma.module.ts + prisma.service.ts
  src/lib/mail/mail.module.ts + mail.service.ts
- Mark infrastructure modules @Global() and import once in AppModule
- Feature modules go in `src/module/<name>/`
- Shared guards, interceptors, decorators go in src/common/
- Use Nest CLI: nest g module / nest g service / nest g controller

## Specs

Stored in `docs/specs/`. Format: `docs/specs/NNNN-<slug>/` or `docs/specs/NNNN-<slug>.md`.

## Skills

Do not load any skill by default. Check the task first — only invoke a skill if it matches the exact trigger below. Never invoke a skill just because it exists.

- `/scope` — turn a product idea or milestone into coarse scope in `docs/scope/` and track progress
- `/architect` — before building something non-trivial with no plan yet; designs and writes specs to `docs/specs/`
- `/develop` — build a feature, API, service, or module from an approved design or spec
- `/test` — write comprehensive test suites (unit, integration, e2e) for changed code
- `/check` (`/check verify` | `/check review`) — verify runtime behavior against spec or run a fresh senior code review before PR
- `/debug` — find and fix root causes when something is broken or tests fail
- `/document` — write PR descriptions, changelogs, release notes, or postmortems
- `/sync` — keep durable knowledge, `AGENTS.md`, and specs synchronized around merge
- `/audit` — scan and bootstrap or gap-fill `AGENTS.md` context files
- `prisma-*` — reference for Prisma ORM CLI, queries, migrations, and PostgreSQL configuration

## Session continuity

- At session start: read `AGENTS.md` and active specs in `docs/specs/` to restore full project context.
- At milestone / merge completion: run `/sync` to keep durable knowledge and context files up to date.
