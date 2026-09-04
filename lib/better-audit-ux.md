# UX Consistency & Responsive Layout _(UI projects only — dispatch only when `HAS_UI=true`, otherwise skip)_
   Sources: page/screen entry points (routes, top-level views, landing pages), layout components, global styles, design tokens/theme files, shared component library

   **Above-the-fold UX (highest priority — bump severity one tier when a finding affects initial-viewport content):**
   - Primary content or call-to-action pushed below the fold at common viewports (360×640 mobile, 768×1024 tablet, 1280×800 desktop) by oversized hero media, stacked banners, tall nav bars, or notice pileups (cookie consent + announcement + promo)
   - Layout shift in initial-viewport content: images/embeds/ads without explicit `width`/`height` or `aspect-ratio`, web fonts without `font-display` fallback, late-injected banners that push content down after first paint
   - The likely LCP element lazy-loaded (`loading="lazy"` on the hero image), gated behind client-side hydration, or blocked by a render-blocking resource
   - Critical interactions (search, primary nav, main CTA) requiring scroll or hidden behind disclosure UI on mobile
   - Blank or spinner-only first paint: above-the-fold loading states with no skeleton or reserved dimensions

   **Responsive layout:**
   - Fixed pixel widths/heights on containers that break below ~400px or above ~1440px; missing or incorrect viewport meta tag
   - Horizontal overflow risks: flex rows without wrap fallback, tables, long unbroken strings, absolutely-positioned elements with fixed offsets
   - Breakpoint gaps: components styled for some breakpoints but not the project's full breakpoint scale; one-off media queries that don't match the shared scale
   - `100vh` on mobile (browser chrome eats the viewport) without `dvh`/`svh` fallback
   - Images without responsive `srcset`/`sizes`; raster assets far larger than their rendered size
   - Touch targets under 44×44px; hover-only interactions with no touch equivalent
   - Text truncated where wrapping is expected (`overflow: hidden` + `white-space: nowrap` on variable-length or user-generated content)

   **UX consistency:**
   - One-off spacing/typography/color values where a design-token or theme scale exists (count occurrences per pattern, e.g., "hardcoded hex colors in 14 components")
   - Multiple bespoke implementations of the same UI concept: divergent button styles, duplicate modal/dialog variants, parallel form-field components
   - Inconsistent loading/empty/error state handling across views (some skeletons, some spinners, some nothing)
   - Inconsistent feedback patterns: form validation messaging, toast vs inline errors, disabled vs hidden controls
   - Missing or inconsistent focus/hover/active states across interactive components

   Note: general accessibility (alt text, ARIA, contrast) belongs to the Stack-Specific agent — flag accessibility here only when it is also a layout failure (touch target size, content clipped at zoom or small viewports). Tag this agent's category as `ux` for Phase 2 ownership mapping.
