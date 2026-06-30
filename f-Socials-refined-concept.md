# f-Socials — Refined Concept

**A media-literacy lens, not a truth judge.**

> Status: concept blueprint (single source of truth)
> Supersedes the scattered analyses in this folder. Synthesizes the deep-research report, the strategy blueprint, the refinement docs, and the original spec into one buildable direction.
>
> **Update:** this blueprint has been executed into `f-Socials-v1-product-definition.md` (spec) and the **Foundation-phase engine is now built and proven** (see `f-Socials-debt-and-todo.md`). Sequencing for what's left and what's next lives in `f-Socials-roadmap.md`. The §17 "next step" is done.

---

## 1. The one-line pitch

f-Socials helps people see *how* online content is built — what it claims, what it omits, how it's framed, and what a diverse set of credible sources say about the same story — so they can think for themselves instead of being told what's true.

It does **not** stamp a verdict. It hands the user X-ray glasses.

**External positioning (the calm version):**
> f-Socials is a context layer for online media. It helps users inspect claims, framing, omissions, and source diversity before they react or share.

**Internal compass (the sharp version):**
> f-Socials is a lens, not a judge.

Every product, legal, UX, and technical decision answers to those two sentences.

---

## 2. Why the original idea had to change

The original spec was directionally right but built around two features that would have sunk it. Every independent reviewer flagged the same two, so they're treated as settled.

| Original feature | Problem | Consequence if shipped as-is |
|---|---|---|
| **Single "Truth Score 1–100"** | Most claims aren't uniformly true/false; a machine verdict triggers the *backfire effect* (entrenches the belief you wanted to loosen) | Legal exposure (defamation), low trust, actively counter-productive to the mission |
| **"Analyze any URL from any platform"** | YouTube has an official API; TikTok is gated to non-commercial researchers; Meta's research tooling is crippled/incomplete | Constant bans, broken promises, unbuildable phase one |
| **Loaded ideology tags** ("woke," "manosphere," "fringe") | Make the tool feel politically coded | Destroys the neutrality that is the entire value proposition |
| **In-house expert fact-check team** | Expensive, slow, and lacks public credibility on day one | Unsustainable for an early-stage product |

### The reframe

> **From:** "We tell you what's true and how biased this is." (omniscient judge)
> **To:** "We show you how this content is built, what it leaves out, and what credible others say." (a lens that builds your judgment)

This single shift resolves the legal risk, the backfire effect, and the neutrality problem simultaneously — and it's far more buildable, because "show the construction and the alternatives" is a much lower bar than "adjudicate truth."

---

## 3. Mission & principles

**Mission:** reduce affective polarization and impulsive one-sided consumption by making media construction visible and alternative perspectives one click away.

**Non-negotiable principles:**

1. **Advisory, never consequential.** We inform; we never auto-decide anything that materially affects a person. The product is *designed to avoid high-risk use cases under the EU AI Act (Reg. 2024/1689), subject to legal review* — classification depends on actual use, profiling, and whether outputs influence decisions, so this is a design constraint, not a settled claim.
2. **Every claim cites its source.** No citation, no claim shown.
3. **Show the seams.** Always disclose which layer (AI / expert / community) produced or last updated a signal.
4. **Neutral by construction.** Cool color palettes, issue-frame language, spatial maps instead of red "FALSE" stamps.
5. **Humane design.** Batched notifications, no dark patterns, no manufactured-outrage virality loops.
6. **Privacy & account safety first.** The extension never scrapes credentials or hijacks sessions.
7. **Accessible from day one.** WCAG 2.2 AA, not a retrofit.

---

## 4. Strategic wedges

There are two "killer features." We **lead with A** to get traction and prove value, then **earn the right to ship B.**

### Wedge A — The Analysis Lens *(launch)*
Paste a YouTube or article link (or a transcript) → get a claim ledger, manipulation cues, bridging perspectives, and a TLDR. Every report is a shareable URL. Buildable, demonstrable, and viral-on-a-link.

### Wedge B — The "Feed Friction Dial" *(internal north star — not a public promise yet)*
A feed-reranking browser extension that lets users dial down antidemocratic / partisan-animosity (AAPA) content. Backed by the strongest real-world impact evidence in the research (Stanford field experiment: measurable drop in out-group hostility, no loss of engagement).

This is a **different beast** from report generation. Reranking a feed moves f-Socials from "analysis tool" into "intervention system" — a surface the EU DSA explicitly treats as influential (recommender transparency and user control obligations). It is harder legally, ethically, and technically. **Kept internal as a north star; not promised to users until A is proven and the extension has earned trust as a read-only surface first.**

**Decision: foundation first. Ship A, prove value, earn trust with a read-only extension, *then* consider B.**

