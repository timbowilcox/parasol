# Parasol Brand Guidelines

The brand metaphor: *protection from harmful sun's rays, where the rays are legal threats.* The visual and tonal system reinforces calm, grounded confidence — sophisticated like Legora, slightly warmer for the SME audience.

## Voice

Parasol speaks like a senior associate who respects the reader's time. Confident, grounded, plain.

**Always:**
- Cite authority. Every recommendation traces back to a Kenyan or EAC source.
- Calibrate confidence. Distinguish between high-confidence calls and judgement calls.
- Use sentence case. Headings, buttons, badges, alerts — sentence case, never title case, never ALL CAPS.
- Use plain language. "Liability cap is below market" not "exposure exceeds standard parameters."
- Be specific. "12 months of fees" not "an appropriate amount."

**Never:**
- "Revolutionary," "game-changer," "AI-powered," or any other category-noise word.
- Em-dash drama or breathless tone.
- Implied urgency that the situation doesn't warrant.
- Absolute claims ("never," "always," "guaranteed") without qualification.
- Emoji in product or marketing surfaces.

**Tone calibration by surface:**

| Surface | Register |
|---------|----------|
| Email response | Senior associate writing to a peer |
| Web app UI | Restrained product copy; let data carry meaning |
| Pricing page | Confident, plain, no faux scarcity |
| Onboarding | Helpful but not chatty |
| Error states | Honest about what went wrong, what to do next |
| Marketing | Same voice as product. No marketing-speak split. |

## Logo

The brand mark is a stylised parasol: a dome over a vertical post over a small curved hook (the handle). Used at small sizes only. Never expanded into illustration or pattern.

```
  ___
 /   \      ← dome
|     |
 \___/
   |        ← post
   |
   ⌒        ← hook
```

Logo + wordmark always lockup horizontally, with the mark left-aligned. Wordmark is set in the brand serif at lowercase: `parasol`.

**Sizing:**
- Minimum: 16px height for the mark
- Standard: 18-20px in app chrome
- Marketing maximum: 32px

**Clear space:** half the mark's height on all sides.

**Don't:** rotate, stretch, recolour beyond approved palette, add effects, place on busy backgrounds, or use the mark without the wordmark in any context where Parasol is not already established.

## Typography

| Use | Family | Weight | Size |
|-----|--------|--------|------|
| Wordmark, page titles, document names, hero stats | Serif (Source Serif 4 or similar transitional serif) | 500 | varies |
| All other UI, body copy, buttons, labels | Sans (Inter or similar geometric sans) | 400 / 500 | 11-22px |
| Citations, code, monospace data | Mono (JetBrains Mono or IBM Plex Mono) | 400 | 12-13px |

**Two weights only.** 400 regular, 500 medium. Never 600 or 700 — heavy weights look corporate-default.

**Sentence case always.** Even in SVG labels, button text, and section headings.

**Never:**
- Mid-sentence bolding for emphasis (use italics sparingly, or rephrase)
- All caps for emphasis (use the small uppercase severity labels we already have)
- Decorative type, display faces, or anything condensed/extended

## Color

Restrained. Color encodes meaning, never decoration.

### Brand color
**Ember amber** — used exclusively on the brand mark, never decoratively elsewhere.
- Mark fill: `#FAEEDA`
- Mark stroke: `#854F0B`

### Surface colors
- Background primary (cards, surfaces): `#FFFFFF` warm white in light mode
- Background secondary (inset, muted surfaces): `#F8F6F1`
- Background tertiary (page background): `#F1EFE8`
- Border: `0.5px solid rgba(0,0,0,0.08)` default, `rgba(0,0,0,0.16)` on hover

Dark mode mirror:
- Background primary: `#1A1A18`
- Background secondary: `#222220`
- Background tertiary: `#2C2C2A`

### Text
- Primary: near-black `#1A1A18` (light) / `#F1EFE8` (dark)
- Secondary: `#5F5E5A` (light) / `#B4B2A9` (dark)
- Tertiary: `#888780` (light) / `#888780` (dark)

### Semantic colors

These map to severity, status, confidence — never used decoratively.

| Meaning | Light fill | Light text | Dark fill | Dark text |
|---------|-----------|------------|-----------|-----------|
| Critical / Danger | `#FCEBEB` | `#791F1F` | `#501313` | `#F7C1C1` |
| Material / Warning | `#FAEEDA` | `#633806` | `#412402` | `#FAC775` |
| Minor / Neutral | `#F1EFE8` | `#444441` | `#2C2C2A` | `#D3D1C7` |
| Approved / Success | `#EAF3DE` | `#27500A` | `#173404` | `#C0DD97` |
| Info / Action | `#E6F1FB` | `#0C447C` | `#042C53` | `#B5D4F4` |

## Layout

- **Generous whitespace.** Negative space is the primary visual element.
- **Restrained borders.** 0.5px on cards. Never 1px or thicker for chrome.
- **No gradients.** Solid flat fills.
- **No drop shadows.** Functional focus rings only.
- **No glassmorphism, blur, or noise textures.**
- **Corner radius:** 8px for most elements, 12px for cards, 4px for small pills/badges.
- **Single-sided borders never combine with rounded corners.** A border-left accent has square corners.

## Iconography

- Stroke-only line icons, 1.5-1.8 stroke weight, currentColor for color
- 14px or 16px standard sizes; 24px decorative max
- Lucide or similar geometric set (matching the sans typeface)
- No emoji in product

## Severity treatment in UI

The visual language for severity is consistent across all surfaces:

- **Critical:** danger ramp pill, danger left-border (3px), critical/uppercase label
- **Material:** warning ramp pill, warning left-border (3px), material/uppercase label
- **Minor:** secondary ramp pill (no border accent), minor/uppercase label
- **Approved/no issues:** success ramp pill, no border accent

Confidence indicators are dot+label, three states:
- Green dot + "High confidence"
- Amber dot + "Medium confidence"
- Grey dot + "Manual review recommended"

Never numeric percentages. Calibrated language outperforms calibrated numbers in legal context.

## Citation treatment

Citations always render as hyperlinks in info ramp color, with arrow icon (`↗`) suffix. Format: `<source short-name>, <section/identifier> ↗`. Example: `DPA 2019, s.49 ↗`

Hovering or tapping a citation surfaces a tooltip with the cited text excerpt and a stable link to the corpus view.

## Email surface specifically

Email replies from Parasol must:
- Be readable on mobile (most legal reads now happen on phone)
- Not require image loading to convey meaning
- Use the same severity language as the in-app view
- Sign off as "— Parasol" (em-dash, lowercase, no fake human persona)
- Use a workspace-aware sender (Sprint 1: `hello@parasol.co.ke`; Sprint 3+: per-workspace from-address)
- Attach the redlined .docx with metadata in the file name

## Marketing surfaces

- Headlines: serif, sentence case, weight 500, max 6-8 words
- Body: sans, weight 400, line-height 1.6
- Single hero image rule: if a marketing page needs decorative imagery, it gets one. No carousels, no scroll-triggered animations, no abstract gradient backgrounds.
- ROI claims must be specific and cited: "replaces an average of KSh 180,000 in counsel fees per workspace per month based on Q3 2026 customer sample"

## What never to do with the brand

- Use the amber accent decoratively (buttons, links, highlights). Amber is the mark only.
- Combine multiple severity ramps in a single element.
- Add drop shadows or glassmorphism.
- Use product copy that sounds like it was generated by a marketing tool.
- Slap "AI" into anywhere it isn't load-bearing.
- Put the wordmark in title case.
- Turn the parasol icon into a pattern, repeating element, or watermark.
