# Security policy

## Reporting a vulnerability

Please use the repository's [Security page](https://github.com/iPhreetom/obsidian-todoglass/security) and **Report a vulnerability** when private reporting is enabled. If that option is unavailable, open an issue requesting a private reporting channel without including exploit details or personal data. No response-time commitment is currently offered.

Include the TodoGlass, Obsidian and macOS versions, CPU architecture, a minimal reproduction using fictional notes, and the expected impact. Do not send complete vaults, personal journal entries, absolute personal paths or the local bridge token. Ordinary usability bugs belong in [Issues](https://github.com/iPhreetom/obsidian-todoglass/issues).

## Supported releases

Security fixes target the latest stable release. Older releases may require an upgrade rather than receiving a separate backport.

## Data flow and trust boundary

- The Obsidian plugin reads and modifies today's configured daily note. It has the permissions of an installed Obsidian community plugin; it is not an operating-system sandbox around the vault.
- The native helper receives note/task data over an HTTP server bound to `127.0.0.1` on a random port. Requests require a fresh per-run bearer token and the expected Host; requests carrying an Origin header are rejected. There is no external sync service or telemetry endpoint in the application.
- The helper loads its bundled panel rather than a remote web page. Task text is rendered as text. Normal runtime does not require a cloud account or internet access.
- Markdown task text remains in the original note. Plugin settings, window placement and hashed UI folding preferences are stored locally. Draft text is held in the running interface and is not a durable backup.
- Conflict checks are intended to avoid overwriting changed or ambiguous tasks. They do not replace vault backups or provide a general merge system for every third-party plugin or external synchronization tool.
- The loopback token is not intended to protect against a program or plugin that already controls the same user account, can inspect processes or can directly read the vault.

## Distribution

The native helper uses an **ad hoc code signature**, not an Apple Developer ID signature, and is **not Apple notarized**. The universal build targets macOS 13+ on Apple Silicon and Intel, while physical device verification has so far used macOS 26.5 on Apple Silicon. Do not infer tested Intel/macOS 13 compatibility from successful cross-compilation.

Get complete installation archives from the [project releases](https://github.com/iPhreetom/obsidian-todoglass/releases), or build from the reviewed source. Published checksums detect accidental differences; they do not provide an independent trust channel if both a release and its checksums are compromised. Development dependency installation and GitHub CI use public network services, separate from offline application runtime.
