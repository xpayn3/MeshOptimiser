# Design system audit — 2026-10-17

Scope: the app's inline stylesheet (`app/index.html`, four `<style>` blocks, 5,839 lines), the Appearance override layer
(`app/js/appearance.js`), the markup and the styles `app/js/app.js` injects, and the site's `site/site.css` (1,823 lines).
Everything below was counted with grep over the files as they are in the working tree today; nothing was checked in a browser.

## Summary

**Components reviewed:** 12 | **Issues found:** 14 | **Score (app):** 74/100 | **Score (site):** 58/100

The app has a real token system: one `:root` block with commented tokens, four themes (tone, accent, type, density and corners)
applied by `appearance.js`, and 7,445 `var()` references. Spacing, type, radii and motion are tokenised almost everywhere. The
gaps are in the features added since the token pass (shortcuts window, library dock, animation dock, splash, command-card art),
which carry literal greys that the Midnight, Warm and Black tones cannot reach, and in two parallel naming schemes (numeric and
t-shirt) for the same scales. The site has 27 tokens and no scale at all for type, radius or motion.

## Naming consistency

| Issue | Where | Recommendation |
|---|---|---|
| Two names for every scale step: `--fs-11` and `--fs-xs`, `--space-3` and `--space-xs`, `--dur-150` and `--dur-base`, `--op-4` and `--op-40` | `:root`, lines 11–140 and 1994–2030 of the stylesheet | Keep the t-shirt names, alias the numeric ones to them in one place, and stop adding numeric ones. |
| Tokens with the same value under different names: `--fs-md` = `--fs-lg` = 13px; `--r-sm` = `--r-md`, `--r-lg` = `--r-xl`; `--btn-r-sm/md/lg` all 9.6px; `--s1` = `--s2` = `--s3`, `--s4` = `--s5` | `:root`, line 2739 | Decide whether the steps are meant to differ. If not, collapse them; if yes, give them different values. |
| Weight names off by one step: `--fw-medium` is 400 (same as `--fw-regular`), `--fw-semibold` is 500, `--fw-bold` is 600 | `:root` | Rename to what the number is (`--fw-regular:400; --fw-medium:500; --fw-semibold:600`) in one scripted pass. |
| The site and the app use different names for the same idea: `--accent` / `--ac`, `--surface` / `--surface-pop`, `--tx-2` / `--tx2`, `--line` / `--bd`, `--mono` / `--font-mono` | `site/site.css` vs `app/index.html` | Pick the app's names for the site when it is next touched. This clash is the cause of the bug below. |
| Site names leaked into the app: the `cmd-art` style block uses `--accent`, `--surface`, `--tx-3` and `--mono`, none of which the app defines | `app/index.html`, `<style id="cmd-art">` (`.tile-art .art-hot`, `.art-t`, `.art-solid`, `.art-fnd`, keyframes `art-core`, `art-lockc`) | Replace with `--ac-text`, `--surface-pop`, `--tx3`, `--font-mono`. Logged in `UNRELEASED_FIXES.md`. |
| Two other tokens used but never defined, without a fallback: `--space-2` (`#welcome-load-pane .ld-step`), `--fw-normal` (`.prop-lock-note`) | stylesheet lines 3519, 4529 | `--space-xs`, `--fw-regular`. Logged. |
| Tokens redefined later in the file so the second value wins silently: `--surface-line`, `--tx-control-hover` | lines 11 and 2740 | Keep one definition per token in the first `:root`. |
| Defined and never used: `--ac-tint-04`, `--er-soft-strong`, `--fade-l`, `--fade-r`, `--win-bar-btn`, `--win-bar-btn-r` | `:root` | Delete. |
| Fifteen button class families (`.btn`, `.btn-sm`, `.tbtn`, `.vpb`, `.sc-btn`, `.dlg-btn`, `.cq-btn`, `.brand-btn`, `.tree-icon-btn`, `.lc-icon-btn`, `.mat-act`, `.adk-addb`, `.anim-pill-btn`, `.prim-axis-btn`, `.lib-view-btn`) | stylesheet | `.btn/.tbtn/.btn-sm` share the `--btn-*` size tokens; `.sc-btn`, `.dlg-btn`, `.cq-btn` and `.adk-addb` re-implement primary and danger with their own colours. Fold the four into `.btn` variants. |

## Token coverage (app)

