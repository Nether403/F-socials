# f-Socials — User Guide & Manual

> **A lens, not a judge.** This guide walks you through what f-Socials does, how to run an analysis, and — most importantly — how to read a report so it actually sharpens your own judgment.

---

## 1. What f-Socials is (and isn't)

**What it is:** a media-literacy tool. You give it a piece of content — a YouTube video, a news article, or a block of text — and it produces an inspectable *report* that breaks the content down into its parts:

- the **factual claims** it makes, each with whatever real evidence f-Socials could find,
- the **framing and persuasion techniques** it uses, each tied to the exact quote that triggered it,
- **useful context** the content left out,
- and **other credible perspectives** on the same topic.

**What it is not:** a fact-checker that stamps things TRUE or FALSE, a "credibility score" for influencers, or an arbiter of who's right. It deliberately refuses to do those things. f-Socials surfaces *how* a message is constructed and *what evidence exists*; the conclusion stays yours.

**Why that matters:** most misleading content isn't a flat-out lie you can "debunk." It's true-ish facts arranged to push a feeling or a conclusion. A verdict ("false!") bounces off that. Seeing the framing — *"this is fear appeal," "this claim cites no source," "here's the study it's misrepresenting"* — is what actually inoculates you.

---

## 2. Running an analysis

1. Open f-Socials and you'll land on the home screen with a single input box.
2. Paste **one** of:
   - a **YouTube link** (the transcript is fetched automatically),
   - an **article URL** (the readable text is extracted),
   - or **pasted text / a transcript** (great for a script, a post, or a quote you copied).
3. Press **Analyze** (or `Ctrl/Cmd + Enter`).
4. You'll see a short loading sequence — acquiring the transcript, extracting claims and framing, checking evidence, finding other perspectives, assembling the report. This usually takes a few seconds to a minute depending on length.
5. The finished **report** appears.

**Tip — try the examples.** The home screen has one-click example clips (a persuasive monologue, a conspiracy-laden rant) so you can see a full report before analyzing your own content.

**A note on speed and cost:** f-Socials hashes each input. If someone already analyzed the exact same content, you get the cached report instantly — which is what keeps the public tier free and fast.

---

## 3. Reading a report, section by section

A report is organized top-to-bottom from "the gist" to "the details." You don't have to read all of it — lead with the summary and open the parts you care about.

### 3.1 The summary (TL;DR) and the issue frame
At the top: a plain-language **summary** of what the content is about, and an **issue-frame spectrum** — a simple visual showing where the content sits on the spectrum of how a topic is framed (e.g. which angle it takes). The position is described in text too, not by color or dot position alone.

### 3.2 The Claim Ledger
This is the heart of the report: every **factual claim** f-Socials extracted, each one expandable. For each claim you'll see an **evidence-strength label** in plain words:

| Label | What it means |
|---|---|
| **Well-sourced** | Strong, matching evidence was found and is cited. |
| **Sourced** | Moderate matching evidence is cited. |
| **Lightly sourced** | Some evidence is cited, but it's thin. |
| **No external review** | f-Socials could not find sufficient matching evidence. **This is honest, not a failure** — and it never means the claim is false, only that independent evidence wasn't found. |

Open a claim to see its **citations** — the actual sources, each tagged with a **source tier** (see §3.5). f-Socials only attaches a citation when the source genuinely matches *that claim* — it will not dress up a near-miss as evidence. A wrong citation is treated as worse than a missing one.

### 3.3 Framing Signals
Switch to the **Framing Signals** view to see the persuasion techniques in the content — things like loaded language, us-vs-them framing, or fear appeals. Each signal carries:

- the **technique name**,
- a **severity** shown as text (e.g. "medium severity"), never color alone,
- a short description, and
- the **exact highlighted quote** from the transcript that triggered it.

The transcript is interactive: the flagged passages are highlighted in place, so you can see the technique *in context* rather than taking our word for it. This is the inoculation layer — once you've seen "fear appeal" tied to a specific sentence a few times, you start spotting it yourself.

### 3.4 Useful Context
Cards that add **missing context** — background the content left out that helps you evaluate it. When f-Socials supplies a fact here it shows where it came from; it does not invent sources.

### 3.5 Perspectives (other credible angles)
Other coverage of the same topic, selected to *bridge* viewpoints rather than confirm one. Each perspective shows its **source** and that source's **tier**. Social-media posts are filtered out — these are substantive sources, not more hot takes.

