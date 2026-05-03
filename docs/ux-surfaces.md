# UX Surfaces

Detail on the customer-facing intake and interaction surfaces. Internal admin surfaces are documented separately in [`admin-surfaces.md`](./admin-surfaces.md).

## Surface priorities

| Surface | Priority | Reason |
|---------|----------|--------|
| Email forwarding | P0 (v1) | Dominant SME workflow; lowest friction onboarding |
| Web upload + dashboard | P0 (v1) | Settings, repository, playbook view, billing |
| Mobile PWA capture | P1 (v1) | Differentiator for field/meeting use cases |
| Slack and Teams bot | v1.5 | Reduces friction for already-connected teams |
| Word add-in | v1.5 | High-frequency MS-365 workflow once teams scale |
| Custom playbook editor (UI) | v1.5 | YAML in v1; UI editor lets lawyers self-serve |
| API + SDK | v1.5 | Business-tier integration into internal CLM |

## Email forwarding (P0)

**Address pattern:** `ask@<workspace-slug>.parasol.co.ke`

Each workspace gets a subdomain on signup. The user's company in Mackays Marketing → `ask@mackays.parasol.co.ke`. Equity Bank's mid-corporate desk → `ask@equity-midcorp.parasol.co.ke`. Personal/founder workspace → `ask@<chosen-slug>.parasol.co.ke`.

**Why this pattern:** Customers add the address to their address book once and forward thereafter. Subdomain is the workspace identity, the local-part `ask` is consistent and memorable. Reply-all flows preserve the workspace-level routing without exposing internal identifiers. Wildcard `*.parasol.co.ke` MX (DEF-002) handles all workspaces with a single Resend configuration.

Sprint 1 dev uses fixed `ask.parasol.co.ke` (any local-part accepted). Sprint 3 introduces real workspace creation and the workspace-prefixed pattern.

**The send flow:**

