# @parasol/core

Shared domain types, Zod schemas, and pure utilities. No I/O. No side effects. No framework dependencies.

This package is the contract surface between every other package. Anything that crosses a package boundary — `Document`, `Clause`, `Severity`, `WorkspaceId`, `ReviewRecommendation`, etc. — is defined here.

## Structure

```
src/
├── index.ts          # Public exports
├── types/            # Domain types (Document, Clause, Review, Workspace, ...)
├── schemas/          # Zod schemas paired 1:1 with types
├── ids/              # Branded ID types (WorkspaceId, ReviewId, ClauseId)
├── result/           # Result<T,E> type for explicit error handling
└── utils/            # Pure utilities (severity ordering, citation formatting)
```

## Conventions

- **Types and schemas paired.** Every `Document` type in `types/document.ts` has a `documentSchema` in `schemas/document.ts`. Use `z.infer` to derive the type from the schema; export both.
- **No I/O.** This package never imports from `@parasol/corpus`, `@parasol/ai`, Supabase, or anything that touches the network or filesystem. Pure data types and pure functions only.
- **Branded IDs.** Use `WorkspaceId` not `string` so the type system catches `workspaceId` being passed where a `userId` was expected.
- **Severity ordering** is `low < medium < high < critical`. Defined once here, imported everywhere.

## What goes where

| Belongs in @parasol/core | Belongs elsewhere |
|--------------------------|-------------------|
| `Document` type | Document parsing → `@parasol/corpus` |
| `Clause` type | Clause extraction stage → `@parasol/ai` |
| `Severity` enum | Severity assignment logic → `@parasol/ai` |
| `Review` type | Review orchestration → `@parasol/ai` |
| `WorkspaceId` branded type | Workspace queries → app or `@parasol/corpus` |
| Citation formatter | Citation retrieval → `@parasol/corpus` |
