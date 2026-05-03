# Data Residency and Customer Trust Architecture

Customer-facing data handling commitments. **Path A framing**: Parasol Inc (Delaware) sells cross-border to Kenyan customers. Kenyan DPA 2019 has extraterritorial reach in theory but enforcement against non-resident foreign SaaS has been minimal in practice. The commitments below are *procurement-ready*, not regulator-mandated. They exist because customer procurement teams ask, not because a regulator will enforce.

## What Parasol commits to

### Data minimisation

Parasol processes customer documents only for the purposes the customer engaged Parasol for: contract review, redline generation, repository search, audit. No secondary use.

### Encryption

- In transit: TLS 1.3 throughout
- At rest: Supabase Storage server-side encryption (AES-256); Postgres rows encrypted at filesystem level by Supabase
- Audit log hash chain: cryptographic linkage so tampering is detectable

### Retention

- Default 12 months for reviewed documents and review outputs
- Audit log retained per tier: Solo 90 days, Team 12 months, Business 7 years
- Customer can configure shorter retention per workspace
- Customer can request deletion at any time; honoured within 30 days

### Access

- Row-level security in Postgres ensures tenant isolation; one workspace's documents are not retrievable from another's session under any code path
- Service-role access in app code is forbidden by CLAUDE.md (DEF-009); only admin scripts with explicit Tim approval
- Parasol staff access to customer documents is logged in audit log, time-limited, and only for support cases the customer has opened

### Sub-processors

Parasol's sub-processors handle specific functions; customer documents and personal data may pass through these in the course of normal operation:

| Sub-processor | Function | Data | Region | Notes |
|---------------|----------|------|--------|-------|
| Supabase | Database, storage, auth | All customer data | eu-west-2 (London) | Encrypted at rest; RLS-isolated per workspace |
| Vercel | Web hosting, edge delivery | Application traffic | Default routing | TLS 1.3; no document content stored at edge |
| Anthropic | Claude API (Opus 4.7, Sonnet 4.7, Haiku 4.5) | Document content (during processing) | Per Anthropic deployment | Zero-data-retention configured; verified pre-release |
| Voyage AI | Embeddings, rerank | Anonymised query text | Per Voyage deployment | No customer document body sent in queries |
| Resend | Email outbound + inbound | Email metadata, document attachments | eu-west-1 (Ireland) | DKIM/SPF/DMARC verified |
| Stripe | Billing | Payment metadata; no document content | Per Stripe deployment | PCI-DSS Level 1 |
| Sentry | Error tracking | Application errors with PII scrubbed | Per Sentry deployment | PII scrubbing config per DEF-008 |

The sub-processor list is published as part of the Customer DPA (DEF-014). Customer is notified at least 30 days before any sub-processor change.

## Customer DPA template (DEF-014)

Drafted in Sprint 5. Standard form for Solo and Team tiers. Negotiable for Business. Includes:

- Parasol Inc (Delaware) as data processor; Customer as data controller
- Cross-border transfer: Parasol's Standard Contractual Clauses (SCC) annex covering Kenya → United States data flow
- Sub-processor list (above) with regions specified
- Technical and Organisational Measures (TOMs) annex
- Data subject rights handling: Parasol assists Customer in fulfilling DSR within 14 days of receipt
- Data breach notification: Parasol notifies Customer within 48 hours of confirmed breach
- Audit rights: Customer may request once-per-year remote audit of Parasol's compliance posture
- Termination: data returned or deleted within 30 days of contract termination

## Hosting and latency

**v1 hosting:**
- Database (Supabase): eu-west-2 (London)
- Web hosting (Vercel): default routing
- AI (Anthropic): API region per Anthropic's deployment
- Email (Resend): eu-west-1 (Ireland)

**Latency from Nairobi:** ~140ms to London, ~110ms to Cape Town. v1 hosting acceptable for customer experience. v2 plan: migrate to AWS af-south-1 (Cape Town) per DEF-022 if customer evidence justifies — either latency complaints or procurement-driven local-presence demand.

## What this is *not*

- **Not a Kenyan-resident processor designation.** Parasol Inc is a US company. Customers' procurement teams sometimes request Kenyan-incorporated vendors; that's a Path B/Path C decision deferred to DEF-013.
- **Not ODPC-registered as a Kenyan data processor.** ODPC registration applies to Kenyan-registered entities. Parasol Inc operating cross-border into Kenya is in the same legal posture as Legora, Harvey, Notion, Slack, Figma, GitHub, and every other cross-border SaaS into Kenya. Some of those companies have voluntarily registered with ODPC for procurement purposes; Parasol will do the same opportunistically when a customer's procurement specifically requires it (DEF-013 trigger).
- **Not certified to ISO 27001 or SOC 2 in v1.** Both are deferred until customer demand and budget align — typical pattern is SOC 2 Type 1 in months 9-12, Type 2 by month 18, ISO 27001 only if a specific enterprise customer requires it. Cost USD 30-60k per audit cycle.
- **Not GDPR-compliant by default.** Parasol can sign a GDPR-compliant DPA with EU customers and acts as processor under GDPR; primary commitments above are sufficient. EU-specific operational changes (DPO appointment, EU representative) are deferred until customer evidence justifies.

## How customers verify the commitments

- **Customer DPA**: signable document (DEF-014, Sprint 5)
- **Sub-processor list**: linked from `/legal/sub-processors` and updated in-product
- **Transparency report**: annual, starting Q1 2027 (DEF-016)
- **Audit log access**: Business-tier customers can request a specific workspace's audit log at any time
- **Penetration test summary**: shareable redacted report from the launch pen test (DEF-015) and annual repeats

## Why this framing

Customer trust in EAC SaaS is earned by clear commitments and consistent operation, not by certificates. The certificates come later when the customer mix demands them. Spending v1 budget on SOC 2 instead of corpus expansion is a misallocation given the actual customer pipeline.

When a specific enterprise prospect requires SOC 2 / ISO 27001 / Kenyan local presence as a procurement gate, the question becomes "is this deal worth the certification cost?" rather than "do we need certification to play in this market?". The answer in v1 has been no for both questions; the answer in v1.5+ may shift on either.
