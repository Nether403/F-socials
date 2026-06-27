# F-Socials — UI/UX Design System & Deliverables

Welcome to the comprehensive design system and UX specification repository for **F-Socials**, a next-generation social media platform designed to serve as an objective lens for analyzed content, rather than a subjective truth referee.

This project delivers a complete, high-fidelity design framework and documentation to align strategy, design, and development teams around a unified product vision.

> **Implementation status:** these are the design deliverables. The product they describe is **built** — a live React app and analysis engine (see `../app/` and `../f-Socials-debt-and-todo.md`). When building UI, drive it from the live backend report contract, not the prototype's mock shape. Roadmap and sequencing: `../f-Socials-roadmap.md`.

---

## Deliverables Directory

All design assets and documents are organized within this repository:

### 1. User Experience & Strategy
* **[Target Audience Specifications (ux/target_audience.md)](file:///C:/Users/van_d/Documents/antigravity/mysterious-oppenheimer/ux/target_audience.md)**
  * User Personas (demographics, goals, pain points, behaviors)
  * User Journey Maps (onboarding, content discovery, disputes)
  * Empathy Maps (user cognitive states)
  * Audience Segmentation Strategy
* **[UX Guidelines (ux/guidelines.md)](file:///C:/Users/van_d/Documents/antigravity/mysterious-oppenheimer/ux/guidelines.md)**
  * Core Design Principles ("A lens, not a judge")
  * Accessibility Guidelines (WCAG 2.2 AA checklist, contrast guidelines, touch targets)
  * Responsive Design Breakpoints & Layout Rules
  * Interaction Patterns (gestures, micro-interactions, feedback loops)
  * Content Style Guide (tone of voice, placeholder standards)
  * Visual Do's & Don'ts Checklist

### 2. Design System Foundations & Components
* **[Design Tokens (design_system/tokens.json)](file:///C:/Users/van_d/Documents/antigravity/mysterious-oppenheimer/design_system/tokens.json)**
  * W3C standard JSON tokens (Colors, Typography, Spacing, Shadows, Border Radii, Motion)
* **[Visual Foundation & Component Spec (design_system/documentation.md)](file:///C:/Users/van_d/Documents/antigravity/mysterious-oppenheimer/design_system/documentation.md)**
  * Layout grids and spacing rules
  * Iconography standards and core icon index
  * Component states (default, hover, active, focus, disabled, error) for all 12 core libraries
* **[Developer Handoff Guide (design_system/developer_handoff.md)](file:///C:/Users/van_d/Documents/antigravity/mysterious-oppenheimer/design_system/developer_handoff.md)**
  * Annotation specs for sizing, padding, and layout
  * CSS/Tailwind utility map referencing design tokens
  * Release changelog template for version tracking
* **[Figma File Organization Spec (design_system/figma_structure.md)](file:///C:/Users/van_d/Documents/antigravity/mysterious-oppenheimer/design_system/figma_structure.md)**
  * Guidelines for setting up Figma pages, design tokens, component variants, and prototypes

### 3. Product & Presentation
* **[Feature Mapping (features/feature_mapping.md)](file:///C:/Users/van_d/Documents/antigravity/mysterious-oppenheimer/features/feature_mapping.md)**
  * Claim Ledger layout & verifiability flows
  * Framing Signals interaction & evidence expansion
  * Useful Context & Other Credible Angles card mapping
  * dispute submission and review queue wireframes/flows
* **[Stakeholder Presentation Deck (presentation/stakeholder_deck.md)](file:///C:/Users/van_d/Documents/antigravity/mysterious-oppenheimer/presentation/stakeholder_deck.md)**
  * 10-slide strategy deck structure and presentation script covering vision, principles, key screens, and roadmap

---

## Core Product Vision: "A Lens, Not a Judge"

F-Socials is built to counter cognitive bias and sensationalism by showing users *how* social content is constructed, rather than telling them *what* to believe:
* **No Verdict Colors**: Green/red colors are completely omitted for truth indicators. Semantic messaging uses cool teals for positive confirmation, muted warm amber for caution, and soft rose/coral for errors.
* **Inspect over Pressure**: The interface encourages investigation via expandable evidence drawers, citation cards, and side-by-side alternative angles.
* **Calm precision**: A quiet, editorial typographic hierarchy utilizing **Inter** for clean UI utility and **IBM Plex Sans** for structured, scholarly reports.