**Source tiers** describe the *source*, never the creator of the content you analyzed:

| Tier | Meaning |
|---|---|
| **Tier 1 · Primary** | A first-party / primary record (e.g. an official document, an institutional dataset). |
| **Tier 2 · Institutional** | An institutional publisher. |
| **Tier 3 · Viewpoint** | A general viewpoint source. |
| **Excluded** | Could not be resolved to a trusted tier — never counts as evidence. |

These tiers come from a transparent, versioned policy built only from *open* signals (the IFCN fact-checker signatory list, institutional domain rules like `.gov`/`.edu`, press-council membership). No proprietary "bias chart" is used. You can inspect the whole policy on the Methodology page.

### 3.6 The provenance footer
At the bottom, every report tells you how it was made: the model and analysis version, the source-policy version, when it was last updated, how many disputes it has, and its **review status**:

| Review status | Meaning |
|---|---|
| **AI-generated** | Produced by the automated pipeline; no human review recorded yet. |
| **Expert-reviewed** | A human reviewer has worked the disputes/flags for this report and resolved them. |
| **Under dispute** | At least one dispute or flag about this report is still open or in review. |

The footer is also where you'll find the **dispute**, **flag**, and **share** controls (next section), and a link to the **Methodology** page.

---

## 4. Pushing back: disputes, flags, and sharing

f-Socials expects to be challenged. Two ways to do that:

### Dispute a report (anyone, no account)
If you think the analysis got something wrong, use the **dispute** control in the footer. Disputes are **anonymous** — no account, no identity stored. Write what you think is off and submit. Your dispute enters the review queue and, while it's open, the report's status reflects that it's **under dispute**.

### Flag a framing signal (requires sign-in)
If you think a *specific framing technique* was misapplied, use the per-signal **flag** control. Flagging is tied to a technique the report actually surfaced. *(Note: the public web app doesn't have a sign-in screen yet, so the flag/save controls currently show a sign-in prompt — the capability exists on the server side.)*

Both disputes and flags feed the **expert review workflow**: authorized reviewers triage them, claim them, and record a resolution that's strictly about the report's *framing or evidence* — never a verdict on the content's truth or a rating of its creator. The outcome updates the report's review status. (If you're a reviewer, see the [Reviewer Guide](./reviewer-guide.md).)

### Share a report
The **share** control copies a public, read-only link to the report. Anyone with the link can read it — no account needed. This is the unit f-Socials is built around: analyze a viral clip once, share the lens with everyone who saw it.

---

## 5. Accessibility

f-Socials is built to be usable by a broad audience:

- **Color is never the only signal** — every status, severity, tier, and evidence strength has a text label beside it.
- **Keyboard operable** — claim drawers, framing tabs, the dispute modal, and the reviewer controls all work without a mouse.
- **Screen-reader support** — ARIA descriptions on interactive controls and on the framing highlights; the issue-frame spectrum is described in text.
- **Responsive** — collapses to a single column at 768px and below.

Full WCAG 2.2 AA conformance still gets a manual assistive-technology review; automated checks cover the ARIA wiring and a contrast audit.

---

## 6. How to actually use this (a short playbook)

1. **Read the TL;DR first.** Get the gist in one sentence.
2. **Glance at the loudest framing signal.** What's the single strongest persuasion move? Seeing it named takes the air out of it.
3. **Spot-check one claim that surprised you.** Open it. Is it *Well-sourced*, or *No external review*? Click the citation and read the actual source.
4. **Read one opposing perspective.** Even a 20-second skim of a different credible angle reframes the whole thing.
5. **If something's wrong, dispute it.** The lens gets better when people push on it.

You don't need to do all five every time. Even step 1 + step 2 — gist plus loudest framing move — changes how you react to a clip.

---

## 7. A few honest limits

- f-Socials analyzes the **content you give it**, from its transcript/text. It can't see a video's visuals or tone of voice.
- "No external review" is common and **expected** for niche or very recent claims — it means evidence wasn't found, not that the claim is wrong.
- Evidence search depends on what's publicly findable; it's tuned for **precision over recall** (rather cite nothing than cite something that doesn't actually match).
- The automated report is a starting point for *your* judgment, supported where possible by human review — not a final ruling.

---

*Want the technical details — exactly how evidence outcomes are distinguished, the full source-tier policy, who reviews reports? Open the **Methodology** page from any report's footer (`#/methodology`), or see the [FAQ](./faq.md).*
