# Parasol Pricing

## Tiers

Parasol displays prices in KSh on the marketing page (KSh is how customers think about price), and bills in USD via Stripe at a locked KES/USD reference rate. Reference rate: KSh 130/USD, locked at launch and revisited quarterly.

### Solo

**KSh 6,000 / month** (~USD 46) or **KSh 60,000 / year** (~USD 462; saves 17%)

For: Solo GCs, founder-counsel, finance leaders with legal-adjacent sign-off, 1-person legal departments at scaleups.

Includes:
- Single seat
- 25 contract reviews per month included; KSh 250 (~USD 1.92) per review beyond
- Default Kenya playbooks: NDA, DPA, MSA, SaaS
- Email forwarding (1 inbound alias)
- Web upload + repository
- Mobile PWA capture
- Basic audit log (90 day retention)
- Email support

### Team

**KSh 12,000 / seat / month** (~USD 92, 2-seat minimum) or **KSh 9,000 / seat / month annual** (~USD 69, saves 25%)

For: 3-15 person in-house legal teams at mid-corporates, scaleups, and listed mid-caps.

Includes everything in Solo, plus:
- 30 reviews per seat per month included
- Custom playbook editor (lawyer-editable through UI in v1.5; YAML in v1)
- All four EAC jurisdictions (Kenya at launch; UG/TZ/RW per ROADMAP.md v2)
- Slack and Microsoft Teams integration (v1.5)
- Shared template library
- Workspace-level audit log (12 month retention)
- Basic admin (seat management, role assignment)
- Priority email support (4-hour business-hour response)

### Business

**KSh 40,000 / seat / month** (~USD 308, 5-seat minimum) or **KSh 30,000 / seat / month annual** (~USD 231, saves 25%)

For: 15-50 person in-house teams at listed mid-caps, regional banks, telcos, large NGOs.

Includes everything in Team, plus:
- Unlimited reviews per seat (fair use ~600/month/seat)
- SSO via Microsoft Entra ID and Okta — *forcing function for upgrade*
- Advanced audit log (7-year retention, exportable, cryptographic hash chain)
- Role-based permissions (counsel, paralegal, admin, viewer)
- Custom branding on email replies
- API access for integration with internal CLM / iManage / SharePoint
- Dedicated CSM with shared Slack channel
- 99.5% SLA
- Custom DPA and security review

### Enterprise (custom)

For: Safaricom, Equity, KCB, EABL — when they come knocking. Roadmap: not before v3 / month 18.

Custom pricing starting at KSh 650,000/month (~USD 5,000). Custom playbook construction, on-premise or VPC deployment, custom integrations, training, change management, dedicated solutions architect.

Display "Contact us" on the pricing page so enterprise inquiries don't disqualify Parasol on first impression. Don't actively pursue these in v1.

## Forcing functions for upgrade

| From | To | Trigger |
|------|----|---------|
| Solo → Team | Adding a second seat (literally cannot do on Solo) |
| Team → Business | Need SSO, API access, or >15 seats |
| Business → Enterprise | Need on-premise, custom contracts, or >50 seats |

SSO is the most important forcing function. Lock to Business unconditionally. Kenyan corporates with 15+ legal staff almost always have Microsoft Entra ID deployed and SSO is a procurement requirement.

## Overage and fair use

- Solo: 25 reviews included; KSh 250 (~USD 1.92) per review beyond, billed monthly in arrears
- Team: 30 reviews per seat included; KSh 200 (~USD 1.54) per review beyond
- Business: ~600 reviews per seat fair use; soft alert at 500, conversation at 600

Overage is metered transparently. Surface estimated overage in the dashboard before month-end so there are no surprise invoices.

## Discounts

- **Annual:** 17% (Solo), 25% (Team and Business). Front-loads cash, reduces churn.
- **NGO/non-profit:** 40% off published prices. Apply through web form, manual review.
- **Founders & startups <2 years old:** Solo at KSh 3,000/month (~USD 23) for first 12 months. Self-attested.
- **Multi-year prepay:** Additional 10% off annual rate for 2-year, 15% for 3-year.

No discount stacking beyond NGO + annual.

## Trials

- 14-day full-feature trial of any tier
- No credit card required to start
- All tiers
- Trial converts to paid at end of period; reverts to email-only access if not converted (read-only on existing reviews, no new reviews)

## Billing infrastructure

- **Stripe** is the sole billing rail in v1. USD only. Cards (Visa, Mastercard, Amex), ACH, wire transfer for invoiced customers.
- KSh-display, USD-collect: marketing and pricing pages show KSh; checkout converts at reference rate; customer's card is charged in USD; statement reflects USD.
- VAT-compliant invoicing handled by Stripe Tax. Kenyan customers receive invoices showing KSh-equivalent at point-of-sale rate for their accounting reconciliation.
- Kenya Digital Service Tax (1.5% of gross revenue from Kenyan users) handled per DEF-006 in Sprint 3. Stripe collects and remits where applicable.

**Why Stripe-only in v1.** Path A architecture (Parasol Inc Delaware, no Kenyan entity) means local processors (Flutterwave, Pesapal, DPO) are not viable — all require Kenyan business registration. Stripe handles the cross-border USD billing pattern that Legora, Harvey, Notion, and every other successful cross-border SaaS into Kenya use.

**M-PESA acceptance**: deferred to Sprint 7 evaluation per DEF-042. v1 ICP (banks, listed mid-corporates, regulated mid-caps, NGOs) overwhelmingly pays in USD via card. M-PESA is added in v1.5 if customer evidence shows the M-PESA-only segment is meaningfully under-served. Options at that point: Merchant-of-Record (Paddle, Dodo Payments) bundling M-PESA at ~5-8% all-in, commercial agency arrangement, or Kenyan subsidiary setup.

## What we do not charge for

- Per-document overage on free trial (capped at 50 reviews)
- Adding viewers (read-only seats) at any tier — it's the working seat that costs
- API rate limits within fair use
- Support
- Onboarding (self-serve only — no professional services SKU)
- Custom playbook setup (Business+ self-serve through editor; Enterprise custom-built into the deal)

## What we never charge for or sell

- Customer data. Ever. Not aggregated, not anonymised, not for model training, not for benchmarking, not for any reason.
- Implementation services that exceed Business tier scope. We are pure SaaS. Robin AI's lesson.

## ROI framing for the pricing page

Don't bury the lede. The pricing page leads with:

> "A single avoided Bowmans MSA review pays for a year of Parasol Solo. A typical Team workspace recovers its annual cost in under three weeks of normal contract volume."

Then the tiers. Then the FAQ.

ROI calculator on the page: input team size and average monthly contract volume; output estimated counsel spend avoided. Use conservative assumptions (KSh 80,000 average per externally-reviewed contract, 60% deflection rate). The honest number is more credible than a hyped one.

## What changes pricing post-launch

We do not raise headline prices on existing customers for the first 18 months. We can add new tiers (Enterprise), tighten overage policies on new customers, and adjust included review counts on new contracts only. Price stability is itself a trust signal in this market.
