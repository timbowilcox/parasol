# Parasol Product

## One-line

Parasol replaces the first 60-70% of work an EAC company sends to its external lawyers — for less than the cost of a single avoided invoice per month.

## The problem

In-house counsel and finance leaders at Kenyan, Ugandan, Tanzanian, and Rwandan companies receive a constant stream of inbound third-party contracts: vendor NDAs, SaaS terms, data processing addenda, master service agreements, supply contracts, employment agreements, leases. Most of this work follows known patterns and could be triaged by a competent associate against the company's standard positions. But:

- Internal capacity is thin. A typical Kenyan mid-corporate has 1-5 in-house lawyers covering everything from board matters to compliance.
- External counsel is expensive. A single MSA review at Bowmans or A&K runs KSh 80,000–250,000.
- Existing tooling (Westlaw, LexisNexis) has weak Kenya coverage and is priced for global Magic Circle, not Nairobi mid-market.
- The lawyer-to-population ratio is structurally below global averages, so external counsel is also bandwidth-constrained.
- DPA 2019 and adjacent regulatory volume has created a flood of data processing addenda nobody has time to review properly.

The result: contracts get rubber-stamped under time pressure, or sit in legal queues for weeks, or get sent externally at cost. None of these outcomes is good.

## The solution

Parasol is an AI copilot that:

1. Accepts an inbound contract through any surface the user already uses — email forward to `ask@<workspace>.parasol.co.ke`, web upload, photograph from phone — in any format (PDF digital, PDF scanned, photo, .docx, Google Doc).
2. Identifies the contract type, applies the company's playbook of standard positions for that type, and generates a clause-by-clause redline with cited Kenyan or EAC legal authority backing each recommendation.
3. Returns the analysis and redlined document within 60 seconds, with calibrated confidence on every flagged issue (high / medium / manual review recommended).
4. Lets the user accept the redline as-is, edit it, or one-click escalate to their nominated external counsel with a pre-populated context email and the analysis attached.
5. Logs every action to an immutable audit trail for compliance and later review.

The product is positioned as the layer *under* a company's external counsel relationship, not above it. External lawyers receive better-prepared briefs and become advocates for Parasol with their corporate clients.

## ICP

**Primary v1:** In-house counsel teams of 1-15 at EAC mid-corporates and scaleups.

Tier examples:
- Mid-tier banks: Family Bank, Sidian, NCBA mid-corporate desks
- Insurance: Britam mid-corporate, Jubilee, ICEA Lion regional ops
- Tech scaleups: M-KOPA, Sun King, Wasoko, Apollo Agriculture, Komaza, Ilara Health, Sendy
- Manufacturing & FMCG: Brookside, Bidco, Kakuzi, Williamson Tea
- Healthcare: Aga Khan Group, Nairobi Hospital, AAR, Avenue Hospitals
- Education: Strathmore, USIU, Brookhouse
- Listed mid-caps on the NSE outside the top ten
- NGO operations: Oxfam EA, BRAC, Mercy Corps Kenya, Save the Children

**Secondary v1:** Founder-GCs and solo in-house lawyers at Series A/B startups; CFOs and ops leaders at sub-50-person companies who handle legal-adjacent work.

**Not v1 ICP:**
- Bowmans, A&K, Cliffe Dekker, Kaplan & Stratton, Iseme Kamau & Maema, Coulson Harney. These are referral partners through escalation flow, not customers. They will eventually want a firm-tier offering — that is v3+.
- Multinational subsidiaries with Harvey or Legora deployed at HQ. We may absorb them via the workspace adoption flow; we do not sell to them directly.
- Pure consumer access-to-justice. That space is served by Wakili, Sheriaplex, Kenyanlaw.com. Different category, different price, different product.

## Path A architecture and what it implies for the customer narrative

Parasol Inc is a Delaware-incorporated US company. v1 sells cross-border to Kenyan customers in USD via Stripe — the same model used by Legora, Harvey, Notion, Slack, Figma, GitHub, and every other successful cross-border SaaS into Kenya.

This is a deliberate v1 choice, not an oversight. Setting up a Kenyan entity is expensive, slow, and only justified by customer evidence that Path A is leaving meaningful revenue on the table (deferred per DEF-013 to a customer-evidence-driven decision).

What this means for the customer narrative:

