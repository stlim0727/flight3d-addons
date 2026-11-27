# Flight3d Official Addons

Official community addon repository for [Flight3d](https://github.com/stlim0727/flight3d).

Flight3d stays strictly addon-agnostic: all third-party aircraft, regions, and scenarios live here, are validated by automated CI against Flight3d's runtime physics & GLB verifier before merge, and are published to GitHub Pages.

## Live Endpoints

- **Official Catalog (loaded by default in Flight3d)**:
  `https://stlim0727.github.io/flight3d-addons/catalog.json`
- **CI-Verified PR Previews**:
  `https://stlim0727.github.io/flight3d-addons/previews/pr-<NUMBER>.json`

## Using in Flight3d

1. **Merged addons**: Loaded automatically by default (fail-open) and shown in **로비 → 옵션 → 애드온 관리 → 기본 카탈로그**.
2. **Testing an open Pull Request**: Open **애드온 관리**, enter the PR number (e.g. `#42`), and click **PR 불러오기**, or launch directly with `?addonPr=42`. Flight3d checks that the `validate-addons` CI job passed before loading any PR addon.

## Contributing an Addon

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the fork & Pull Request workflow.
