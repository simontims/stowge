# UI Conventions

This document defines UI styling conventions for Stowge frontend work in `ui/`.

## Action Color Semantics

Use semantic action colors consistently:

- Create/Add actions: green (`positive`)
- Save/Confirm actions: green (`positive`)
- Secondary actions (cancel/back/non-destructive): neutral/ghost (`neutral`)
- Destructive actions (delete/discard): red (`danger` or `danger-hover`)
- Blue: identity only (brand/nav), not default CTA color

Approved blue action exceptions:

- Authentication submit actions (`Sign In`, `Create Account`)
- AI-specific action triggers (`Identify`, `Scan with AI`)

## Button Styling Source Of Truth

Centralize action button color classes in:

- `src/components/ui/buttonStyles.ts`

Use helpers from that file instead of hardcoding new `bg-blue-*`, `bg-emerald-*`, or `bg-red-*` button class strings in pages/components.

## Usage

Solid action buttons:

```tsx
import { solidActionButtonClasses } from "../components/ui/buttonStyles";

<button className={`${solidActionButtonClasses("positive")} px-3 py-1.5`}>Add Item</button>
<button className={`${solidActionButtonClasses("brand")} px-3 py-1.5`}>Identify</button>
```

Outlined action buttons:

```tsx
import { outlinedActionButtonClasses } from "./buttonStyles";

<button className={`${outlinedActionButtonClasses("neutral")} gap-1 px-2.5 py-1.5`}>Cancel</button>
<button className={`${outlinedActionButtonClasses("positive")} gap-1 px-2.5 py-1.5`}>Save</button>
<button className={`${outlinedActionButtonClasses("danger")} gap-1 px-2.5 py-1.5`}>Discard</button>
```

## Review Checklist

When reviewing UI changes:

1. Create/Add/Save/Confirm controls are green unless explicitly excepted.
2. Secondary controls remain neutral/ghost.
3. Destructive controls are red.
4. New blue buttons are only introduced for approved exceptions.
5. Shared helpers are used instead of hardcoded action color classes.