- Parasol is **EAC-focused, not Kenyan-incorporated**. The local-credibility value comes from corpus depth, playbook quality, ICP knowledge, and founder relationships — not from a Kenyan registration certificate. Customers care about the product working, the data handling being defensible, and the value proposition being real.
- Customer data handling commitments (ZDR upstream, encrypted at rest, sub-processor list, customer DPA template) are **procurement-ready**, not regulator-mandated. Kenyan customers' procurement teams ask the same questions of every cross-border SaaS vendor; Parasol's answers are no different in shape.
- KSh prices on the marketing page and pricing page are **the customer-facing representation**, settled in USD via Stripe at a locked KES/USD rate. Customers think in shillings; we display in shillings; we collect in dollars.

## Surfaces (v1)

In priority order:

1. **Email forwarding.** `ask@<workspace>.parasol.co.ke`. Forward a contract, get a redline back within 90 seconds. The dominant intake for SMEs.
2. **Web upload.** Drag-and-drop or paste-URL at app.parasol.co.ke. The settings, repository, playbook, and admin surface.
3. **Mobile PWA capture.** Photograph paper contracts; multi-page assembly; result emailed back. Differentiator for the field-and-meeting use cases the global comps don't serve.

Deferred to v1.5: Slack/Teams bot, Microsoft Word add-in, custom playbook UI editor.

## Why now

- Frontier models (Sonnet 4.7, Opus 4.7) have crossed the threshold for legal reasoning quality with proper grounding. Hallucination control via decompose-and-verify is now a reliable pattern.
- Anthropic vision capability eliminates the multi-vendor OCR pipeline that previously made document-handling complex.
- DPA 2019 has created persistent regulatory work in Kenya that wasn't there three years ago.
- Robin AI's collapse in late 2025 demonstrated both the demand for in-house contract review and the failure mode (managed services hybrid). The pure SaaS playbook is now de-risked.
- Kenya's AI Adoption Framework for the Judiciary (2025) signals regulatory tailwind.
- No global player has localised for EAC. Window is open but won't be forever — Modulaw (Nigeria) is moving regionally, Afriwise (compliance intelligence) is enterprise-deep but not in contract triage.

## Why us

- Founder-led product on a stack the founder builds in daily (Next.js / Supabase / Vercel / Anthropic / Voyage)
- Direct knowledge of the buyer (in-house counsel for an EAC agribusiness; external counsel relationships across multiple firms)
- Existing relationships into the bank, telco, and listed mid-cap segments through Mackays operations
- Agent harness paradigm operationalised across all builds — no flaky AI ships

## How we measure success

**Activation:** Time from signup to first redline < 5 minutes. Target ≥70% of trials produce a first redline within first session.

**Conversion:** Trial-to-paid ≥3% for Solo tier, ≥8% for Team tier (assisted by founder-GC champion network in v1).

**Retention:** Workspace-month retention ≥90% for paid Team and Business after month 2.

**Engagement:** Active workspace = ≥10 reviews/month. Target 60% of paid workspaces active by month 3.

**Trust:** Citation validity 100% (hard floor). Hallucination rate <2%. NPS ≥50 by month 6.

**Commercial:** $1M ARR by month 18. Path to $4-6M ARR at full EAC saturation. Path to $20-40M ARR at pan-African saturation.

## What we will not build

- A managed services arm. No employed lawyers. Robin AI's lesson.
- A consumer access-to-justice product. Different segment, different pricing, different distribution.
- Litigation document review (e-discovery). Different buyer, different price model.
- A practice management / case management product (Wakili CRM owns this).
- A research-only chatbot product (Esheria owns this; we differentiate by going deeper into one workflow).

## Competitive landscape

See [`docs/competitive-landscape.md`](./docs/competitive-landscape.md). Short version: Esheria is closest in Kenya but research-and-drafting positioned, not contract triage. Modulaw is law-firm-side from Nigeria. Afriwise is compliance intelligence, not contract review. Wakili is consumer. Robin AI collapsed. Harvey and Legora are global enterprise and won't price down to the EAC SME for years.

## Voice and tone

Confident, grounded, plain. Parasol speaks like a senior associate who respects the reader's time. Never breathless. Never vague. Always cited.

See [`BRAND.md`](./BRAND.md) for full voice guidelines.