1. User forwards counterparty email-with-attachment, or new email with attachment, to their workspace address
2. Resend inbound webhook fires; Parasol API receives parsed payload
3. Sender validation: must be on workspace allow-list (any address from workspace's verified domains, plus explicit invitees)
4. Attachment(s) extracted; if multiple, the most recent is treated as the contract; if single, used directly; if no attachment, body is treated as pasted text
5. Routes through main pipeline (intake → triage → review → output)
6. Reply email assembled and sent within 90 seconds (target)

**The reply email:**

- From: workspace-aware sender. Sprint 1: `Parasol <hello@parasol.co.ke>`. Sprint 3+: `Parasol <hello@<workspace>.parasol.co.ke>` so reply-all preserves workspace context.
- Subject: `Re: <original subject> — Parasol review`
- Body: structured per the design in `BRAND.md` and the `parasol_email_response` artefact. Severity-grouped issue list, citation hyperlinks back to the web view, footer with one-click escalate-to-counsel.
- Attachment: redlined .docx with native tracked changes
- Sign-off: `— Parasol`

**Sender validation:**

- Allow-list: workspace's verified domain(s) + explicit invitees added by the workspace admin
- DKIM/SPF/DMARC must align — forged-sender protection
- First-time sender from an allowed domain triggers a "we noticed [name] forwarded you their first contract — want them on your team?" notification to the workspace admin

**Polite refusal cases:**

- Sender not on allow-list → reply explaining workspace setup (does NOT process the contract)
- Document is not a contract (per triage classification) → reply offering to answer as a research question instead
- Contract type not yet supported → reply with helpful explanation, capture interest signal

## Web upload + dashboard (P0)

**Routes:**

- `/` — marketing landing (separate site, not in this scope; mentioned for completeness)
- `/login` — Supabase Auth (email + Microsoft + Google OAuth)
- `/app` — authenticated home; recently reviewed contracts, quick actions
- `/app/review/new` — upload or paste flow
- `/app/review/<id>` — review detail (matches `parasol_contract_review_detail` artefact)
- `/app/repository` — full reviewed-contract list with search and filters (Sprint 4 / DEF-036)
- `/app/playbooks` — view default playbooks; v1 read-only; v1.5 editable
- `/app/team` — seat management (Team+ tier)
- `/app/settings` — workspace settings, integrations, billing, audit log
- `/app/audit` — audit log viewer (Business tier; Sprint 5 / DEF-038)

**Design principles:** Per `BRAND.md`. Restrained, generous whitespace, severity ramps for meaning, no decorative amber, sentence case throughout.

**Critical interaction patterns:**

- Drag-and-drop on `/app/review/new` — the upload box dominates the screen
- Progress indicator surfaces pipeline stages by name (Identifying clauses, Applying playbook, Verifying citations, Generating redline)
- Result view loads progressively: structured issues stream in as they're produced
- Citation hyperlinks open inline drawer with cited authority text excerpt + link to corpus view
- Confidence shown as dot+label (never numeric)
- Severity left-border (3px) on issue cards; pill in upper-right
- "Download redline" produces .docx with native tracked changes; primary action button
- "Escalate to counsel" (Sprint 5 / DEF-037) opens modal with pre-populated context email

## Mobile PWA capture (P1)

Same Next.js codebase, mobile-optimised. Installable as PWA from app.parasol.co.ke. Camera capture via the standard `<input type="file" accept="image/*" capture="environment">` pattern with multi-page assembly. Sprint 6 work.

**Capture flow:**

1. PWA home: large "Capture contract" CTA above repository list
2. Tap CTA → camera opens with a guide outline frame
3. Capture page → preview → "another page?" yes/no
4. After all pages, preview thumbnails in order; allow reorder
5. Confirm contract type (auto-detected by triage; user can correct)
6. Submit → notification when review ready
7. View in PWA or wait for email

**Why PWA, not native:** v1 budget. Native iOS/Android is v2 if customer evidence justifies. PWA covers the ~85% of phone-capture use cases that matter at v1 scale.

## Slack and Microsoft Teams (v1.5 / DEF-031)

**Slack flow:**

- Workspace admin installs Parasol Slack app
- App authenticates via OAuth and binds to Parasol workspace
- User uploads a contract to the bot's DM, or `/parasol review` slash command in a channel
- Bot processes through the pipeline
- Result posted as threaded reply with structured issue blocks and download buttons
- Channel-level review keeps team in the loop

**Teams flow:** Microsoft Bot Framework, equivalent flow.

**Why deferred:** Email already handles the asynchronous-forward case. Slack/Teams is the convenience-add-on, valuable but not v1-critical.

## Word add-in (v1.5 / DEF-030)

**Surface:** Office.js task pane sideloaded from Microsoft 365 admin centre (Business tier in v1.5; AppSource publication in v2).

**Flow:**

1. User opens a counterparty's draft in Word
2. Opens Parasol task pane
3. Clicks "Review against [playbook]"
4. Pane shows progress; results stream in as issue cards
5. Click an issue card → Word selects the corresponding clause range
6. Click "Apply recommended language" → tracked-change replacement inserted in Word
7. Word's native review tools handle the rest

**Why deferred:** Email and web cover the bulk of the workflow. Word add-in is the convenience layer for already-converted customers, not the customer-acquisition surface.

## Custom playbook editor (v1.5 / DEF-029)

**Surface:** `/app/playbooks/edit`

**Flow:**

1. List of default playbooks per jurisdiction × contract type
2. Click "Customise" on a playbook → fork into workspace override
3. Schema-driven form per clause: standard/fallback/hard-limit positions, severity, citations, market norm rationale
4. Test mode: run the playbook against a sample contract, see the deltas before publishing
5. Version history with rollback
6. Approval workflow for Business tier (junior drafts, GC approves)

**v1 path:** YAML files in repo are source of truth. Customers can request workspace-level overrides through Tim or the CSM. UI editor is v1.5.

## API + SDK (v1.5)

**Surface:** REST API at api.parasol.co.ke with OpenAPI 3.1 spec.

**Endpoints (initial):**

- `POST /v1/reviews` — submit a contract for review
- `GET /v1/reviews/:id` — poll for completion
- `GET /v1/reviews/:id/redline` — download .docx
- `GET /v1/reviews/:id/issues` — structured JSON of issues
- `POST /v1/reviews/:id/escalate` — trigger escalation flow
- `GET /v1/playbooks` — list playbooks accessible to workspace
- `GET /v1/audit` — audit log entries (Business tier)

**SDKs:** TypeScript first; Python second. Generated from OpenAPI spec.

**Auth:** API tokens scoped to workspace, not user. Tokens issued through `/app/settings/api`.

**Rate limits:** 60 reviews/hour fair use on Business; higher with conversation.

## Cross-surface concerns

**Audit log writes** on every action across every surface. Schema in `packages/core/src/audit`.

**Notifications:** email (always) and in-app (web + PWA). Slack/Teams when integrated. Push notifications via PWA where supported by browser.

**Accessibility:** WCAG 2.1 AA target. Keyboard navigation throughout. Screen reader labels on all interactive elements. Severity not communicated by colour alone (always paired with text and icon).

**Internationalisation:** v1 English-only UI. Swahili UI in v2 alongside Swahili contract language support. RTL support not on roadmap.

**Performance budgets:**
- First contentful paint <1.5s on 3G mobile
- Time to interactive <3s on 3G mobile
- Review submission latency p95 <60s for documents up to 10 pages
