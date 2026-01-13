# AI.md — Web Interface Guidelines (HTML • CSS • JS • Material-inspired)

## Purpose
Instructions for AI coding assistants so the generated UI is consistent, maintainable, and Material-inspired.  
**Do not** change or “re-clean” existing files unless explicitly requested.

---

## Architecture & File Layout
- **Separation of Concerns**
  - No inline CSS or JavaScript in HTML.
  - All CSS in dedicated `.css` files; all JS in dedicated `.js` modules.
- **Suggested structure**
  ```
  /public
    index.html
  /styles
    base.css         # resets, variables, tokens
    layout.css       # grid, containers, responsive helpers
    components/      # button.css, card.css, dialog.css, etc.
    themes/          # light.css, dark.css, high-contrast.css
  /scripts
    config.js        # frontend configuration (API URLs, relative paths)
    main.js          # app bootstrap (tiny)
    router.js        # optional: hash/router
    utils/           # dom.js, format.js, fetch.js, etc.
    components/      # button.js, dialog.js (enhancements only)
  /icons             # PWA icons, favicons
  ```
- **File size rule**: keep each JS file **~800 lines or less**. Split into modules when larger.

---

## Material-Inspired Design System
Follow [Material Design 3](https://m3.material.io) tokens and principles (color, elevation, motion, typography).  
Use CSS variables in `/styles/base.css` to define your design tokens.

- **Spacing & layout:** multiples of **8px**.  
- **Elevation:** use `box-shadow` tokens for hierarchy.  
- **Motion:** subtle transitions with standard easing.  
- **Typography:** consistent scale; minimal font variations.

---

## HTML Guidelines
- Semantic HTML5 (`header`, `nav`, `main`, `section`, `footer`).
- Accessibility first: label controls, `aria-*` where needed, maintain focus states.
- No inline styles/scripts; reference external files only.
- Follow **BEM** or similar naming convention (`card__header`, `card--elevated`).

---

## CSS Guidelines
- **Structure:** `base` → `layout` → `components` → `utilities`.
- Use classes, not IDs. Keep selectors shallow.
- Each component gets its own `.css` (and optional `.js`).
- States: `:hover`, `:focus-visible`, `.is-active`, `.is-disabled`.
- Add dark mode overrides via `[data-theme="dark"]`.

---

## JavaScript Guidelines
- Use ES modules (`type="module"`).
- Keep each file **~800 lines or less**; split large scripts into modules.
- Progressive enhancement: JS adds behavior on top of functional HTML/CSS.
- Avoid unnecessary dependencies; justify new ones in comments.
- Use `/scripts/utils/` for helpers.
- Prefer event delegation and clean DOM queries.

### Path References
- **API URLs**: Always use relative paths (`/api/endpoint`, never `http://...`).
- **Module imports**: Use relative paths (`./utils/helper.js`, `../config.js`).
- **Static assets**: Reference via relative paths (`/icons/favicon.ico`, `/styles/base.css`).
- **Never hardcode**: Avoid `http://localhost` or server-specific URLs in code.
- **Configuration**: Keep URLs in `/scripts/config.js` for easy management.

---

## API & Backend Communication
- **Always use relative URLs** for API endpoints (e.g., `/api/endpoint`).
- **Never hardcode backend URLs** (e.g., `http://localhost:5000`).
- Configuration lives in `/scripts/config.js` with relative paths by default.
- **Benefits of relative URLs:**
  - Works in all environments (local dev, Docker, reverse proxy)
  - No CORS issues (same origin for browser)
  - HTTPS handled automatically by reverse proxy
  - Single codebase for all deployments

### Examples

**✅ GOOD - Relative URL:**
```javascript
// API calls use relative paths
fetch('/api/health')
APIClient.post('/api/llm/transform', data)

// Configuration uses relative path
export const config = {
    BACKEND_URL: '/api'
};
```

**❌ BAD - Hardcoded absolute URL:**
```javascript
// Don't do this!
fetch('http://localhost:5000/api/health')
const API_URL = 'http://localhost:5050/api';
```

### How It Works

```
Browser → /api/health (relative URL)
         ↓
Local Dev: http://localhost:8000/api/health → nginx → backend:5050
Production: https://yourdomain.com/api/health → proxy → container
         ↓
Same code works everywhere!
```

---

## Accessibility
- All interactive elements are keyboard reachable and have visible focus.
- Maintain sufficient color contrast (WCAG AA+).
- Manage focus for dialogs/menus; return focus to opener on close.

---

## Performance & Quality
- Load minimal JS; defer non-critical scripts.
- Minify in production; keep source maps for debugging.
- Configure ESLint, Stylelint, and Prettier for consistency.

---

## Theming
- Light/Dark via `data-theme` on `html` or `body`.
- Respect `prefers-color-scheme` where possible.

---

## Security & Secrets
- Never embed secrets or tokens in HTML/JS.
- Use environment variables or server-side config injection.
- Sanitize all dynamic HTML content.

---

## Design Reference Sources
When generating UI or styling decisions, take visual and structural cues from:

- [Material Design 3](https://m3.material.io) — official color, elevation, motion system.
- [Materialize CSS](https://materializecss.com) — clean HTML/CSS patterns.
- [MUI](https://mui.com/material-ui) — layout proportions and modern Material components.
- [HTML5UP](https://html5up.net) — semantic responsive HTML structure.
- [Material Tailwind](https://www.material-tailwind.com/) — modern spacing and typography ideas.

Use these sources **for inspiration only**, not for direct code import.
Maintain our internal rules: **no inline CSS/JS** and keep JS files **~800 lines**.

---

## Summary
- **Material-inspired**: tokens, 8px spacing, elevation, subtle motion.
- **Strict separation**: HTML • CSS • JS (no inline).
- **Small modules**: JS files ~800 lines max.
- **Accessible**: focus states, contrast, keyboard support.
- **Relative paths**: Use `/api` for APIs, relative imports for modules, never hardcode URLs.
- **Reverse proxy ready**: Code works in all environments without configuration changes.
- **Respect existing cleaned files**: no unsolicited refactors.
