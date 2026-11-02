# TodoGlass

Keep the **TODO section of today's Obsidian daily note** in a transparent, floating macOS window. Your Markdown note is the source of truth: edits, status changes and new tasks are written back to it.

[中文](README.md) · [Website](https://todoglass-macos.fytmarryzwl.chatgpt.site) · [Download v1.2.0](https://github.com/iPhreetom/obsidian-todoglass/releases/download/v1.2.0/TodoGlass-1.2.0-macOS.zip) · [Releases](https://github.com/iPhreetom/obsidian-todoglass/releases) · [MIT license](LICENSE)

## Install

Requires **macOS 13+** and **Obsidian desktop 1.8.7+**. The native helper is a universal binary containing Apple Silicon and Intel architectures. **Obsidian must stay running.** Node.js and Xcode are only needed for development; normal use does not require Accessibility or Screen Recording permissions.

1. Download **`TodoGlass-1.2.0-macOS.zip`** from the [v1.2.0 release](https://github.com/iPhreetom/obsidian-todoglass/releases/tag/v1.2.0) and extract the entire archive.
2. Run **`安装 TodoGlass.command`** and select your Obsidian vault folder.
3. Enable **TodoGlass** under **Settings → Community plugins**. Reload Obsidian if it does not appear.

For manual installation, copy the complete `todoglass` folder to `<vault>/.obsidian/plugins/`. If you use a different configuration directory, substitute that directory for `.obsidian`. Keep the `macos` subfolder.

TodoGlass is **not yet available through the community plugin marketplace**. Use the complete GitHub Release archive: downloading only `main.js` and `manifest.json` does not install the native window helper.

The native app has an **ad hoc signature**. It is not Developer ID signed or Apple notarized, so macOS may restrict its first launch. You can inspect the source and build it locally; do not disable system-wide security checks to install it.

Disable TodoGlass before updating, then run the new installer. The installer preserves existing `data.json` settings. To uninstall, disable the plugin and remove `plugins/todoglass` from your vault's configuration directory. Tasks already in your notes remain there.

## Use

- Click a checkbox to complete a task or restore it to TODO. Completing a parent does not change its children.
- Double-click task text or use its pencil button to edit. Press **⌘ Enter** to save or **Esc** to cancel.
- Use tree arrows to fold or expand child tasks. Each row has a persistent **＋** button: it opens a child-task draft directly below that parent, before existing children. Live refreshes preserve the draft, focus and selection.
- The **⋯** menu changes status: TODO, in progress, done, deferred or cancelled.
- Use the bottom add button or **⌘ N** for a top-level task.
- Done and cancelled tasks stay visible at the bottom. This is presentation only: it does not reorder Markdown or change parent-child relationships.
- Drag the header to move the window, resize its edges, or collapse the entire window from the header.
- Background opacity defaults to **12%** without blurring windows behind it. Set it to **0%** for a fully transparent background or **100%** for a solid one. Text remains opaque.
- Restore a hidden window from its macOS menu-bar icon or the Obsidian **TodoGlass: 显示今日待办浮窗** command. Obsidian commands support application-local shortcuts.
- Click the path in the footer to open the daily note.

## Daily note format

The plugin reads the folder, date format and template configured in Obsidian's core **Daily notes** plugin. You can override the folder, Moment date format and TODO title in TodoGlass settings.

```markdown
## TODO
- [ ] Write an article
  - [/] Draft an outline
  - [ ] Add examples
- [x] An already completed task

## Journal
Tasks in this section are outside the floating window's scope.
```

Accepted default titles include `TODO`, `【TODO】`, `To-do`, `待办` and `待办事项`. Standalone `【TODO】` or `**【TODO】**` labels also work. Setting a custom title limits matching to that title. An ATX heading section includes its subheadings and ends at the next heading of equal or higher level; a standalone label ends at the next label or heading. Only checklist items are shown. Plain paragraphs and ordinary bullets are not converted into tasks.

Task markers are `[ ]` TODO, `[/]` in progress, `[x]` done, `[-]` cancelled and `[>]` deferred. Other single-character markers are preserved until you choose a new status. Links, task metadata, dates and block IDs are preserved as raw Markdown. For multiline tasks, the window edits the first line and leaves continuation lines in the note.

If today's note is missing, it is created only when you add the first task. Core Daily notes templates support `{{date}}`, `{{date:format}}`, `{{time}}` and `{{time:format}}`; Templater scripts are not executed. The window switches to the new day at midnight without carrying old tasks forward. An old-date draft is kept, but saving it is rejected rather than redirected into the new day.

## Local data and conflicts

The helper polls the plugin approximately every 0.8 seconds. The plugin observes vault and editor changes. Open source-mode editors are changed through an Editor transaction; closed files use `Vault.process`. A task changed elsewhere or an ambiguous match is rejected instead of being overwritten. Actions stay within the selected TODO section.

Runtime communication stays on **`127.0.0.1`**, using a random port and a fresh token for each plugin run. TodoGlass does not upload notes or depend on an external service and works offline. The native helper renders data supplied by Obsidian rather than independently reading vault files. Window position and folding preferences are stored locally. Disabling the plugin or closing Obsidian ends the helper; a sustained connection failure also ends it after approximately 15 seconds. See [SECURITY.md](SECURITY.md) for the trust boundary and reporting guidance.

## Compatibility and validation

- The deployment target is macOS 13+, with arm64 and x86_64 builds. Windows, Linux, iOS and Android do not have a floating-window implementation.
- Manual device testing has used **macOS 26.5 on Apple Silicon**. Intel and macOS 13 have build targets, but have not yet been validated on physical devices.
- The current Automated tests cover Markdown mutation, conflict handling, loopback transport, mocked Obsidian editor workflows and interaction with the real panel HTML under jsdom. These tests do not replace manual verification across Obsidian versions, macOS window behavior, devices or other plugins.
- The scope is today's selected TODO section. There is no vault-wide task search, automatic backlog migration, Templater execution or editing after Obsidian exits.

## Develop

Use **Node.js 24**. Native builds and complete packaging require macOS with Xcode Command Line Tools.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run build:native
npm run package
```

The native script calls `swiftc`, combines arm64 and x86_64 with `lipo` and applies an ad hoc signature. Packaging uses macOS `ditto` and produces `dist/TodoGlass-1.2.0-macOS.zip` and the matching source archive. Ubuntu can run type checking, tests and the JavaScript plugin build, but cannot build or package the native app.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development and release process. Please use fictional notes and remove personal content, paths and tokens from issue reports.

## License

[MIT](LICENSE). Dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). TodoGlass is an independent project and is not affiliated with Obsidian.
