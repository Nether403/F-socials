# Developer Handoff Guide

This guide bridges the gap between F-Socials design files and frontend development. It details layout annotation standards, Tailwind CSS utility class mappings for our design tokens, and the versioning changelog format.

---

## 1. Layout & Sizing Annotation Standards

To maintain spacing discipline, developers must adhere to the following spacing annotation classes:

### Grid & Component Padding
* **Page Wrapper**:
  * Mobile: `px-4 py-6` (16px horizontal, 24px vertical padding)
  * Desktop: `px-10 py-8` (40px horizontal, 32px vertical padding)
* **Standard Card Container**: `p-6` (24px all sides) on desktop, `p-4` (16px all sides) on mobile.
* **Button/Input Internal Spacing**:
  * Default Buttons: `px-6 py-2.5` (24px horizontal, 10px vertical)
  * Form Input fields: `px-4 py-3` (16px horizontal, 12px vertical)

### Vertical Rhythm (Margins)
* Between sections (e.g., Claim Ledger -> Framing Signals): `space-y-10` (40px margin-top).
* Between cards in a list/feed: `space-y-3` (12px margin-top).
* Between text heading and body: `mt-2` (8px margin-top) or `mt-3` (12px margin-top).

---

## 2. Tailwind CSS Token Mapping Reference

The following table maps our design tokens (from `tokens.json`) to Tailwind configuration utility classes:

### Colors

| Token Path | Dark Mode Class | Light Mode Class | CSS Value |
| :--- | :--- | :--- | :--- |
| `color.brand.primary` | `bg-brand-primary` | - | `#0c101d` |
| `color.brand.secondary` | `bg-brand-secondary` | - | `#181f33` |
| `color.brand.accent` | `text-accent-teal` | `text-accent-teal` | `#00ffe5` |
| `color.semantic.success`| `bg-teal-900/20 text-teal-400`| `bg-teal-100 text-teal-800` | `#0d9488` |
| `color.semantic.warning`| `bg-amber-900/20 text-amber-400`| `bg-amber-100 text-amber-800` | `#d97706` |
| `color.semantic.error`  | `bg-rose-900/20 text-rose-400`| `bg-rose-100 text-rose-800` | `#e11d48` |

### Typography

| Token Path | Tailwind Class | CSS Value |
| :--- | :--- | :--- |
| `fontFamily.ui` | `font-sans` | `Inter, sans-serif` |
| `fontFamily.editorial` | `font-serif` | `IBM Plex Sans, serif` |
| `fontSize.xs` | `text-xs` | `0.75rem (12px)` |
| `fontSize.sm` | `text-sm` | `0.875rem (14px)` |
| `fontSize.base` | `text-base` | `1rem (16px)` |
| `fontSize.lg` | `text-lg` | `1.125rem (18px)` |
| `fontSize.xl` | `text-xl` | `1.25rem (20px)` |
| `fontSize.2xl` | `text-2xl` | `1.5rem (24px)` |
| `fontSize.3xl` | `text-3xl` | `1.875rem (30px)` |

### Spacing & Layout

| Token Spacing | Tailwind Margin/Padding | CSS Value |
| :--- | :--- | :--- |
| `spacing.1` | `m-1` / `p-1` | `4px` |
| `spacing.2` | `m-2` / `p-2` | `8px` |
| `spacing.3` | `m-3` / `p-3` | `12px` |
| `spacing.4` | `m-4` / `p-4` | `16px` |
| `spacing.6` | `m-6` / `p-6` | `24px` |
| `spacing.8` | `m-8` / `p-8` | `32px` |
| `spacing.10` | `m-10` / `p-10` | `40px` |
| `spacing.12` | `m-12` / `p-12` | `48px` |
| `spacing.16` | `m-16` / `p-16` | `64px` |

---

## 3. Developer Handoff Checklist

Before moving a screen layout from design to development, verify that:
- [ ] No hardcoded hex values are used in styling; all colors map to tailwind theme tokens.
- [ ] Responsive states are verified on Chrome emulator at 375px width (no horizontal scrolling).
- [ ] Touch targets for all buttons and tabs are verified to have a minimum clickable area of 44x44px.
- [ ] Color-blind check is completed: No status or indicator relies solely on red/green difference (e.g. claim ledger tags have explicit text label + shape/icon).
- [ ] ARIA tags are added to all toggle elements and icon-only buttons.

---

## 4. Design System Changelog

We use semantic versioning (`MAJOR.MINOR.PATCH`) to track updates to the F-Socials Design System:
* **MAJOR**: Breaking changes (e.g., changing primary typography font, restructuring color tokens).
* **MINOR**: Non-breaking additions (e.g., adding a new component library card type).
* **PATCH**: Bug fixes or small visual alignments (e.g., adjusting padding of an input box).

### Changelog Template
```markdown
# Changelog - F-Socials Design System

All notable changes to this design system will be documented in this file.

## [1.0.0] - 2026-06-26
### Added
- Initial W3C `tokens.json` containing Core Palette, Typography, Spacing, and Elevation.
- 12 Component specifications including Claim Ledger, Navigation, and Modals.
- Visual foundations documentation for Grids, Icons, and Breakpoints.
- User personas, Journey Maps, and Empathy maps.

### Changed
- Refined Semantic colors to avoid bright red/green truth status.
```