---

## 5. Feature set (refined)

| Original | Refined version | Notes |
|---|---|---|
| Truth Score | **Claim Ledger** — each claim shown with *verifiability*, *evidence strength*, *source basis* + confidence band. No global number. | The trust anchor. |
| Polarization Score (red at extremes) | **Framing Signals + Framing & Context Cards** — each card names the specific technique ("outrage framing," "omits cited context," "truncated quote") *and* shows the evidence that triggered it, expandable. Cool neutral colors. | Naming the specific technique is the inoculation payload; the evidence-on-demand keeps it a lens, not a soft verdict. |
| Ideology tag | **Issue-frame map** — content plotted spatially vs. other coverage, not a verdict | Spatial framing invites reflection, not defensiveness. |
| Perspective Views | **Lead feature.** *Bridging* selection by explicit rule (see §6.5): topic-matched, moderately divergent, high-evidence, low-dehumanization sources | Diametric opposites get rejected; bridgeable ones shift views. A rule prevents accidental false balance. |
| Community flagging | **Gamified framing-spotting** — users tag *which technique*; corroborated flags earn media-literacy markers | Turns moderation into inoculation. |
| Bias Awareness Profile | Keep — private, opt-in self-insight, never restriction | Self-awareness, no judgment. |
| Browser extension overlay | Keep — DOM-safe, Manifest V3, privacy-first, no cookie scraping | Account safety is a marketing advantage. |
| Channel scorecards / creator ranking | **Cut from v1** | Public ranking of people is a defamation magnet. |

---

## 6. Scope: what's buildable for v1

**Inputs (in):** YouTube URLs (official Data API) · article URLs · user-pasted transcripts / uploads.

**Inputs (deferred):** TikTok / Instagram / Facebook live ingestion. For now: "paste the transcript or screenshot." Don't promise live scraping.

**Cut for v1:** public creator/channel ranking · real-time in-video scanning · feed reranking / the Feed Friction Dial (Wedge B) · mobile app · public API · social calendar.

**Refuse entirely:** the "creator-burnout well-being analytics" pivot from one of the source docs. That's a different product for a different user — mission drift. (The only thing worth keeping from it is its humane-design principles, already adopted above.)

---

## 6.5. Source & Bridging Policy

This is the section that decides whether f-Socials is trusted or dismissed as "your politics in a lab coat." Vague terms like "credible others" must have operational teeth.

### What counts as a source (transparent, tiered)
Sources are admitted to the **evidence set** by a *published, inspectable policy* — not editorial taste. Each source carries machine-readable metadata: type, ownership, country, and any external reliability/bias ratings (e.g. Ad Fontes / AllSides / press-council membership), shown to the user.

| Tier | Examples | Use |
|---|---|---|
| **Tier 1 — Primary** | court records, official statistics, peer-reviewed studies, primary documents, on-record statements | strongest evidence; preferred for claim verification |
| **Tier 2 — Institutional reporting** | established outlets with editorial standards + corrections policies, fact-checking bodies (IFCN signatories) | corroboration and context |
| **Tier 3 — Diverse viewpoint** | partisan-but-good-faith outlets across the spectrum, named experts, advocacy orgs (labeled as such) | perspective comparison only, never sole evidence |
| **Excluded** | anonymous/unaccountable sources, known repeat-disinfo domains, AI-generated content farms | not shown as evidence |

Credibility is **about accountability and evidence, not ideology.** A partisan outlet with corrections, named authors, and primary sourcing can be Tier 2; an anonymous viral account cannot, regardless of its politics.

### The bridging selection rule
Perspective recommendations are chosen by an explicit, testable rule — not "show the opposite":

```
candidate is shown IF:
  topic_match     >= threshold      (same story/claim, semantic match)
  AND divergence  in [moderate band]  (different framing, NOT maximal opposite)
  AND evidence_quality >= Tier 2
  AND dehumanization_score < threshold  (excludes bad-faith / dehumanizing content)
rank by: evidence_quality, then proximity to the user's current view (bridgeable first)
```

This deliberately **prevents false balance**: climate science is not "balanced" against a denial blog, because the blog fails `evidence_quality`. Bridging means *moderately divergent and credible*, not *equal airtime for anything*.

### Framing-cue evidence rule
No Framing & Context Card is ever shown without the evidence that triggered it. Every cue ("truncated quote") expands to the specific transcript span, the omitted context, and the source for that context. A cue with no inspectable evidence is a bug, not a feature.

---

## 7. Analysis pipeline

