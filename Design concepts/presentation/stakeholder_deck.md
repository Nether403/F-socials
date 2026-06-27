# Stakeholder Presentation Deck

This presentation outlines the product vision, target audience research, core design principles, and design system milestones for **F-Socials**. It includes slide layouts, content points, and presenter scripts.

---

## Slide 1: Title Slide
* **Slide Title**: F-Socials — A Lens, Not a Judge
* **Subtitle**: Reimagining Content Analysis for Media Literacy
* **Visual Layout**: Dark space background (`bg-brand-primary`), minimal clean typography, central glowing accent line (`text-accent-teal`).
* **Content**:
  * Product Vision: Media X-Ray, not a courtroom referee.
  * Focus: Design system foundations and user experience framework.
* **Presenter Script**:
  > *"Good morning, everyone. Today, I'm thrilled to present the design system and UX framework for F-Socials. In an era of rapid information cycles, F-Socials is built to serve not as a judge that issues verdicts, but as an objective lens—a media X-ray that shows how content is constructed so users can think for themselves."*

---

## Slide 2: The Problem
* **Slide Title**: The Verdict Trap
* **Visual Layout**: Splitted screen. Left = Messy social media screenshot; Right = Clean bullet list explaining user fatigue.
* **Content**:
  * Polarization: Simplistic "True/False" ratings stifle critical thinking.
  * Cognitive Bias: Bright red/green truth indicators cause immediate defensive reactions.
  * Media Fatigue: Users feel overwhelmed by sensationalist language.
* **Presenter Script**:
  > *"Existing platforms fall into the 'Verdict Trap.' Telling users 'This is False' or 'That is True' doesn't teach media literacy—it shut downs critical thinking and alienates audiences. Red and green badges act as stop signs. We want to replace these stop signs with microscopes."*

---

## Slide 3: The Vision
* **Slide Title**: The Media X-Ray
* **Visual Layout**: Full-screen visual wireframe mock of the Report page (Claim Ledger, Framing, Context).
* **Content**:
  * Annotated Reading Room: An overlay that dismantles transcripts and articles.
  * Provenance First: Absolute transparency regarding what AI models and source policies produced the analysis.
  * Objective & Forensic: Text and spacing elements prioritize readability and calm inspection.
* **Presenter Script**:
  > *"Our vision is the 'Media X-Ray.' The UI acts as an annotated reading room. When a user pastes a link, we break it down into explicit claims, highlight framing techniques, and provide adjacent context, all within a quiet, academic visual space."*

---

## Slide 4: Target Audience
* **Slide Title**: User Personas: Liam & Dr. Vance
* **Visual Layout**: Side-by-side card grid showing the casual user and the educator.
* **Content**:
  * **Liam Bakker (27)**: Casual user. Needs quick TL;DR summaries, mobile-first layouts, and easy sharing widgets to check claims before sending them to family chats.
  * **Dr. Elena Vance (42)**: Educator. Needs high-density data views, classroom projection scaling, and exported citation lists.
* **Presenter Script**:
  > *"We are designing for two core audiences. Liam represents the general public—he's copy-pasting links on his phone and needs a quick, non-judgmental summary. Dr. Vance represents the educator who wants a high-density, reliable workspace to project in lecture halls and use as a teaching tool."*

---

## Slide 5: Core Design Principles
* **Slide Title**: How We Design: Core Principles
* **Visual Layout**: 4-column icon grid showing: Lens, Calm, Evidence, and Neutrality.
* **Content**:
  * **Lens, Not Judge**: Inspect over pressure; no absolute truth verdicts.
  * **Calm Precision**: Editorial font scales, no flashing alerts.
  * **Evidence Over Assertion**: Every claim must link to a citation.
  * **Neutrality by Construction**: Desaturated color palette; no red/green polar pairings.
* **Presenter Script**:
  > *"Our design is guided by four principles. We act as a lens, not a judge. We use calm, editorial typography. We require evidence for every assertion. And we maintain visual neutrality by avoiding high-contrast red and green indicators."*

---

