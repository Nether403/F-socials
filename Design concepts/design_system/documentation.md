# Design System Documentation

This document contains the visual foundations, iconography guidelines, and detailed component specifications for **F-Socials**. Each component includes specifications for typography, dimensions, padding, and all interactive states (Default, Hover, Active, Focus, Disabled, Error).

---

## 1. Visual Foundations

### Grid & Breakpoints
F-Socials uses an **8pt grid system** for spacing, padding, margins, and component sizing. 
* **Mobile (375px+)**: 4 Columns | 16px Gutters | 16px Margins
* **Tablet (768px+)**: 8 Columns | 24px Gutters | 24px Margins
* **Desktop (1280px+)**: 12 Columns | 24px Gutters | 40px Margins
* **Max Width**: 1280px container centered in viewports > 1440px.

### Typography Hierarchy

| Token | Size | Weight | Line Height | Usage |
| :--- | :--- | :--- | :--- | :--- |
| `font-ui` | - | 400, 500, 600 | - | UI Controls, Labels, Inputs, Buttons |
| `font-editorial` | - | 400, 700 | - | Headings, Claim text, Transcripts, Context |
| `text-display` | 1.875rem (30px) | 700 (Bold) | 1.25 (Tight) | Main hero tags, home page headings |
| `text-h1` | 1.5rem (24px) | 700 (Bold) | 1.25 (Tight) | Main report title |
| `text-h2` | 1.25rem (20px) | 600 (Semibold)| 1.375 (Snug) | Major card sections (Claim Ledger) |
| `text-h3` | 1.125rem (18px) | 600 (Semibold)| 1.375 (Snug) | Secondary headings inside drawers |
| `text-body` | 1rem (16px) | 400 (Regular) | 1.5 (Normal) | Body text, transcripts, descriptions |
| `text-small` | 0.875rem (14px) | 400 (Regular) | 1.5 (Normal) | Citations, metadata, input placeholders |
| `text-caption` | 0.75rem (12px) | 500 (Medium) | 1.25 (Tight) | Tags, labels, status indicator badges |

---

## 2. Iconography Guidelines

F-Socials uses clean, line-drawn SVG icons with a uniform stroke width of **1.5px** or **2px**.
* **Preferred Icon Set**: Lucide React.
* **Sizing Rules**:
  * **Standard UI**: 20x20px with 40x40px touch padding.
  * **Utility Header/Action**: 24x24px with 48x48px touch padding.
  * **Status badges**: 14x14px within tags.

### Core Icon Index
* **Analysis**: `Search`, `FileText`, `Terminal`, `Sliders`
* **Evidence Status**:
  * *Mixed Evidence*: `AlertTriangle` (Muted Amber)
  * *Weak Evidence*: `AlertOctagon` (Muted Amber)
  * *Insufficient Evidence*: `HelpCircle` (Slate Gray)
  * *Supported Evidence*: `ShieldCheck` (Muted Teal)
* **Navigation**: `Home`, `Compass`, `Bell`, `User`, `Settings`, `HelpCircle`, `LogOut`
* **Interactions**: `Bookmark`, `Share2`, `Flag`, `MessageSquare`, `ChevronDown`, `ChevronUp`, `ExternalLink`

---

## 3. Core Component Library

### Component 1: Navigation

#### Top Bar (Mobile/Tablet)
* **Specs**: Height: 56px | Padding: Left/Right 16px | Background: `bg-background` | Border: Bottom 1px `border-border`.
* **Left**: Brand logo text (18px font-weight bold, Inter, color: primary text).
* **Right**: Icons for `Search`, `Bell` (24x24px, 8px gap).

#### Bottom Navigation Bar (Mobile)
* **Specs**: Height: 64px | Background: `bg-surface` | Border: Top 1px `border-border`.
* **Actions**: 4 tabs (Home, Discovery, Notifications, Saved). 
* **Active State**: Color `text-accent`, indicator bar (2px height, top of tab item).

#### Fixed Left Sidebar (Desktop)
* **Specs**: Width: 240px | Padding: Top/Bottom 24px, Left/Right 16px | Border: Right 1px `border-border`.
* **Items**: Vertically stacked links with 20px icons and 12px gap.
* **Hover State**: Background `bg-neutral-dark-500` (opacity 10%), text color primary.

---

### Component 2: Buttons

#### Primary Button
* **Specs**: Height: 44px | Padding: Left/Right 24px | Background: `bg-accent` (Dark) or `bg-neutral-dark-500` (Light) | Corners: `rounded-lg` (8px).
* **States**:
  * *Default*: Background `bg-accent` (muted cyan), text `text-brand-primary` (dark).
  * *Hover*: Background color shifts 10% darker, shadow level `raised`.
  * *Active*: Background shifts 15% darker.
  * *Focus*: Outline ring `focus:ring-2 focus:ring-accent`.
  * *Disabled*: Opacity 50%, pointer-events none.