```
URL/transcript
   → hash + cache check  (if seen, serve instantly — skip the rest)
   → transcript acquisition  (YouTube captions / Whisper for uploads)
   → LLM pass:  claim extraction + rhetoric cues + issue-frame mapping
   → evidence retrieval  (Google Fact Check Tools API + source metadata)
   → bridging-perspective match  (news API + vector similarity, divergent-but-credible)
   → explainable report  (claim ledger, manipulation cards, perspective map, TLDR)
   → high-risk / low-confidence items → human review queue
```

**The cache is the unit-economics trick.** Hash the URL; a viral video is analyzed once and served to everyone afterward. This socializes the LLM + transcription cost. Keep prompts tight; transcription runs ~$0.003/min on a mini speech-to-text model, and ephemeral audio handling (RAM/tmp, hard purge post-transcription) keeps storage and copyright exposure low.

---

## 8. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React (web app + extension UI) | Per original spec; shared components across surfaces. |
| Backend | Node.js + Express (TypeScript) | Per original spec; TS for reliability. |
| Database | PostgreSQL | Per original spec. |
| Cache / queue | Redis | URL-hash cache + async analysis jobs. |
| Vector store | Pinecone (free starter) or pgvector | Bridging-perspective matching. |
| Transcription | Mini Whisper-class STT (managed), self-host at scale | Cheapest viable; self-host break-even ~2k hrs/mo. |
| LLM | Swappable provider behind an interface | Avoid single-vendor lock-in for core trust functions. |
| Auth | JWT + Google OAuth | Per original spec. |
| Extension | Manifest V3, Offscreen API, DOM-safe | Compliant + account-safe. |

**Architectural rule:** keep ingestion, analysis, and presentation as separate layers, and make the analyzer a swap-in module. The "lawful access layer" is first-class, not assumed.

---

## 9. Data model (v1)

- `users` — account, preferences, opt-in flags
- `content_items` — url_hash (unique), platform, source_type, metadata, status
- `analysis_reports` — claim ledger (JSON), rhetoric cues, issue-frame coords, TLDR, perspective links, **producing_layer** (ai/expert/community), version, confidence
- `claims` — report_id, text, verifiability, evidence_strength, source_basis, citations[]
- `perspective_links` — report_id, url, source, issue_frame_label, divergence_score
- `flags` — user_id, target, technique_category, timestamp, corroborated (bool)
- `expert_reviews` — reviewer_id, report_id, updated_fields, changelog, timestamp
- `literacy_profile` — user_id, consumption breakdown (private), earned credits

Every score-bearing row carries a `producing_layer` and `version` so the UI can always show provenance.

> **As-built (shipped).** The identity-keyed tables landed with a deliberate divergence tracked in `f-Socials-debt-and-todo.md`: saved reports and institutional workspaces key on the **Supabase JWT subject (`TEXT`)** rather than a local `users(id)` UUID (migrations `006`/`007`). The legacy `flags` FK to `users(id)` is kept and satisfied by **User_Sync** (migration `009` + `Repository.ensureLocalUser`), which syncs a local `users` row from the verified JWT claims before a flag is persisted. `expert_reviews`/`literacy_profile` remain as-specified targets.

---

## 10. UX & trust design

- **Dark mode default**, cool neutral palette, never partisan colors.
- Scores shown as **spatial maps and decomposed cards**, never a lone red number.
- **Manipulation cards** describe the *mechanism* ("omits widely-reported context"), not a verdict.
- **One-minute onboarding** = "how to read an analysis," not a generic tour. It explicitly says the tool assesses claims and cites sources rather than declaring truth.
- **Always-visible provenance**: "Scored by AI · last reviewed by expert on [date]."
- **Methodology page** is public, plain-language, and linked from every report.
- WCAG 2.2 AA: text labels alongside color, keyboard nav, screen-reader-friendly charts, captions/transcripts. English + Dutch from beta.

---

## 11. Trust, legal & partnerships

- **Expert layer via partnership,** not payroll: integrate with EDMO / BENEDMO hubs (KU Leuven, Leiden, VRT, fact-check orgs). They get telemetry on emerging disinfo; we get credibility and verification labor.
- **Human review queue** triggered by flag thresholds, low model confidence, or random audit.
- **EU posture:** advisory-only design is intended to **avoid high-risk classification** under the AI Act (Reg. 2024/1689) — but classification depends on actual use and must be confirmed by legal review, not assumed. GDPR-aligned (disclose automated processing, provide appeal paths, minimize retained personal data). DSA as a design north star (no dark patterns, transparent recommendations) — and a hard gate before any feed-reranking feature (Wedge B), since the DSA treats recommender systems as a regulated surface.
- **Dispute flow:** any creator or user can challenge a report; resolution is logged with a public changelog.

---

## 12. Go-to-market & monetization