## Slide 6: Color & Typography Foundations
* **Slide Title**: Visual Foundations
* **Visual Layout**: Swatch matrix for colors (Dark/Light mode) + Typography hierarchy panel demonstrating Inter and IBM Plex Sans.
* **Content**:
  * Palette: Deep Space Blue, Off-White, Muted Accent Cyan, Semantic Muted Teal (Success), Semantic Muted Amber (Warning).
  * Typography: **Inter** for responsive UI controls; **IBM Plex Sans** for clean, precise content reports.
* **Presenter Script**:
  > *"Our color palette uses deep, calm slates and off-whites. Semantic indicators use muted, desaturated tones. For typography, we pair the highly readable Inter font for buttons and controls with IBM Plex Sans for claims and citation reports, providing a professional, newsroom feel."*

---

## Slide 7: Feature Spotlight: The Claim Ledger
* **Slide Title**: The Claim Ledger & Evidence Drawer
* **Visual Layout**: Close-up wireframe animation or mock showing a Claim card expanding into its detail view.
* **Content**:
  * Evidence Strength chip: Muted tags showing verifiability.
  * Citation count button: Clickable counter linking to source lists.
  * Original quote overlay: Displays claims in their exact context.
* **Presenter Script**:
  > *"The heart of the report is the Claim Ledger. Claims are presented clearly with an evidence tag. Clicking a claim expands the Evidence Drawer to reveal the exact transcript quote, citation links, and checking history. This makes verification a simple, clickable journey."*

---

## Slide 8: Feature Spotlight: Framing Signals
* **Slide Title**: Identifying Influence
* **Visual Layout**: Visual highlight card showing how "Emotional Language" is mapped to a specific text span.
* **Content**:
  * Framing Signal tags: High/Medium severity categories.
  * Mapped signals: Us vs. Them, Selective Emphasis, Emotionally Charged words.
  * Interactive tooltips: Explain the linguistic structure behind the framing.
* **Presenter Script**:
  > *"Next are Framing Signals. F-Socials highlights linguistic signals like emotionally loaded words or 'Us vs. Them' divisions. Clicking a signal shows the user exactly where this phrasing occurred in the text, educating them on how content is framed to influence public emotion."*

---

## Slide 9: Component Library & Interactive States
* **Slide Title**: Production-Ready Component Library
* **Visual Layout**: Grid collage showing Navigation bars, Input Fields, Cards, Avatars, and loaders.
* **Content**:
  * Token-driven: All elements inherit properties from `tokens.json`.
  * State completeness: Default, Hover, Active, Focus, Disabled, Error.
  * Standardized corner radii and elevation shadows.
* **Presenter Script**:
  > *"We've built a scalable, token-driven component library. Every element, from the hero URL input to the navigation bars, is defined with consistent padding, corner radii, and fully detailed interactive states, ensuring a seamless developer handoff."*

---

## Slide 10: Next Steps
* **Slide Title**: Design Roadmap & Implementation
* **Visual Layout**: Horizontal timeline graph.
* **Content**:
  * **Phase 1: Foundation (Done)**: Design system + tokens + strategy files, **and** the build — the React app and analysis engine are live end-to-end (real providers, durable infra, the invariant gate, shareable reports).
  * **Phase 2: Trust surfaces (Current)**: Methodology page, source-tier credibility upgrade, dispute/flag intake, accessibility (WCAG 2.2 AA) pass, safe public deploy. (See `f-Socials-roadmap.md`.)
  * **Phase 3: Pilots**: Accounts/save, expert review queue, institutional workspace, EN/NL localization, EDMO/BENEDMO partnership.
* **Presenter Script**:
  > *"Our roadmap has moved fast. Phase 1 is done — not just the design system, but a working product: paste a link, get a shareable analysis, backed by a real engine and the invariant that every claim cites its source. We're now in Phase 2, hardening the trust surfaces — methodology, source credibility, disputes, accessibility — before a safe public launch. Phase 3 brings accounts, expert review, and the institutional workspace for our educator pilots. Thank you, and I'd love to take your questions."*
