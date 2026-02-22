# Release Checklist

Use this checklist before cutting a release from `main`.

## 1. Branch and Scope

- [ ] `main` is up to date and release scope is frozen.
- [ ] No open high-severity bugs or unresolved security concerns.
- [ ] `TODO.md` release-critical items are complete or explicitly deferred.

## 2. Local Verification

- [ ] Run full validation: `./scripts/validate.sh`
- [ ] Confirm E2E suite is green locally (included in validate output).
- [ ] Generate deployment manifest locally and review file list/hashes:
  - [ ] `./scripts/build-deploy-manifest.sh`

## 3. CI Verification

- [ ] `CI` workflow is green on release commit:
  - [ ] Validate (Node 20.x)
  - [ ] Validate (Node 22.x)
  - [ ] Shellcheck
  - [ ] Actionlint
  - [ ] E2E Sync Retry (Playwright)
- [ ] `Artifact Smoke` workflow is green and produced `deploy-manifest` artifact.
- [ ] `Release` workflow behavior confirmed:
  - [ ] PR merge to `main` produced automatic `patch` release bump/tag.
  - [ ] Manual dispatch was used only for `minor`/`major` release increments when needed.

## 4. Security and Privacy

- [ ] Confirm sync payload tests still enforce encrypted-only transport (no plaintext fields).
- [ ] Confirm lock/unlock, history restore, and deleted-note recovery E2E tests pass.
- [ ] Review `SECURITY.md` for any release-impacting updates.

## 5. Accessibility and UX

- [ ] Dialog accessibility tests pass:
  - [ ] focus trap in settings
  - [ ] Escape closes dialogs and restores trigger focus
  - [ ] label associations for key controls
- [ ] Verify theme preference persistence (light/dark toggle).

## 6. Docs and Release Notes

- [ ] `README.md` reflects shipped functionality.
- [ ] `ARCHITECTURE.md` / `SECURITY.md` updated for behavior changes.
- [ ] Draft release notes include user-visible changes and testing highlights.