**Traction & beachhead:**
- **Paying beachhead = educators, libraries, NGOs, and media-literacy communities.** They have clear budgets, clear impact stories, and calmer user behavior than the open consumer market. This is where v1 revenue and credibility come from.
- **The free public link-analyzer is the engine, not the revenue.** It drives acquisition, virality, and impact proof — every analysis is a **shareable URL**.
- Weekly "blindspot" / context breakdowns posted on the platforms we analyze.
- SEO on "is this video misleading / biased."

So: **free public tool for everyone, monetize institutions.** Consumer virality feeds the institutional story; the institutional budget funds the free tool.

**Monetization ladder:**
free personal tier → paid power-user → institutional seats → (later) creator pre-publish coaching. The public-interest core stays free.

**Guardrails-as-marketing:** published methodology, citations on every claim, "advisory not a verdict," account-safe extension. In a field of opaque tools, radical transparency *is* the differentiator.

---

## 13. Roadmap (18 months)

| Phase | Months | Focus |
|---|---|---|
| **Foundation** | 0–6 | Claims taxonomy + source policy, legal scoping, UX prototype, YouTube + article + transcript ingestion, claim ledger, framing cards, bridging sources, shareable reports |
| **Pilots** | 6–12 | Classroom/NGO institutional workspace, human-review + dispute flow, EDMO partnership, Dutch/English localization, WCAG hardening |
| **Read-only extension** | 12–18 | Browser extension that **reads the page and surfaces existing reports only** — no reranking, no intervention. Weekly digests. Paid institutional onboarding. |
| **Intervention & scale** | 18+ | Feed-friction experiments (Wedge B), public API, creator pre-publish tools — each gated on trust metrics and legal review |

The ordering is deliberate: **earn trust as a read-only context layer before touching anyone's feed.** Feed intervention is a regulated, sensitive surface and is the *last* thing to ship, not part of "growth."

---

## 14. KPIs — including red lines

**Growth / value:**
| Metric | M6 | M12 |
|---|---|---|
| Visitor → first analysis | 20%+ | 30%+ |
| First analysis completed | 60%+ | 70%+ |
| Weekly/monthly active ratio | 0.25+ | 0.35+ |
| 8-week retention | 18%+ | 25%+ |
| Alternative-perspective click-through | 20%+ | 30%+ |
| Active pilot organizations | 3+ | 10+ |

**Red-line (trust) metrics — watch these as closely as growth:**
- % of claim-bearing outputs with visible citations (target 85%+ → 95%+)
- Model-vs-human-QA agreement on sampled analyses (75%+ → 85%+)
- Disputed-analysis reversal rate
- Time-to-resolve a challenge request

> A trust product without trust metrics is just a vibes machine with charts.

---

## 15. Top risks & mitigations

| Risk | Mitigation |
|---|---|
| Platform access failure | YouTube + articles + uploads first; others as manual paste |
| Hallucinated / overconfident verdicts | Claim-level evidence, confidence bands, human review on high-risk |
| Perceived political bias | Issue-frame language, public methodology, dispute flow |
| GDPR / profiling exposure | No consequential ranking of people, disclose logic, appeal paths |
| AI Act drift | Label AI outputs, keep human oversight, advisory-only |
| Dark-pattern temptation | Humane design rules, no forced virality, honest uncertainty |
| Vendor lock-in | Swappable LLM/STT behind interfaces |
| Mission drift to enterprise listening | Public-interest north star; measure literacy outcomes, not just usage |

---

## 16. The one decision that defines the product

> f-Socials is a **lens, not a judge.** It launches on **YouTube + articles**, not "everything." It **shows construction and alternatives** instead of stamping a truth number. It earns trust through **transparency and partnerships** rather than claiming omniscience.

Everything above follows from that one sentence.

---

## 17. Next step

Turn this into a tight **f-Socials v1 Product Definition** — an execution spec, not another essay. It should pin down only:

1. **Target user:** media-literacy educators / libraries / NGOs (paying beachhead) + curious public users (free).
2. **Input:** YouTube link · article URL · pasted transcript.
3. **Output:** Claim Ledger · Framing Signals · Context Gaps · Bridging Sources · TLDR.
4. **What it refuses to do:** no truth score · no creator ranking · no feed intervention.
5. **Evaluation:** citation coverage · human-review agreement · user trust · perspective click-through.
6. **Legal posture:** advisory · transparent · contestable · privacy-minimized.

Plus the engineering scaffolding: PostgreSQL schema DDL, the v1 API routes, the analysis-job contract, and the MVP screen list — enough for a developer to start the Foundation phase.

> Keep v1 brutally simple: **paste link → inspect claims & framing → see credible alternatives → share report.** Everything else is earned later.