| Category | Defined | Via token | Hardcoded |
|---|---|---|---|
| Colours (before the fix) | 5-step grey ramp, 3 text levels, accent + 12 tints, 4 status colours with tints, 7 surface tokens, `--wht-*` / `--blk-*` alphas; four tones and any accent from `appearance.js` | — | 140 hex on 77 lines (26 are `#fff`), 48 `rgba()`. 105 hex in `app.js`, mostly three.js and canvas, 4 `.mi2-dot` and 4 `.qr` ones are UI. |
| Spacing | `--space-2xs…5xl` (plus numeric 3, 5, 7), `--ctl-px`, `--btn-px-*`, `--chip-*` | 1,248 | 178 px literals in padding/gap/margin, 47 of them `1px`. |
| Typography | `--fs-9…13`, `--fs-2xs…5xl`, `--fw-*`, `--lh-*`, `--tracking-*`, `--font-sans` | 584 | 12 font-size literals (splash and About); `'Fraunces'` named 10 times with no token. |
| Radius | `--r-3xs…3xl`, `--r-pill`, `--btn-r-*`, `--surface-pop-r`, `--surface-win-r` | 398 | ~35 px literals plus 45 `50%` (circles, fine). |
| Shadows | `--sh`, `--sh-pop`, `--sh-card`, `--sh-thumb`, `--surface-shadow*`, `--ring-*` | — | 55 literal `box-shadow` values. |
| Motion | `--dur-instant/fast/base/slow` (and six numeric), `--ease-out/std/ios/pop/spring`, nine `--tr-*` presets, `--menu-in` | 183 | ~17 literal durations (.2s–.9s), splash and loader. |
| Layers | `--z-tooltip…--z-view-layer` (11 tokens) | 27 | ~62 literal `z-index`, including 99999, 9500, 900, 100, 80, 60; `app.js` adds 9000, 400, 300. |

Where the colour literals sit, and why it matters: `appearance.js` swaps `--bg…--bg4`, `--bd`, `--bd2`, `--surface-pop`,
`--surface-bar` and `--glass-strong` for the Midnight, Warm and Black tones. Every literal grey below stays graphite in those tones:

- shortcuts window keys: `#222224`, `#2a2a2d`, `#3a3a3e`, `#444448` (`.sc-key`)
- library items and inspector: `#1d1d1f` (`.lib-item`, `.li-view`)
- material dock and animation dock: `#1a1a1a`, `#1b1b1b`, `#171717`, `#1d1d1d` (`.mat-dock`, `.adk-scroll`, `.adk-ruler`, `.adk-rh`)
- splash: `#19191a`, `#101010`, `#a3a3a8`, `#6e6e72`, `#e6e6e8` (`.sp-card`, `.sp-art`, `.sp-info`, `.sp-word`)
- animation footer buttons: `#1f1f1f` as the mix base of disabled primary and danger (`.cq-btn`)
- animation clip colours (`#5aa2ff`, `#b49aff`, `#44d4a0`, `#f08cc0`, `#f5b95a`): a palette with no token, so it will not follow a custom accent

Not checked: whether any of this is visible in a given tone (the audit is from the stylesheet only).

## Token coverage (site)

| Category | Defined | Hardcoded |
|---|---|---|
| Colours | 27 tokens (surfaces, three text levels, accent, six function colours, six tag colours) | 285 hex (149 `#fff`, 58 `#77777c` in the tile art), 70 `rgba()`; `.btn:hover` is `#28282b`. |
| Spacing | `--gutter`, `--max`, `--bar-h`, `--band` | everything else literal (no scale). |
| Typography | `--font`, `--mono`, `--serif` (defined at line 1789, in a second `:root` at the end), `--head-size` | 20 distinct font-size literals (9px to 30px); no scale. |
| Radius | `--r` 18px, `--r-s` 10px | 999px ×28, 50% ×15, 2/3/4/6/8/12/14px. |
| Motion | none | 26 distinct durations from 0.05s to 1.6s. |

The site is dark only and has no user themes, so literals cost less there than in the app. The missing type and motion scales are
the gap worth closing.

## Component completeness (app)

