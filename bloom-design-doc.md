# Bloom — Design Document (PRD)
*Working title. Rename freely — used here for readability.*

**Platform:** Web app (v1)
**Pricing model:** Fully free at launch. Feature flags built in from day one so specific features can be gated later without rework.
**Status:** Draft v1 + Addendum (Aug 11) + Addendum (Aug 15)

---

## 1. Problem Statement

People let Blooms fade not because they stop caring, but because there's no visible signal that a relationship needs attention until it's already cold. Unlike a plant on your desk, a Bloom's decline is invisible — there's no wilting leaf to remind you to water it.

Bloom makes the health of a relationship visible and emotionally legible, using a flower as a living proxy for each Bloom. The cost of not solving this: users keep losing touch with people they value, with no early warning system to prompt reconnection.

---

## 2. Goals

1. Give users a visual, at-a-glance signal of which Blooms need attention (the flower's state).
2. Make logging contact (message, call, video call) fast enough that it becomes a habit, not a chore.
3. Encourage *quality* connection, not just frequency — via self-rated conversation quality.
4. Drive daily return visits through a lightweight daily prompt/activity.
5. Validate the core loop (log contact → flower reacts → user comes back) before investing in any premium build.

**User goal:** feel more connected to the Blooms who matter, with less mental overhead.
**Business goal:** prove daily/weekly retention on the core loop to justify building premium features on top of it later.

---

## 3. Non-Goals (v1)

- **No premium tier at launch.** All features ship free. Rationale: validate the core loop first; premature monetization adds friction before you know what's worth paying for.
- **No native mobile app.** Web only for v1. Rationale: faster to ship and iterate; mobile can follow once the concept is validated.
- **No AI-scored conversation quality.** Quality is self-tagged (1–5) by the user, not inferred from message/call content. Rationale: avoids the complexity and trust issues of reading private conversations; simpler to ship and just as informative for v1.
- **No automatic contact detection** (e.g., syncing with phone call logs or messaging apps). Rationale: privacy complexity and integration overhead not justified until the manual-logging loop is proven.
- **No multi-user/social features** (Blooms can't see their own flower, no shared garden). Rationale: this is a personal tool for the user's view of their relationships, not a mutual social product — revisit later.

---

## 4. Core Concept & Mechanics

### 4.1 The Flower Model

Each Bloom added to the app gets one flower. The flower's visual state is driven by a Health Score (0–100), which is a function of logged contact and daily decay. Five tiers, mapped to score ranges (placeholder ranges pending playtest — now user-customizable per §11.2):

| Tier | Score Range | Visual |
|---|---|---|
| Blooming | 80–100 | Full color, in bloom |
| Healthy | 60–79 | Full color, budding |
| Wilting | 35–59 | Fading color, drooping |
| Struggling | 15–34 | Mostly faded, browning edges |
| Dormant | 0–14 | Greyscale, closed |

### 4.2 Contact Logging & Point Values

Each logged contact adds points to the Health Score: `points = base_value(contact_type) × quality_rating (1–5)`

Placeholder base values, pending playtest:
- Message: 2
- Call: 5
- Video call: 8

### 4.3 Daily Decay & Cadence

Health Score decreases by a flat placeholder amount per day with no logged contact (e.g., −1.5/day). **Resolved (was open question):** decay is *not* flat across all Blooms in v1 — each Bloom carries its own user-set cadence (Daily / Weekly / Biweekly / Custom day count), and decay timing reads from that cadence rather than a single app-wide constant. Full spec in §12.1.

### 4.4 Daily Prompt

A standing daily widget on the home page nudges the user to reach out to one Bloom. This is the mechanism referenced in the original brief for "in case there are no questions, we will prompt them" — for v1, this is a standing daily nudge rather than a reactive one triggered by inactivity in a specific chat. Selection logic and controls are specified in §11.3. **As of the Aug 15 addendum**, the prompt's suggested action also branches on same-city vs. long-distance (§12.3) — this is the basic version of the "what do I say / what should I do" personalization flagged in `bloom-ux-framework.md` as the strongest retention lever; deeper context (referencing a Bloom's specific life events) remains deferred past v1.

---

## 5. User Stories

1. As a new user, I want to sign in and immediately see a home page where I can start adding Blooms, so I understand the app's purpose right away.
2. As a user, I want to create a flower for a Bloom, so I have a visual representation of that relationship.
3. As a user, I want to log a message, call, or video call with a Bloom in a few taps, so tracking contact doesn't feel like a chore.
4. As a user, I want to rate the quality of a conversation after logging it, so shallow and meaningful contact aren't weighted the same.
5. As a user, I want to see my flower's health visually change over time, so I get an emotional, at-a-glance signal without reading numbers.
6. As a user, I want to see a daily prompt on my home page, so I have a reason to open the app and reach out to someone.
7. As a returning user, I want to see which Blooms are wilting, so I know who to reach out to first.
8. As a user with a dormant flower, I want a clear, low-guilt way to revive it, so a lapse doesn't feel like a permanent failure.
9. *(Added)* As a user, I want to edit or delete a contact log, event, or note I've added, so I can fix mistakes without living with bad data.
10. *(Added)* As a user, I want to customize my Bloom tiers and colors, so the app reflects thresholds that feel right to me.
11. *(Added)* As a user, I want the daily prompt to rotate and to be able to change or skip it, so I'm not stuck being nudged about the same person every day.
12. *(Added)* As a user, I want to organize my garden into tabs like Family and Friends, so I can view relationships by category.

---

## 6. Requirements

### Must-Have (P0)
- Sign-in / sign-up on the home page (email + password minimum; SSO optional — see Open Questions)
- Create a Bloom → generates a flower
- Log contact: Message / Call / Video Call, each with a 1–5 quality self-rating
- Health Score calculation engine (points on contact, daily decay)
- Visual flower states (5 tiers, per §4.1) rendered on home page
- Home page dashboard: all flowers at a glance, sorted by health (lowest first, so at-risk Blooms surface)
- Daily prompt widget on home page
- **Feature flag scaffolding**: every feature tagged internally as free/premium in the data model, even though all are unlocked for v1 (see §7)
- *(Added, Aug 15)* Per-Bloom custom cadence (Daily / Weekly / Biweekly / Custom), replacing the flat app-wide decay rate — full spec §12.1
- *(Added, Aug 15)* User and Bloom location fields (manual city entry), powering same-city prompt branching and timezone-aware reminder timing — full spec §12.2
- *(Added, Aug 15)* Same-city vs. long-distance prompt branching on the daily widget — full spec §12.3
- *(Added, Aug 15)* Garden dashboard as a visual multi-flower layout, color-coded by relationship tag — full spec §12.4
- *(Added, Aug 15)* In-app notification center: bell icon + collapsible sidebar showing prompt/event history — full spec §12.5

### Nice-to-Have (P1)
- Contact history log per Bloom (timeline of past interactions)
- Push/email reminder when a flower crosses into "Wilting"
- Notes field per Bloom (private context — birthday, last topic discussed, etc.)
- *(Added)* Edit/delete on logged contacts, events, and notes
- *(Added)* Customizable Bloom tier thresholds and colors (Settings)
- *(Added)* Daily prompt rotation, skip, and manual override
- *(Added)* Garden tabs with custom, multi-tag relationship types

*Note: per-Bloom custom decay ("closeness tier") was promoted from P1 to Must-Have on Aug 15 — see requirements list above and §12.1. It's removed from this list to avoid duplication.*

### Future Considerations (P2)
- Premium tier activation (using the flag scaffolding from P0) — likely candidates: reminders, prompt history/library, custom decay tiers, contact analytics
- Mobile app
- AI-assisted quality scoring (as an *opt-in* upgrade to self-rating, not a replacement)
- Shared/mutual flowers (both people see the same flower)
- *(Added, Aug 15)* **Browser push notifications** — deliberately deferred, not forgotten. Blocked on two open infra items (GitHub auto-deploy wiring, Firestore security rules audit) closing first. In-app notifications (§12.5) ship in v1 as the interim solution. Full rationale §12.6.
- *(Added, Aug 15)* Deep prompt context (referencing a Bloom's work, hobbies, or recent life events) — the basic same-city/long-distance branching ships in v1 (§12.3); this richer version stays deferred pending a structured per-Bloom context field beyond the existing free-text notes.

---

## 7. Premium-Readiness Design Note

Everything ships free in v1, but since you want per-feature premium flexibility later, structure this now rather than retrofit it:

- Every feature/action in the data model carries a `tier: "free" | "premium"` field, defaulted to `"free"`.
- Feature-gating logic checks this field rather than hardcoding "is this a premium action" per feature — flipping a feature to premium later becomes a config change, not a code change.
- Natural premium candidates based on this spec (for later, not now): the daily prompt library going deeper (multiple prompts, prompt history), reminders/notifications, custom decay tiers, and contact analytics/insights.

---

## 8. Success Metrics

**Leading indicators (days–weeks):**
- % of sign-ups who create at least 1 flower within first session
- Average contacts logged per active user per week
- % of daily prompts that result in a logged contact same-day

**Lagging indicators (weeks–months):**
- 4-week retention (users who return and log at least one contact)
- Average number of flowers in "Healthy" or "Blooming" state per active user over time (proxy for whether the app is actually helping, not just tracking)
- % of dormant flowers revived within 30 days

---

## 9. Open Questions

- **[Product]** What are the exact point weights and decay rate? Recommend a short internal playtest before locking numbers — current values in §4.2–4.3 are placeholders.
- ~~**[Product]** Should decay rate vary by Bloom (closeness tier) in v1, or is a flat rate acceptable for launch?~~ **Resolved Aug 15:** yes, per-Bloom custom cadence, promoted to Must-Have. See §12.1.
- **[Design]** What happens visually/emotionally when a flower goes fully Dormant — is there a "revive" ritual/moment, or does it just quietly become loggable again?
- **[Engineering]** Auth approach — email/password only, or also social sign-in (Google, etc.) for v1?
- ~~**[Product]** Is the daily prompt the same for all users, personalized per Bloom, or per Bloom health state?~~ **Partially resolved Aug 15:** prompts now branch on same-city vs. long-distance (§12.3). Deeper personalization by life event or health-state tone remains open — deferred, not answered.
- *(Added, Aug 15)* **[Engineering]** Does changing a Bloom's cadence trigger the same full retroactive Health Score recalculation as editing a contact log (§11.1)? Recommend yes for consistency — non-blocking, confirm during build.

---

## 10. Timeline Considerations

- No hard external deadline noted — recommend scoping v1 to the P0 list only and shipping fast to start learning from real usage.
- Decay/weight tuning (Open Questions above) should be resolved before or shortly after launch — it's cheap to adjust and better informed by real data than guessed upfront.

---

## 11. Addendum — Edit/Delete, Custom Tiers, Prompt Rotation, Garden Tabs (Aug 11)

### 11.1 Edit & Delete on Logs, Events, and Notes

- Contact logs, events, and notes are each independently editable and deletable from the Bloom's profile page.
- **Decision:** editing or deleting a contact log triggers a **full retroactive recalculation** of that Bloom's Health Score.
- **Implication for data model:** raw contact events (type, date, quality rating) must be stored as the source of truth. Health Score is *computed on read* from the full event history plus decay, not stored as a mutable running total. This is a change from a naive "current score ± delta" approach — flag this to Claude Code explicitly, since it affects how the scoring engine is architected from the start.
- Events and notes are simpler CRUD and do not feed the Health Score calculation.

### 11.2 Customizable Bloom Tiers (Settings)

- New Settings section: user-editable list of tiers, each with `{ tierName, minScore, maxScore, colorHex }`.
- Validation: ranges must be contiguous and non-overlapping, covering 0–100 with no gaps.
- Ships with the 5 default tiers from §4.1 pre-populated so no existing flower's appearance changes on first load.
- Changing tier boundaries or colors takes effect immediately across the whole garden (recompute which tier each flower falls into; no change to underlying Health Scores).

### 11.3 Daily Prompt: Rotation, Skip, and Change

Today's behavior: the widget is a standing single prompt with no rotation logic, which is why it has appeared to "stick" to one Bloom.

New behavior:
- **Selection rule:** each day's prompt surfaces the Bloom with the **lowest current Health Score**. Tie-breaker: whichever of the tied Blooms was *least recently* shown as the prompt (prevents flip-flopping between two Blooms at the same score).
- **Cancel:** dismisses today's prompt with no replacement; does not resurface until the next day's selection cycle.
- **Change:** swaps today's prompt to a different Bloom, user's choice, for today only — tomorrow's selection still runs the normal lowest-score rule.
- **Snooze for Dormant Blooms (recommended, open for your call):** if the same Bloom keeps surfacing as lowest-score day after day, consider a snooze option so the prompt doesn't feel naggy — e.g., "remind me about this one in 3 days" instead of a flower being calling-carded every single morning.

### 11.4 Garden Tabs

- New field on each Bloom: `relationshipTags` — an **array** of strings, not a single value.
- Ships with two default tags: Friends, Family. "All" is not a tag; it's the unfiltered view.
- Users can create custom tags (e.g., Neighbour, Colleague) from a "Create tab" action; new tags are just new string values appended to the same taxonomy, no schema change required.
- A Bloom can carry multiple tags simultaneously (e.g., Family + Colleague) and will appear under every tab they're tagged with.
- Garden view filters flowers by whichever tab is active; tag management (rename/delete a tab) should cascade — deleting a tab removes the tag from all Blooms who had it, not the Blooms themselves.

---

## 12. Addendum — Cadence, Location, Prompt Branching, Garden Visual, Notifications (Aug 15)

### 12.1 Per-Bloom Custom Cadence

Resolves the open question at §9 on closeness-tier decay: **per-relationship, user-defined**, not a flat app-wide rate.

- New field on each Bloom: `cadence: { type: "daily" | "weekly" | "biweekly" | "custom", customDays: number | null }`
- `customDays` only applies when `type === "custom"`; accepts any positive integer
- Default on creation: `weekly`, matching the current flat rate — existing Blooms migrate with no visible change
- Decay logic (§4.3) reads `cadence` per Bloom rather than a single constant
- User can set/edit cadence at Bloom creation or from the Bloom's profile page

### 12.2 Location Fields (User + Bloom)

Manual entry only — no GPS, no device location access, no tracking. Powers §12.3 and reminder timing.

- `User.location: { city: string, timezone: string }` — set once in profile settings; timezone can auto-suggest from browser but stays user-editable
- `Bloom.city: string | null` — optional field on each Bloom
- If a Bloom's city is blank, treat as long-distance by default (safer assumption than guessing same-city)
- Daily prompt widget (§4.4) scheduling uses `User.location.timezone` to land within the user's local waking hours

### 12.3 Same-City vs. Long-Distance Prompt Branching

Basic version of the "what do I say / what should I do" personalization — the strongest differentiator per `bloom-ux-framework.md`. Deep context (referencing specific life events, work, hobbies) stays deferred.

```
if (Bloom.city && Bloom.city === User.location.city) → in-person prompt variant
else → call / text / plan-a-visit prompt variant
```

- Existing Quick Action set (§4.4, §11.3) is unchanged — this only changes which prompt copy/default action surfaces
- Re-evaluates whenever a Bloom's city is edited

### 12.4 Garden Dashboard (Visual)

Extends the home page dashboard (§6, P0) into a visual garden rather than a plain sorted list.

- One flower rendered per Bloom; flower **health tier** still drives visual state (§4.1), unchanged
- Flower **color** is driven by the Bloom's relationship tag (§11.4) — e.g., Family one color, Friends another. If a Bloom carries multiple tags, color uses the first/primary tag to avoid blending
- Must remain performant at 50+ Blooms
- Animations, seasonal themes, and custom layout arrangement are explicitly out of scope for v1 (parking lot)

### 12.5 In-App Notification Center

New Must-Have, ships in v1 **without** browser push (see §12.6).

- Bell icon in top nav with unread-count badge
- Opens a collapsible right-side sidebar listing recent prompts and events, reverse-chronological
- Read state persists in Firestore, not local-only
- Triggers no browser permission prompts — purely an in-app read surface over data the app already generates

### 12.6 Browser Push Notifications — Deferred to v1.1

Not in v1. Requires its own infrastructure track (service worker, push-permission UX, FCM subscription storage) independent of the core scoring logic, and is explicitly blocked on:

1. `firebase init hosting:github` — auto-deploy wiring
2. Firestore security rules audit — confirm not left in open test mode

Will get its own addendum once those two items close and this is picked up.
