# Contributing Addons to Flight3d

All official addons are submitted by forking `stlim0727/flight3d-addons` and opening a Pull Request.

## Directory Layout

Place each addon under:

```text
addons/<publisher>/<type>/<name>/
  addon.json
  <assets such as model.glb, cockpit.glb, etc.>
```

- `<type>` must be `aircraft`, `region`, or `scenario`.
- `addon.json` `id` must match `<publisher>/<type>/<name>`.
- Executable scripts (`aircraft.script`, `scenario.script`, `animation.script`, `events[].script`) are forbidden.

## Local Verification Before Opening a PR

Clone `stlim0727/flight3d` alongside your fork and run:

```sh
node /path/to/flight3d/scripts/addon-contract.mjs validate addons/<publisher>/<type>/<name>/addon.json --core 1.8.0
node /path/to/flight3d/scripts/addon-contract.mjs verify-runtime addons/<publisher>/<type>/<name>/addon.json --core 1.8.0 --addon-dir addons/<publisher>/<type>/<name> --require-local-assets
```

`verify-runtime` enforces:
- Strict v1 manifest schema and deep `aircraft.physics` bounds
- Canonical `BODY_CONTACTS` IDs (`nose`, `tail`, `belly`, `wingL`, `wingR`, `engineL`, `engineR`) in `bodySupportPoints`
- Headless simulation (`B738 -> addon` switch, `runway`, `cruise`, `approach`, forced ground contact, water contact, and `airportSpawnPlan` checks)
- Asset SHA-256 integrity, per-asset (25 MB) and total (64 MB) size budgets
- GLB binary parsing, finite vertex/normal checks, triangle budget, and declared control-node presence

## Pull Request & Preview Flow

1. Push your branch to your fork and open a PR against `stlim0727/flight3d-addons:main`.
2. Wait for the `validate-addons` CI check to turn green.
3. Test your PR live in Flight3d via **로비 → 옵션 → 애드온 관리 → PR 번호 (`#<PR>`)** or `?addonPr=<PR>`.
4. Once reviewed and merged, `publish-catalog` automatically rebuilds `catalog.json` on GitHub Pages.
