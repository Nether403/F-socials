# f-Socials — Frequently Asked Questions

## The basics

**What is f-Socials in one sentence?**
A media-literacy lens that breaks a piece of content down into its claims, the evidence behind them, its framing techniques, and other credible angles — so you can decide what to think, instead of being told.

**Does it tell me if something is true or false?**
No, and that's deliberate. f-Socials shows you the claims, the evidence it could (or couldn't) find, and the persuasion techniques in the framing. It never issues a true/false verdict on content. Most misleading media isn't a clean lie you can debunk — it's framing — so a verdict would miss the point and a wrong verdict would do harm.

**Does it rate creators or channels?**
Never. Reliability tiers attach to *sources and citations* only — never to a person, channel, or author. There are no "creator credibility scores," by design and as a hard rule enforced in the software.

**What can I analyze?**
A YouTube link, a news article URL, or pasted text/transcript.

**Do I need an account?**
No. You can analyze content, read reports, dispute a report, and share a report without signing in. (A sign-in is only needed for flagging a specific framing technique and, eventually, saving reports.)

**Is it free?**
The public reading/analysis tier is built to stay free — f-Socials caches each analyzed input, so popular content is analyzed once and served to everyone from cache.

---

## Reading a report

**A claim says "No external review." Does that mean it's false?**
No. It means f-Socials did not find sufficient independent evidence that matches that claim. That's an honest statement of absence — common for niche, local, or very recent claims — not a judgment that the claim is wrong.

**Why does one claim have a source and a similar one doesn't?**
f-Socials only attaches a citation when the source genuinely matches *that specific claim*. It deliberately won't present a near-miss as evidence. The guiding rule is "a wrong citation is worse than a missing one."

**What are the source tiers (Primary / Institutional / Viewpoint / Excluded)?**
They describe how authoritative a *source* is, using a transparent policy built only from open signals (the IFCN fact-checker list, institutional domain rules like `.gov`/`.edu`, press-council membership). They never describe the creator of the content you analyzed. "Excluded" sources never count as evidence. The full policy is on the Methodology page.

**What do the framing signals mean?**
They name persuasion techniques (loaded language, us-vs-them, fear appeal, etc.) and show you the exact quote that triggered each one. The point is to make the technique visible in context so you start recognizing it on your own.

**What does the review status mean?**
- **AI-generated** — produced by the automated pipeline, no human review recorded yet.
- **Expert-reviewed** — a human reviewer worked and resolved the disputes/flags for this report.
- **Under dispute** — at least one dispute or flag is still open or in review.

---

## Pushing back

**I think a report is wrong. What can I do?**
Use the **dispute** control in the report footer — anonymous, no account needed. Your dispute enters a review queue and the report shows as "under dispute" while it's open.

**What happens to my dispute?**
Authorized human reviewers triage and resolve it. Their resolution is strictly about the report's *framing or evidence* — they never add a truth verdict or a creator rating. The report's review status updates accordingly.

**Is my dispute anonymous?**
Yes. f-Socials does not record or expose any submitter identity for a dispute — no account, name, IP, or session is attached to it anywhere in the review workflow.

---

## Trust & privacy

**How do I know it's not just another biased "bias checker"?**
Three things are enforced in code, not just promised:
1. A report can't be marked ready unless every claim's stated evidence strength is backed by a citation it can point to, and every framing flag has a real quote behind it.
2. Source tiers attach to sources only — there is structurally no place to rate a creator.
3. The resolution vocabulary reviewers can use contains only framing/evidence outcomes — no "true," "false," "misinformation," or reliability labels. A test fails the build if one ever sneaks in.

**What data is collected?**
The analysis works from the content you submit. Optional product analytics and error monitoring are privacy-guarded: a redaction layer strips transcripts, raw claim text, tokens, and user identifiers before anything leaves the system, and web analytics only run after you consent. With no analytics keys configured, none of it runs at all.

**Can I trust the evidence search to be complete?**
It's tuned for **precision over recall** — it would rather find nothing than cite something that doesn't actually match the claim. So treat "No external review" as "not found," and treat a citation as "this source genuinely matches," but don't assume the search is exhaustive.

---

## Practical

**Why did my report come back instantly?**
That content was analyzed before, so you got the cached report.

**Can I share a report?**
Yes — the share control copies a public, read-only link that anyone can open without an account.

**It says I need to sign in to flag something.**
The web app doesn't have a sign-in screen yet, so flag/save controls show a sign-in prompt for now. Disputing a report works without any of that.

**Where are the technical details?**
The in-app **Methodology** page (`#/methodology`, linked from every report footer) covers how evidence outcomes are distinguished, what raises or lowers confidence, the full source-tier policy with its live version, the review statuses, and a glossary. Developers should see the project `README.md`.