| Component | Where | States | Variants | Tokens | Docs | Score |
|---|---|---|---|---|---|---|
| Button | `.btn`, `.tbtn`, `.btn-sm` (`--btn-h/px/fs/r-sm/md/lg`) | hover, active, focus-visible, disabled, `.is-busy` | primary, danger, warn, icon-only, sm/md/lg | yes | `:root` comment only | 8/10 |
| Text / number field | one `:is()` rule, `--ctl-*`, `--fld-*`, `--num-*` | hover, focus (border + ring), invalid (`.bad`, `.invalid`) | dense (`--ctl-h-sm`), search (`--bd-search-focus`) | yes | comment | 8/10 |
| Dropdown | `.cs-trigger` / `.cs-pop`, `--dd-*` | hover, focus-visible, open | size by tokens | yes | comment ("set the tokens, do not restyle") | 8/10 |
| Context menu | `#ctx-menu`, `--ctx-*` | hover, submenu | — | yes | comment | 7/10 |
| Slider | `input[type=range]`, `--sl-*` | hover grow, active, focus-visible | — | yes | comment | 8/10 |
| Switch | `.toggle .switch` | checked, hover | — | partly | none | 6/10 |
| Segmented control | `.cmd-seg` (`:has()` moving pill, 2–5 items) | active, hover, focus-visible | `.cmd-seg-sm` | yes | none | 7/10 |
| Toast | `.toast` on `--surface-pop` | — | error, success, warn, `.is-run` (progress) | yes | none | 6/10 |
| Tooltip | `.tip-pop` (role=status), plus 523 native `title=` attributes | show, wrap, bar | — | yes | none | 5/10 |
| Dialog / window | `.modal`, `.dlg-*`, `--surface-win-*` | focus trap and `inert` (app.js), `aria-modal` ×3 | small surface vs window | yes | comment under "Floating surfaces" | 8/10 |
| Tree row | `.tree-node` | hover, selected, flagged, locked, spline, group | type icons `--icon-*`, colour-coded option | mostly; `#8fc2ff`, `#c4c4c6`, `#d8c5ff` literal | none | 6/10 |
| Kbd | `.kbd`, `.kbd-chip`, `.sc-key` | held, has, inert | shortcuts-window keys | `.sc-key` literal greys | none | 5/10 |

State coverage across the stylesheet: 358 `:hover`, 98 `:focus-visible` (global rules at lines 246–247 and 2078–2081 give every
button, link, field and range a ring), 32 `:active`, 49 `:disabled`, 10 loading. Reduced motion is honoured (48 rules plus the
`html.no-motion` class). Nothing answers `forced-colors` or `prefers-contrast`. 53 `outline:none` declarations, all on `:focus` or
the base rule, with the ring carried by `box-shadow` or a border change instead, so none was found that removes focus entirely.

Accessibility in the markup: 94 `role`, 149 `aria-label`, 109 `aria-labelledby`, 14 `aria-pressed`, 4 `aria-live`; `app.js` adds
111 `aria-label`, 32 `aria-expanded`, 10 `aria-checked`, 3 `aria-modal`, `inert` on the page behind a dialog. No `aria-describedby`
anywhere: the 523 `title` tooltips are not announced as descriptions.

Documentation: the `:root` block comments every token family, and the README has one line ("Design-token system"). There is no
component reference. `CLAUDE.md` names the families to use. `tests/appearance.test.cjs` covers the override layer; nothing tests
that the stylesheet stays free of literals.

## Priority actions

Actions 1 and 2 were done the same day (see `UNRELEASED_FIXES.md`): the undefined tokens are replaced, `--font-mono` is new, and the literal greys in the shortcuts window, library, docks, splash and animation footer now use the surface tokens. The guard test of action 2 exists (`tests/stylesheet-literals.test.cjs`) and also reads the styles the scripts inject; action 4 is done the same way, every layer named in `:root` with its number kept. Not checked in a browser.

1. **Fix the undefined tokens** (`cmd-art` block, `--space-2`, `--fw-normal`): a scripted find-and-replace, bump `?v=`, and a
   look at a command card. These are rendering bugs today, not debt.
2. **Make the four tones reach every surface**: replace the literal greys in `.sc-key`, `.lib-item`, `.mat-dock`, `.adk-*`,
   `.sp-*` and `.cq-btn` with `--bg2…--bg4` / `--surface-pop` / `--tx2` / `--tx3`, and give the animation clip colours tokens.
   Then add a test that greps the stylesheet for hex outside `:root` and fails above today's count, so the number only goes down.
3. **One name per step**: alias the numeric scale names to the t-shirt ones and fix the weight names, in one pass with a script.
   Collapse the same-value radii and `--s1…--s7` or give them distinct values.
4. **Layers**: move the ~62 literal `z-index` values onto the `--z-*` tokens, starting with the ones above 100.
5. **Site**: give `site.css` a type scale (`--fs-*`), a motion pair (`--dur`, `--ease`) and the app's token names, and tokenise
   `#77777c` and the `.btn:hover` grey. Do it with the next site change, not on its own.
6. **Document the components** as a short page in the app's own docs (button, field, dropdown, menu, slider, switch, segment,
   toast, tooltip, window): the variants, the states and which tokens to set. Most of the text already exists as `:root` comments.
