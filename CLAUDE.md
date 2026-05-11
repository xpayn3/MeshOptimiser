# STEP Optimizer — project instructions

## Design tokens are the source of truth

The token system lives in `index.html` `:root` (lines ~7–125). **Always use tokens** for new CSS or JS-injected styles; new raw `rgba()`/`#hex`/`Npx` literals require justification.

### Token namespaces

| Concern | Tokens | Example |
|---|---|---|
| Solid surfaces | `--bg`, `--bg1..4`, `--bg-checker`, `--glass-soft/-strong` | `background:var(--bg2)` |
| Borders | `--bd`, `--bd2`, `--hairline` | `border:1px solid var(--bd)` |
| Text | `--tx`, `--tx2`, `--tx3`, `--tx-on-accent` | `color:var(--tx2)` |
| White overlays | `--s1..s5` (.025/.04/.06/.08/.12 alpha) | `background:var(--s2)` |
| Accent | `--ac`, `--ac-hover`, `--ac-active`, `--ac-soft`, `--ac-line`, `--ac-tint-04..55` | `color:var(--ac)` |
| Status | `--ok`, `--wn`, `--er`, `--er-soft/-line`, `--wn-soft/-line` | `color:var(--er)` |
| Type-icon palette | `--icon-asm`, `--icon-part`, `--icon-inst` | for asm/part/inst tree icons |
| Shadows | `--sh`, `--sh-pop`, `--sh-card`, `--sh-thumb`, `--sh-thumb-strong`, `--ring-focus`, `--ring-focus-thick` | `box-shadow:var(--sh-card)` |
| Radius | `--r-2xs..2xl`, `--r-pill` | `border-radius:var(--r-md)` |
| Type size | `--fs-2xs..2xl`; off-grid `--fs-9/-10/-11/-12` | `font-size:var(--fs-sm)` |
| Font weight | `--fw-regular/-medium/-semibold/-bold` | `font-weight:var(--fw-semibold)` |
| Line height | `--lh-flat/-tight/-snug/-base/-relaxed/-loose` | `line-height:var(--lh-base)` |
| Tracking | `--tracking-tight/-snug/-mono/-wide/-wider` | `letter-spacing:var(--tracking-wide)` |
| Font stack | `--font-sans` (only — monospace was retired; use `font-variant-numeric:tabular-nums` for digit alignment) | `font-family:var(--font-sans)` |
| Spacing | `--space-2xs..5xl`; off-grid `--space-3/-5/-7/-9/-11/-18` | `padding:var(--space-md) var(--space-lg)` |
| Motion | `--dur-instant/-fast/-base/-slow/-slower`, `--ease-out/-in-out/-ios/-std` | `transition:opacity var(--dur-fast) var(--ease-out)` |
| Z-index | `--z-base/-sticky/-toolbar/-dropdown/-overlay/-modal/-popover/-toast/-tooltip` | `z-index:var(--z-modal)` |

### Surface palette is intentionally NEUTRAL grey, not blue

Surface tokens (`--bg*`, `--bd*`, `--tx*`, glass fills) are pure grey by design. The accent (`--ac:#6b8dff`) is the only blue. Do **not** introduce blue-tinted dark backgrounds (`#1a1f2a`, `#0f1319`, `rgba(15,19,25,…)` etc.) — they predate the neutral shift and look out of place.

### Off-scale escape hatches

Some tokens exist purely to capture odd values the codebase actually uses (`--fs-11:11px`, `--space-5:5px`, `--space-7:7px`, etc.). They're real tokens — use them. Don't introduce *new* off-scale literals unless visually justified.

### Raw literals are OK when

- A 3D scene / canvas color (skybox `skyGrad(...)`, ctx.fillStyle for canvas-rendered status overlays) — `var(--…)` doesn't resolve in canvas 2D contexts.
- Color picker presets / user-selectable palettes (intentional design decisions).
- Position/size pixel values that aren't part of the design system (e.g. SVG `viewBox`, three.js geometry params, scrollbar widths tied to a specific track size).
- Absolute-positioning offsets (`top/left/right/bottom`) — these are layout-specific, not design-system.

## JS-injected styles use the same tokens

Most JS in `app-v2.js` injects CSS via template literal `<style>` tags. Inside those, `var(--…)` resolves normally — use the tokens. Only canvas 2D and inline `el.style.color = '#xxx'` writes need literal hex; for those, prefer setting a CSS custom property on the element (`el.style.setProperty('--my-color', val)`) and consuming it via a stylesheet rule.

## Sweep gotcha: substring matches

When doing a `replace_all` sweep on token-style values, avoid catching a substring of a longer literal:

- `80ms ` → `var(--dur-instant) ` will *also* catch `180ms `, producing `1var(--dur-instant) `. Always test with `[0-9]var\(--…` regex after a sweep.
- `font-weight:600` is fine (no longer literal exists), but `padding:6px 8px` could substring `padding:16px 8px`. Be aware.
- Token *defs* contain the literal value they replace — running `replace_all` on `rgba(255,255,255,.04)` will self-reference the `--s2` def. Restore token defs after such sweeps.

## Other rules

- **Don't auto-build or auto-deploy.** Only commit raw source. The user runs the build / deploy manually.
- **Don't auto-commit.** Wait for an explicit ask; when asked, commit without further approval.
- **Verify before claiming "X is missing/done".** Grep for the symbol, read the file. Stale impressions are common.
- **Don't delete files** without explicit confirmation.
- **Backup mirror** lives at `W:\AR9\step optimiser` if anything gets corrupted.
