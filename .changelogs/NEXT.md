# Unreleased Changes

## Added

- `/do:better-swift`: added an 8th audit agent, **UX Consistency & Responsive Layout**, bringing the SwiftUI pipeline to parity with the UX agent in `/do:better` — adapted for native SwiftUI rather than web. Covers first-launch/first-frame UX (weighted highest, severity bumped one tier for the first screen the user sees), device-size/window-geometry responsiveness (size classes, iPad multitasking/Stage Manager, macOS window resizing), and design-system consistency (`ButtonStyle`/token reuse, loading/empty/error states, feedback and navigation grammar). Unlike `/do:better` it has no `HAS_UI` gate — SwiftUI projects ship a UI by definition, so it always runs. Dynamic Type scaling and accessibility stay with the Platform agent (6) and literal-duplication stays with the DRY agent (3) to avoid duplicate findings. Wires the new `ux` category through plan generation, the file ownership map, parallel remediation, per-category PR creation, and cleanup.

## Changed

## Fixed

## Removed
