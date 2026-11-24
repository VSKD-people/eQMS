# VeQMS platform

The production build of VeQMS. The clickable prototype in `../veqms/` is the reference for screens and flows;
the specs in `../specs/` win when anything disagrees. Build plan and current constraints: `docs/00-build-plan.md`.

## What exists

| Part | State |
|---|---|
| `packages/db` | 8 migrations, 17 tables, forced row-level security, hash-chained audit log, insert-only signatures, locked training records, DocuSign envelope and allowance rules, outbox. 56 invariant checks and a concurrency test, run and passing on PostgreSQL 16 |
| `packages/domain` | Permissions, segregation of duties, signing plans, allowance years, training status, Connect HMAC. 9 tests, run and passing on Node 22 |
| `apps/api`, `apps/web`, infra | Not started. Needs the npm registry, which the build environment blocks |

## Run the checks

Needs Node 22.18 or later (runs TypeScript by type stripping; there is no type check yet) and a PostgreSQL 16
superuser connection (`PGHOST`, `PGUSER` and so on, or a local socket).

```bash
npm test
npm run db:test
```

`db:test` drops and recreates the database named by `VEQMS_TEST_DB` (default `veqms_test`). Don't point it at a
database you want to keep.
