# UX Guidelines & Design Strategy

This document outlines the core design principles, accessibility rules, responsive layout grid system, interaction behaviors, and content standards for **F-Socials**. It serves as a behavioral contract for designers and developers to ensure visual consistency and product integrity.

---

## 1. Core Design Principles

### Principle 1: Lens, Not Judge
* **Definition**: F-Socials is an analytical tool to inspect content, not a courtroom to issue verdicts. We show *how* a claim is structured, what evidence supports it, and what framing methods are used. We never tell the user *what* is true or false.
* **Core Design Rule**: Does this UI element help the user inspect, or does it pressure them to accept? If it pressures, remove it.
* **Do**: Present claims with evidence strength levels like "Mixed Evidence", "Weak Evidence", or "Insufficient Evidence".
* **Don't**: Use checkmarks, red crosses, or labels like "Fact Check: False".

### Principle 2: Calm Precision
* **Definition**: Avoid the attention-grabbing patterns of typical social networks. F-Socials uses a restrained visual language reminiscent of a forensic ledger or academic briefing.
* **Do**: Use muted, desaturated HSL colors. Let typography and layout grids carry the hierarchy.
* **Don't**: Use pulsing icons, alarmist sirens, flashing highlights, or red/green badges indicating truth status.

### Principle 3: Evidence Over Assertion
* **Definition**: No claim or framing signal can be shown without a visible, clickable source citation or transcript reference.
* **Do**: Provide an expandable "Evidence Drawer" for every claim that exposes the original quote, checked source links, and methodology notes.
* **Don't**: List claims as a simple list without direct ties to source files or external verified databases.

### Principle 4: Neutrality by Construction
* **Definition**: The visual system avoids partisan signifiers or polar colors.
* **Do**: Use a desaturated blue/slate base palette with muted amber for warnings and soft teal for confirmations.
* **Don't**: Use bright, high-chroma red and green next to each other, as they evoke immediate cognitive bias.

---

## 2. Accessibility Guidelines (WCAG 2.2 AA Compliance)

Every component must meet or exceed WCAG 2.2 AA requirements. (2.2 is a superset of 2.1 — the criteria below still hold; 2.2 also adds focus-appearance, minimum target size (24×24px), and dragging-alternative criteria, which the 44×44px targets and visible focus rings here already satisfy.)

### Contrast Ratios
* **Normal Text (<18pt)**: Must have a contrast ratio of at least **4.5:1** against the background.
* **Large Text (>=18pt or bold >=14pt)**: Must have a contrast ratio of at least **3:1** against the background.
* **Interactive Elements**: Active focus states, borders, and input fields must have at least **3:1** contrast against their adjacent background.

### Touch Targets
* **Minimum Size**: All clickable elements (buttons, toggles, text links, tabs) must have a touch target of at least **44x44px**.
* **Padding & Spacing**: When icons are smaller than 44px (e.g., 24px), apply transparent padding to meet the 44px threshold without swelling the visual icon size.

### Focus Management & Keyboard Navigation
* **Focus Indicators**: Never disable default outline rings without replacing them with custom, high-visibility focus states (e.g., `focus:ring-2 focus:ring-accent-teal`).
* **Visual Sequence**: Keyboard tab order (`Tab` key) must strictly follow the visual layout sequence: Top-down, left-to-right.
* **Modals & Drawers**:
  * Pressing `Escape` must close active drawers, modals, or sheets.
  * Focus must be trapped inside modals when open, and restored to the triggering element upon closure.

### Screen Reader / ARIA Attributes
* **Icon Buttons**: Must include `aria-label` or `aria-describedby` (e.g., `<button aria-label="Dispute Claim">`).
* **Expandable Drawers**: Use `aria-expanded="true/false"` and `aria-controls="drawer-id"` to signal layout shifts to screen readers.
* **Dynamic Indicators**: Status tags (like "Mixed Evidence") must include screen-reader-only labels explaining their meaning.

---

## 3. Responsive Design Rules

