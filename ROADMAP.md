# Parasol Roadmap

Sprint sequence to v1 public launch, then v2 EAC expansion. Each sprint is roughly 2 weeks of focused work. SPRINT.md always reflects the *current* sprint only; this document tracks the broader sequence.

## v1: Kenya in-house counsel — public launch

### Sprint 1: Foundation (current)
Corpus pipeline, NDA playbook, end-to-end orchestration on NDA only, eval harness with 20-NDA golden dataset, email intake on `ask.parasol.co.ke`, web upload, corpus admin (read-only + manual run). Sonnet 4.7 baseline on heavy stages. **See SPRINT.md.**

### Sprint 2: Three more contract types + Opus A/B
DPA, MSA, SaaS playbooks for Kenya. Eval dataset extended to 80 contracts (20 per type). Triage stage extended to route between types. Playbook regression suite. Day 1 of sprint runs the Opus 4.7 A/B test on `compare-playbook` and `generate-redline` per DEF-041; adopt or defer based on eval delta.

### Sprint 3: Workspace, auth, billing
Multi-tenant workspace creation. Workspace-prefixed inbound addresses (`ask@<workspace>.parasol.co.ke`) via wildcard MX per DEF-002. Supabase Auth with email + Microsoft + Google OAuth. Stripe USD billing for Solo, Team, Business tiers per PRICING.md. KSh price displays at locked KES/USD rate. Trial flow (14-day full feature).

### Sprint 4: Repository, search, reports + corpus automation
Contract repository view with metadata, status, severity-at-a-glance. Search across reviewed contracts. Per-month value dashboard (hours saved, counsel spend avoided). Vercel Cron wired for daily corpus ingestion (DEF-017) and weekly Gazette diff (DEF-018). Schedule editor in corpus admin UI.

### Sprint 5: Escalation flow + audit UI + DPA
Nominated external counsel configuration per workspace (DEF-037). Escalate-to-counsel modal in web. Reply-with-`escalate` flow in email. Pre-populated context email to nominated counsel with redline + analysis attached. Logged as a separate event type in audit log. Audit log UI viewer (DEF-038). Customer DPA template authored (DEF-014). Pending-diff review UI (DEF-019).

### Sprint 6: Mobile PWA capture
Photograph-of-paper-contract flow. Camera capture with multi-page assembly. Perspective correction via Sonnet vision. Email-based result delivery for unauthenticated trial users. Full integration for paid users.

### Sprint 7: Trust UX polish + activation flow + M-PESA decision
Confidence calibration UX, citation hyperlink-through, ROI calculator (DEF-039), public marketing site at parasol.co.ke. Activation flow refinement based on Sprint 3-6 user data. **M-PESA acceptance decision per DEF-042** based on customer demand evidence: Paddle/Dodo MoR, agent (Path B), or stay USD-only. Realtelligence-style content marketing newsletter launched (DEF-040).

### Sprint 8: Hardening + launch
Performance optimisation. Eval acceptance bar raised to v1 launch levels per DEF-026 (≥0.88 F1, ≥4.2 redline, <1% hallucination). Penetration test (DEF-015). DMARC tightened to `p=quarantine` (DEF-003). Source-level circuit breakers + alerting (DEF-020). Coverage health checks (DEF-021). Pricing page final copy. Launch.

**v1 launch criterion:** ten paying Kenya-based workspaces across at least three industries, with each workspace processing ≥10 contracts per month for two consecutive months.

## v1.5: Surface expansion (3-4 sprints)

- Slack and Microsoft Teams bot (DEF-031)
- Microsoft Word add-in (DEF-030)
- Custom playbook editor UI (DEF-029)
- Approval workflow for Business tier (junior drafts, GC approves)

## v2: EAC expansion (4-6 sprints)

- Uganda jurisdiction: ULII corpus ingestion, UG-specific playbook deltas, KRA-equivalent regulatory grounding (URA), DPA equivalent
- Tanzania jurisdiction: TanzLII corpus, TZ playbook deltas, TRA grounding, Personal Data Protection Act
- Rwanda jurisdiction: RwandaLII corpus, RW playbook deltas
- Multi-jurisdictional review (one contract, multiple governing law analyses)
- Swahili language support across UI and document analysis
- Cross-border banking/telco use cases (Equity, KCB, Safaricom)
- Hosting migration to af-south-1 if customer evidence justifies (DEF-022)
- Industry playbook variants (DEF-032)
- Local presence decision per DEF-013 (Kenyan agent or subsidiary, contingent on customer evidence)

## v3: Adjacent surfaces

- API + SDK for Business+ tier customers to integrate Parasol into their CLM
- iManage and SharePoint integrations
- DocuSign / Adobe Sign integrations (review before send)
- Outside counsel management (matter intake portal, RFQ workflow, billing review)
- Regulatory monitoring product (separate paid add-on; CBK circulars, KRA rulings, ODPC determinations digest)

## v4 and beyond (speculative)

- Nigeria, Ghana, Egypt, South Africa expansion
- Legal-vertical Anthropic partnership for fine-tuned model on Parasol's anonymised review data
- White-label for law firms (Bowmans, A&K) to offer Parasol-powered triage to their corporate clients
- Litigation pre-trial document analysis

## North star metric

Active workspaces with ≥10 reviews/month, growing 15%+ MoM. Secondary: outside counsel spend avoided per workspace per month (the CFO-friendly receipt).
