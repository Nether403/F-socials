# Figma File Organization Specification

To ensure scaling and easy handoff, the F-Socials Figma file must be organized according to the following page-level structure, component naming rules, and prototyping settings.

---

## 1. Page Organization

The Figma file must be divided into four distinct pages:

### Page 1: ❖ Design Tokens
* **Content**: The single source of truth for raw styles and variables.
* **Layout**: Grid layout organizing:
  * Color Swatches (categorized into Brand, Neutral-Light, Neutral-Dark, Semantic). All swatches must link directly to Figma Variables.
  * Typography Scale (Display, H1, H2, H3, Body, Small, Caption) mapped to local Text Styles.
  * Spacing & Corner Radius grids demonstrating the 8pt scale visually.
  * Shadow effect styles (Flat, Raised, Overlay, Modal).

### Page 2: ❖ Component Library
* **Content**: Reusable components organized in auto-layout grids.
* **Layout**:
  * Every component is created as a Component Set (Variants).
  * Variants must represent all interactive states (Default, Hover, Active, Focus, Disabled, Error).
  * Include a title card next to each set detailing component rules and properties.

### Page 3: ❖ Screen Templates
* **Content**: Complete viewport frames showing high-fidelity pages.
* **Layout**:
  * Stacked vertically by device type: Mobile (375px wide), Tablet (768px wide), Desktop (1280px wide).
  * Every frame must use Auto-Layout exclusively to ensure responsive resizing behavior.
  * Separate dark mode and light mode columns.

### Page 4: ❖ Prototype Flows
* **Content**: Clickable interactive prototypes.
* **Layout**:
  * Isolated flows connected by prototype links.
  * Flow 1: Onboarding and Paste-URL Flow.
  * Flow 2: Claim expansion & Evidence Drawer Flow.
  * Flow 3: Dispute Submission Modal Flow.

---

## 2. Component Variant Structure

All components must utilize Figma Auto-Layout (v4+) and Component Properties.

### Button Component Set Properties
* **Type**: `Primary` | `Secondary` | `Ghost`
* **State**: `Default` | `Hover` | `Active` | `Focus` | `Disabled`
* **Icon**: `None` | `Left` | `Right` | `Icon-Only`
* **Theme**: `Dark` | `Light`

### Claim Card Set Properties
* **State**: `Collapsed` | `Expanded`
* **Evidence**: `Supported` | `Mixed` | `Weak` | `Insufficient`
* **Theme**: `Dark` | `Light`

### Auto-Layout Rules
* **Borders**: Must use the native Figma stroke property. Do not draw line elements inside cards for borders.
* **Responsive Resizing**: 
  * Main cards: Width set to `Fill Container`, Height set to `Hug Contents`.
  * Text nodes: Width set to `Fill Container` to prevent clipping or run-on boundaries.
  * Touch area padding: Minimum 8px transparent padding wrapper on small icons.

---

## 3. Prototype Settings & Transitions

To maintain the "Calm Precision" visual tone, avoid hyperactive spring animations. Use the following transition tokens:

* **Tab Switching (Top/Bottom navigation)**:
  * *Interaction*: On Click.
  * *Animation*: Instant.
* **Card Expansion / Claim Ledger detail slide**:
  * *Interaction*: On Click.
  * *Animation*: Smart Animate | `250ms` | Easing: Ease Out (`cubic-bezier(0, 0, 0.2, 1)`).
* **Modal Overlay / dispute sheet (Mobile)**:
  * *Interaction*: On Click (Trigger) / Drag Down (Dismiss).
  * *Animation*: Move In (Bottom to Top) / Slide Out | `300ms` | Easing: Ease Out Quint (`cubic-bezier(0.16, 1, 0.3, 1)`).
  * *Background Backdrop*: `#0A0E1A` at 60% opacity with a background blur style of `8px`.
* **Toast Notification**:
  * *Interaction*: After Delay (100ms) -> Slide In (Right to Left on desktop, Top to Bottom on mobile).
  * *Animation*: Smart Animate | `200ms` | Easing: Decelerate.
  * *Dismissal*: Automatically after `4000ms`.