#### Secondary Button (Outline)
* **Specs**: Height: 44px | Border: 1.5px `border-border` | Text: `text-primary`.
* **States**:
  * *Default*: Border `border-border`, transparent background.
  * *Hover*: Background `bg-neutral-dark-500/10`, border `border-text-secondary`.
  * *Focus*: `focus:ring-2 focus:ring-accent`.

#### Ghost Button
* **Specs**: Height: 44px | Text: `text-secondary`.
* **States**:
  * *Default*: Transparent background.
  * *Hover*: Background `bg-neutral-dark-500/10`, text `text-primary`.

#### Floating Action Button (FAB)
* **Specs**: Dimensions: 56x56px circular | Background: `bg-accent` | Shadow: `modal` | Icon: 24px `Plus`.
* **Usage**: Bottom right corner on mobile (16px inset) for "New Analysis".

---

### Component 3: Input Fields

#### URL Paste Input (The Hero Input)
* **Specs**: Height: 56px | Padding: Left 16px, Right 120px | Background: `bg-surface` | Border: 1.5px `border-border` | Corners: `rounded-lg`.
* **States**:
  * *Default*: Border `border-neutral-dark-400`.
  * *Hover*: Border `border-neutral-dark-200`.
  * *Focus*: Border `border-accent`, shadow `overlay`.
  * *Disabled*: Background `bg-neutral-dark-600/50`, text color muted.
  * *Error*: Border `border-semantic-error`, supporting text below.

---

### Component 4: Cards

#### Report Claim Card
* **Specs**: Padding: 20px | Background: `bg-surface` | Border: 1px `border-border` | Corners: `rounded-xl`.
* **Structure**: 
  * Left: Claim Number circle (32x32px, border 1px).
  * Center: Claim content (16px, font-editorial) + Evidence Tag.
  * Right: Expand Chevron or "View Details" button.
* **States**:
  * *Default*: Border `border-border`.
  * *Hover*: Border `border-accent-teal/40`, shadow `raised`.

#### Framing Signal Card
* **Specs**: Padding: 16px | Background: `bg-surface` | Border: 1px `border-border`.
* **Badge**: Muted warning tag (e.g. "Emotional Language" - High).

---

### Component 5: Avatars & Badges

#### Avatars
* **Sizes**: Sm (24x24px) | Md (36x36px) | Lg (48x48px).
* **States**:
  * *Online indicator*: Green dot (6x6px) on bottom right corner.
  * *Expert Badge*: Small shield overlay.

#### Badges & Chips
* **Provenance Chips**: Muted teal background (`bg-semantic-success/15`), text `text-semantic-success` | Content: "AI-generated", "Expert-reviewed".

---

### Component 6: Modals & Sheets

#### Dispute Submission Modal
* **Specs**: Width: Max 480px | Margins: 16px | Padding: 24px | Background: `bg-surface` | Shadow: `modal`.
* **Keyboard Action**: `Escape` closes modal, focus locked to form fields.

#### Evidence Bottom Sheet (Mobile)
* **Specs**: Height: Dynamic (max 85vh) | Swipe down to close | Drag handle (40x4px, centered, top).

---

### Component 7: Feeds & Lists

#### Report Feed List
* **Specs**: Spacing: 12px gap between report preview cards.
* **Divider**: 1px horizontal rule `border-border` between comments.

---

### Component 8: Media Components

#### Interactive Transcript Viewer
* **Specs**: Font: `font-editorial` | Line-height: `relaxed`.
* **States**:
  * *Default*: Standard text.
  * *Highlighted Span (Claim segment)*: Background `bg-semantic-warning/15` | Hover: Background `bg-semantic-warning/30` | Cursor: `cursor-pointer`.

---

### Component 9: Reactions & Interactions

#### Dispute Trigger Control
* **Specs**: Toggle action | Icon: `AlertTriangle` (20x20px).
* **States**:
  * *Default*: Icon `text-muted`.
  * *Active/Selected*: Icon `text-semantic-warning`, border `border-semantic-warning`.

---

### Component 10: Loaders & Skeletons

#### Report Analysis Skeleton Screen
* **Specs**: Replaces the report page during generation.
* **Elements**:
  * Large layout block for Hero Title (shimmer animation).
  * Three horizontal claim card shapes.
  * Sidebar indicators.
* **Shimmer Easing**: `linear` | Duration: `1.5s` repeating.

---

### Component 11: Toasts & Alerts

#### Status Alerts
* **Warning alert**: Muted amber background (10% opacity), amber border (1.5px), amber text. Include `AlertTriangle` icon.

---

### Component 12: Empty States

#### No Reports Found
* **Specs**: Centered alignment | Icon: Muted folder/search (48x48px) | Title: 16px bold | Subtitle: 14px muted | Action: Secondary Button "Clear Filters".
