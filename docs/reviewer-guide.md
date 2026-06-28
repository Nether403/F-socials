# f-Socials — Reviewer Guide

> For authorized reviewers working the dispute/flag queue. If you're a general reader, you don't need this — see the [User Guide](./user-guide.md) instead.

## What review is for

Readers can challenge any report: they can **dispute** it (anonymous) or **flag** a specific framing signal (signed-in). Those challenges land in a queue. Your job as a reviewer is to triage them and record a resolution — which feeds the report's **review status** that everyone sees.

The single most important rule: **you review the report's framing and evidence, never the truth of the content and never the creator.** f-Socials is a lens, not a judge. The resolution options you're given are deliberately limited to framing/evidence outcomes — there is no "true," "false," "misinformation," or creator-reliability option, and there never will be.

## Getting access

Review actions are **role-gated**. The server checks your authenticated role against a configured reviewer role (`REVIEWER_ROLE`). If the deployment hasn't configured a reviewer role at all, the system **fails closed** — every review route is denied — so review is never accidentally left open. If you reach the console and get a sign-in or "not a reviewer" message, your account isn't authorized for review yet.

*(Note: the web app doesn't have a sign-in screen yet, so until that lands the console resolves an unauthorized state to a sign-in/error view.)*

## The Reviewer Console

Open the console at the `#/review` route. You'll see the **queue** — one item per dispute and one per flag — each showing:

- the **report** it concerns,
- the **dispute reason** (for disputes) or the **flagged technique** (for flags),
- its **status** (Pending → In review → Resolved), shown as a text label, never color alone,
- and the **assignee** — an explicit "Unassigned" label when nobody holds it.

The console has distinct states for loading, an empty queue, and errors/sign-in — it never shows a half-rendered view.

## The workflow

### 1. Claim an item
Claiming an item assigns it to you and moves it to **In review**, so two reviewers don't duplicate work on the same dispute. Claiming is safe under contention: if two reviewers try to claim the same pending item at once, exactly one wins and the other is told it's already claimed. Claiming something you already hold is harmless (it stays yours).

### 2. Release (if you can't finish)
If you claimed an item but can't resolve it, **release** it. That returns it to **Pending** and unassigns it so another reviewer can pick it up. You can only release an item you currently hold.

### 3. Resolve
Recording a **resolution** sets the item to **Resolved** and stores your chosen outcome, an optional note, and your reviewer id with a timestamp. You don't have to claim an item before resolving it. Re-resolving an already-resolved item replaces the prior resolution (it never creates a duplicate).

The **resolution outcomes** are framing/evidence-only — for example:

| Outcome | Use when… |
|---|---|
| **Framing example confirmed** | the surfaced framing signal's quoted example genuinely demonstrates the technique. |
| **Framing example weak** | the example is thin or unconvincing for the technique claimed. |
| **Evidence adequately cited** | the claim's stated evidence strength matches its citations. |
| **Evidence overstated** | a claim asserts more evidence strength than its citations support. |
| **Context gap noted** | a useful piece of missing context was identified. |
| **No change needed** | the review found nothing to adjust. |
| **Needs further review** | inconclusive — escalate / leave for deeper review. |

An optional note (up to ~2,000 characters) lets you record your reasoning. Keep it about the framing or the evidence.

## How your resolution shows up

Review status is **derived**, not hand-set, and it's computed when a report is read:

- While **any** dispute/flag for a report is still Pending or In review → the report reads **Under dispute**.
- Once **every** item for the report is Resolved → the report reads **Expert-reviewed**.
- A report with no items keeps whatever status it already had (e.g. AI-generated).

Importantly, resolving items **never rewrites the report itself** — none of its claims, framing, citations, evidence strengths, or confidence change. Review only ever overlays the status. This is by design: the report's integrity gate can never be altered by the review workflow.

## Honest absence still stands

If a report genuinely has no external evidence, the console shows a labeled **"no external review found"** state. Do not substitute a verdict for absent evidence — that absence is the honest, correct outcome, and recording a framing/evidence resolution doesn't change it.

## Quick reference

| Action | Effect | Constraint |
|---|---|---|
| **Claim** | assigns to you, → In review | exactly one winner under contention; resolved items can't be claimed |
| **Release** | unassigns, → Pending | only the holder can release |
| **Resolve** | stores outcome + note, → Resolved | no prior claim required; re-resolving replaces, never duplicates |

Keyboard-operable throughout, with ARIA descriptions and color-never-alone labels. If an action fails (e.g. someone else already claimed an item), the console shows an error, leaves the item unchanged, and keeps the controls ready for you to retry.
