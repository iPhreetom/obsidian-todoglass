# Contributing to TodoGlass

欢迎提交问题、文档改进和 Pull Request。请使用虚构任务构造复现，不要提交真实日记、个人路径、运行令牌或仓库配置文件。

## Development setup

Use Node.js 24 and install the lockfile-pinned dependencies:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The native helper requires macOS 13+ and Xcode Command Line Tools. Build and package it with:

```sh
npm run build:native
npm run package
```

The script invokes `swiftc` for both arm64 and x86_64, combines the binaries with `lipo`, and applies an ad hoc signature. There is no Apple Developer ID certificate or notarization credential in this repository. Complete packaging uses the macOS `ditto` utility.

Copy the complete built plugin folder and native helper into a **disposable test vault**, not a personal vault. Keep `main.js`, `manifest.json` and `macos/TodoGlass.app` together. Disable and re-enable the plugin after changes. Runtime use does not need Node.js.

## Project structure

| Path | Responsibility |
| --- | --- |
| `src/markdown.ts` | TODO section parsing, line-preserving edits and conflict checks |
| `src/main.ts` | Daily-note resolution, editor/vault updates, settings and helper lifecycle |
| `src/bridge.ts` | Authenticated local-only HTTP transport |
| `native/TodoGlass.swift` | AppKit window, WebKit host and plugin connection |
| `native/panel.html` | Task tree, inline drafts and presentation |
| `tests/` | Parser, transport, mocked plugin and jsdom panel coverage |
| `scripts/` | Build, installer and package scripts |

## Changes and validation

- Preserve Markdown as the source of truth. Presentation order must never rewrite task order or hierarchy.
- Apply edits to the live editor when it is open; otherwise use `Vault.process`. Keep snapshot identity, ambiguity detection and midnight guards intact.
- Treat task text as text rather than executable HTML. Keep the bridge bound to loopback, validate its token/Host/Origin, and avoid logging task content or tokens.
- Add regression coverage for changed behavior, especially duplicate lines, external edits, custom statuses, nested tasks, multiline continuations, live drafts and day rollover. Do not add tests that only restate the implementation.
- For window or native changes, manually check text input, copy/paste, resizing, spaces/full-screen applications, opacity and helper shutdown. Automated DOM and mocked Obsidian tests do not establish those behaviors.

Before opening a PR, run `npm run typecheck`, `npm test` and `npm run build`. Run the native build when changing Swift, the app bundle or native interfaces. State your tested macOS/Obsidian versions and CPU architecture; distinguish device checks from compiled targets and mocked tests.

CI runs Node.js 24 checks on Ubuntu and macOS. Only macOS builds the universal helper and verifies its architectures/signature. CI does not launch a real Obsidian instance or prove compatibility across all supported devices.

## Release process

Releases are produced by `.github/workflows/release.yml`. It can run when a `v*` tag is pushed or manually with an existing tag.

1. Update the version consistently in `manifest.json`, `package.json`, `package-lock.json` and `native/Info.plist`. Update versioned README download links and release notes.
2. Run the checks and native build, and verify installation/update in a disposable vault. Confirm both architectures are present; do not describe cross-compilation as an Intel device test.
3. Push the reviewed commit and a matching tag, for example `v1.2.0`. A manual run must select an existing matching tag; it does not create a tag from an arbitrary branch.
4. The release workflow validates the tag and version files before installing dependencies, running checks, building both components and packaging them. The build job has read-only repository permissions. A separate publish job receives only the verified release assets and has `contents: write` permission.
5. It uploads `main.js`, `manifest.json`, the complete macOS ZIP, the source ZIP and `SHA256SUMS.txt` to a draft release, then publishes it after all uploads succeed. A retry resumes an existing draft by replacing only these generated assets; it preserves the title, body and any additional attachments. Replacing a same-named draft asset uses `gh release upload --clobber`, which deletes that old draft asset before uploading its replacement.
6. For an already published release, a retry downloads and verifies the existing asset set and its checksums, then exits without changing remote files or metadata. An incomplete or inconsistent published release fails this check rather than being overwritten; inspect it manually or release a new version.
7. Check the published archive and download links. The standard `main.js`/`manifest.json` assets alone cannot supply the macOS helper, so release notes must direct users to the complete ZIP.

Release publication does not submit the plugin to Obsidian's community directory and does not add Apple notarization. GitHub Actions must be enabled for the repository. Only trusted maintainers should be allowed to push release tags or dispatch the publishing workflow.

## License and reporting

Contributions are provided under the project's [MIT license](LICENSE). Update [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) when adding a dependency that is distributed with the plugin. Use [GitHub issues](https://github.com/iPhreetom/obsidian-todoglass/issues) for ordinary bugs and [SECURITY.md](SECURITY.md) for security reports.
