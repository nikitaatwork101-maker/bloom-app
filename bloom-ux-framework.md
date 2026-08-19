# Bloom UX Framework: Personas, JTBD, Pain Points, MVP Prioritization
*Companion to `bloom-design-doc.md`. Addendum (Aug 15) added at the end — resolves two of the "Where this leaves you" items below.*

## Bottom line

Bloom's core mechanic (flower health as a proxy for relationship health) is a good instinct, but the research flags a real risk: users react badly to visible "scores" on relationships ("my friendship score with Mom dropped from 82 to 76"). Three things follow:

1. **Personas split by life circumstance, not age** — the same 32-year-old could be "Overloaded Careerist" or "New Parent," and they need different defaults.
2. **The JTBD is about reducing friction (remembering, initiating, contextualizing), not adding accountability** — this should sharpen what v1's daily widget actually says.
3. **MVP prioritization should weight "does this reduce friction" over "does this add tracking"** — a few locked-in decisions (decay system, point values) are worth a gut-check against this filter below.

---

## 1. Personas (life circumstance, not age)

| Persona | Situation | Primary friction | What "good" looks like for them |
|---|---|---|---|
| **The Overloaded Careerist** | Full-time job, busy but not distant from friends geographically | Time fragmentation — cares, but intention doesn't convert to action | Low-effort nudges with context, not another task list |
| **The Long-Distance Anchor** | Close friend/family moved away or lives abroad | Proximity loss — no spontaneous interaction anymore | Easy micro-interactions + help planning the next real visit |
| **The New-Life-Stage Drifter** | Recently had a kid, got married, or changed jobs — routines changed | Situational disruption — old shared context disappeared | Permission to have a slower cadence without guilt |
| **The Reconnector** | Realizes months have passed since talking to someone they value | Cognitive overload — forgot the maintenance action, not the person | A gentle "you haven't heard from X in a while" with enough context to know what to say |

Bloom's v1 audience is likely a blend of the first and last — busy people who care but lose the thread. Worth deciding if v1 messaging/onboarding speaks to one persona primarily or stays generic across all four.

---

## 2. Jobs to Be Done

**Core JTBD:**
> When life gets busy or distance separates me from people I care about, I want an effortless way to remember, understand, and act on relationship moments — so I can maintain meaningful connections without friendship feeling like another task.

**Persona-specific variants:**
- *Overloaded Careerist:* "...so I don't have to hold 15 relationships in my head at once."
- *Long-Distance Anchor:* "...so distance doesn't quietly erode a relationship I actually care about."
- *New-Life-Stage Drifter:* "...so I can stay connected on a rhythm that fits my new reality, without feeling like I'm failing."
- *Reconnector:* "...so I catch the drift before it becomes months of silence."

---

## 3. Pain points, ranked by how directly Bloom addresses them today

| Pain point | Research friction | Bloom's current answer | Gap? |
|---|---|---|---|
| "I forgot how long it's been" | Friction #1 — Remembering | Flower decay (visual) + daily widget | Covered |
| "I don't know what to say" | Friction #2 — Initiation | Not yet addressed | **Open** — no context/memory layer in v1 |
| "I'm the only one reaching out" | Reciprocity | Not addressed | **Open** — logging is one-directional (self-rated) |
| "Every relationship needs different effort" | Expectation mismatch | Resolved Aug 15 — decay now runs on a per-Bloom user-set cadence (Daily/Weekly/Biweekly/Custom), not a global rate | **Closed** |
| "This feels like a chore/checklist" | Anti-gamification warning | Risk — flower health *is* a score, just skinned differently | **Watch closely** |

The two open gaps (context/memory, reciprocity) are both post-v1 candidates already — this table just gives you evidence for *why* they're not just "nice to have," they're the second and third most-cited frictions in the research.

---

## 4. MVP prioritization (v1 locked scope, evaluated against JTBD)

| Feature | Reduces which friction | Priority rationale |
|---|---|---|
| Flower health tiers | Remembering (visual, low-effort) | High — core mechanic, directly answers "did I forget?" |
| Contact logging + quality rating | Quality over quantity (research emphasis) | High — but only if framed as reflection, not grading |
| Decay system | Remembering, without needing to check manually | High — passive is better than active checklist. **Updated Aug 15:** now per-Bloom cadence rather than a global rate, directly closing the "expectation mismatch" gap above. |
| Daily standing prompt widget | Initiation friction | Medium — a generic daily nudge is weaker than the research's ideal ("Sarah started her new job — check in?"). **Updated Aug 15:** now branches on same-city vs. long-distance, a basic step toward that ideal — still not the full context/memory layer, worth continuing to flag as partial. |
| ~~Reciprocity awareness~~ | Reciprocity | Deferred — reasonable to cut for v1, but it's a top-3 research theme, so it shouldn't slip past v1.1 |
| ~~Context/memory layer~~ | Initiation ("what do I say") | Deferred — same flag; this is the single feature the research calls the strongest differentiator |

**One thing worth deciding now, not later:** whether the flower/decay visual is framed internally (and in copy) as *"a gentle signal"* or *"a score."* The research is blunt that the latter backfires. This affects copy, whether decay is ever shown as a number, and how aggressively the widget nudges.

---

## Where this leaves you

The framework validates the big-picture direction (visual, gentle, quality-over-frequency) but surfaces two things to decide, not just note:
1. ~~Does per-relationship cadence exist yet, or is decay currently global?~~ **Resolved Aug 15** — per-Bloom cadence, user-set. See Addendum below.
2. Is there a fast, cheap version of "context" you could ship in v1 — even just a free-text note field per friend — before the full memory layer? **Still open.** The Aug 15 addendum ships basic same-city/long-distance prompt branching, which helps with *initiation* but doesn't touch this note-field question — worth deciding separately.

---

## Addendum — Naming, Cadence, Location & Prompt Branching (Aug 15)

Four decisions made since the framework above, each closing a gap this document flagged:

**1. Naming: "friend" → "Bloom" in-product.** Cosmetic, but worth noting here since personas/JTBD language above still says "friend" deliberately — that's fine, this document is about the underlying psychology, not UI copy. The product-facing rename lives in `bloom-design-doc.md`.

**2. Per-Bloom cadence (closes gap #1 above).** Each Bloom now carries its own cadence (Daily/Weekly/Biweekly/Custom) instead of inheriting a flat global decay rate. This is the direct product answer to the "expectation mismatch" pain point (§3) — Mom on a weekly call cadence and a college friend on a biweekly text cadence no longer get judged by the same clock.

**3. Location fields + same-city/long-distance prompt branching.** This is a *basic* version of the "context/memory layer" this document calls the single strongest differentiator (§4) — not the full version. What shipped: the app now knows whether a Bloom is local or remote and adjusts the daily prompt's suggested action accordingly (in-person nudge vs. call/text/plan-a-visit). What's still deferred: referencing what's actually happening in that person's life (new job, upcoming event) — the richer version this framework originally envisioned. Don't let the basic version read as "context solved" in future planning — it isn't.

**4. Garden dashboard visual + in-app notification center.** Presentation-layer additions (multi-flower visual garden, bell/notification sidebar) — not new psychological ground covered, but worth noting they reinforce the "gentle signal, not a score" principle from the Bottom Line: color-coding by relationship type and a passive notification history both lean toward ambient awareness rather than an active checklist.

**Still open after this addendum:** reciprocity awareness (§3) and the deep context/memory layer (§4) remain the two biggest unclosed gaps from the original research. Worth keeping both on the radar for v1.1 rather than letting the basic prompt branching above quietly stand in for them.