F-Socials employs a mobile-first design language. Desktop screens are treated as layouts that organize columns side-by-side, rather than stretching mobile views.

```
+-----------------------------------------------------------------------------+
| Breakpoint | Min-Width | Column Grid | Margin  | Layout Pattern             |
|------------+-----------+-------------+---------+----------------------------|
| Mobile     | 375px     | 4 Columns   | 16px    | Single Column, Bottom Nav  |
| Tablet     | 768px     | 8 Columns   | 24px    | Constrained Card, Side Rail|
| Desktop    | 1280px    | 12 Columns  | 40px    | Multi-Column, Left Sidebar |
| Wide       | 1440px    | 12 Columns  | 48px    | Max Content Width 1280px   |
+-----------------------------------------------------------------------------+
```

### Layout Shift Adaptations
* **Navigation**: Mobile layouts use a sticky bottom navigation bar for primary actions. On desktop, this transforms into a fixed left sidebar with secondary profile/methodology sections.
* **Report Page**:
  * **Mobile**: Single vertical feed. Sections (Claims, Framing, Context, Sources) are stacked or toggled via tab buttons.
  * **Desktop**: Three-column layout. Left column = Sidebar navigation. Middle column = Content analysis report. Right column = Sticky table of contents and provenance details.

---

## 4. Interaction Patterns & Motion

### Motion Principles
* **Functional Motion Only**: Animations should only be used to orient the user (e.g., opening a drawer) or confirm an action. Avoid decorative, distracting animations.
* **Reduced Motion**: Respect system settings by wrapping all transitions in the CSS media query `prefers-reduced-motion`.

### Duration & Easing Scale
* **Micro-interactions (Buttons, Toggles)**: `150ms` | Easing: `cubic-bezier(0.4, 0, 0.2, 1)` (ease-in-out)
* **Small Cards / Hover states**: `200ms` | Easing: `cubic-bezier(0, 0, 0.2, 1)` (ease-out)
* **Large Drawers / Modals**: `300ms` | Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-quint)

### Gestures (Touch Interfaces)
* **Swipe Left/Right**: Swipe on story cards to view alternate perspectives.
* **Swipe Down**: Swipe down on a mobile bottom sheet to dismiss it.
* **Pull-to-Refresh**: Allowed on the My Reports feed page. Not allowed on active analysis pages.

---

## 5. Content Style & Writing Guidelines

### Tone of Voice
* **Objective & Forensic**: Write like a science journal or a legal clerk. Avoid adverbs and emotion-laden descriptors.
* **Plain Language**: Avoid overly academic jargon. Use short, direct sentences.
* **Non-Judgmental**: Describe *what* is missing or *how* a comparison is structured without labeling the source as "liar" or "propagandist."

### Copy Patterns

| Category | Do | Don't |
| :--- | :--- | :--- |
| **Framing Signal** | *"Framing signal: Emotionally loaded contrast"* | *"Manipulative propaganda detected"* |
| **Evidence Label** | *"Insufficient evidence: No source citation provided."* | *"False claim: Completely fabricated."* |
| **Dispute Label** | *"Dispute this analysis"* | *"Report error"* |
| **Context Badge** | *"Other Credible Angles"* | *"Unbiased truth"* |

---

## 6. Visual Do's & Don'ts Checklist

### Do's
* [x] **DO** keep the main Hero Input visible and prominent on the landing page.
* [x] **DO** show the provenance details ("AI-generated by model X, version Y") at the footer of every report page.
* [x] **DO** use consistent card padding (minimum 16px on mobile, 24px on desktop).
* [x] **DO** make all link targets explicit (use external link icon `↗` for links exiting F-Socials).

### Don'ts
* [ ] **DON'T** use floating action buttons (FAB) for secondary navigation; reserve them solely for "New Analysis".
* [ ] **DON'T** mix different border radii in the same container; card corners must match the default token scale (e.g., `rounded-lg`).
* [ ] **DON'T** use colored text for body paragraphs; text color must follow the typography hierarchy system.
* [ ] **DON'T** display user dispute comments without their corresponding claim reference.
