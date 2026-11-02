# Third-party components

TodoGlass source code is provided under the [MIT License](LICENSE).

## Development dependencies

The following packages are used to build, type-check, or test the project. Their npm package source is not included in the repository or the macOS release archive. Run `npm ci` to install the versions recorded in `package-lock.json`; each installed package includes its own license information.

| Package | Use | License | Upstream |
| --- | --- | --- | --- |
| `@types/node` | Node.js type definitions | MIT | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node) |
| `esbuild` | Plugin bundling and test compilation | MIT | [esbuild](https://github.com/evanw/esbuild) |
| `jsdom` | Panel DOM tests | MIT | [jsdom](https://github.com/jsdom/jsdom) |
| `obsidian` | Obsidian API type definitions | MIT | [Obsidian API](https://github.com/obsidianmd/obsidian-api) |
| `typescript` | Type checking | Apache-2.0 | [TypeScript](https://github.com/microsoft/TypeScript) |

Indirect development dependencies and their exact versions are recorded in `package-lock.json`. Their license files are supplied by their respective npm packages.

## Runtime components supplied by the host

The plugin uses the Obsidian API and the Node.js facilities provided by Obsidian. Obsidian itself is a separate product and is not distributed with TodoGlass; the MIT license of the API type definitions does not license the Obsidian application.

The native helper links to macOS system frameworks and the system Swift runtime. AppKit, WebKit, system fonts, and the menu-bar system symbol are supplied by macOS. TodoGlass does not distribute copies of those frameworks, font files, or symbol collections.
