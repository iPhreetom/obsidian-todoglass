import AppKit
import Foundation
import WebKit

// The helper only renders data from the plugin's authenticated loopback bridge.
// Markdown reads and writes always remain in Obsidian.
final class TodoPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if modifiers.contains(.command), !modifiers.contains(.option), !modifiers.contains(.control) {
            let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
            let actions = ["a": "selectAll:", "c": "copy:", "x": "cut:", "v": "paste:", "z": modifiers.contains(.shift) ? "redo:" : "undo:"]
            if let action = actions[key], NSApp.sendAction(Selector(action), to: nil, from: self) { return true }
        }
        return super.performKeyEquivalent(with: event)
    }
}

final class TransparentWebView: WKWebView {
    override var isOpaque: Bool { false }
}

final class TodoGlassApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private var panel: TodoPanel!
    private var webView: WKWebView!
    private var statusItem: NSStatusItem?
    private var session: URLSession!
    private var timer: Timer?
    private var eventMonitor: Any?
    private var observers: [NSObjectProtocol] = []
    private var baseURL: URL!
    private var uiURL: URL!
    private var token = ""
    private var frameKey = "TodoGlass.frame.default"
    private var cachedState: [String: Any]?
    private var pageReady = false
    private var fetching = false
    private var failedRequests = 0
    private var firstFailure: Date?
    private var lastCommandSequence: String?
    private var collapsed = false
    private var expandedHeight: CGFloat = 560
    private var dragAnchor: NSPoint?
    private var dragOrigin: NSPoint?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let environment = ProcessInfo.processInfo.environment
        guard let portString = environment["TODOGLASS_PORT"],
              let port = Int(portString), (1...65535).contains(port),
              let authToken = environment["TODOGLASS_TOKEN"], !authToken.isEmpty else {
            fputs("TodoGlass: launch from the Obsidian plugin.\n", stderr)
            NSApp.terminate(nil)
            return
        }
        token = authToken
        baseURL = URL(string: "http://127.0.0.1:\(port)")!
        let bundledUI = Bundle.main.resourceURL?.appendingPathComponent("panel.html")
        let path = environment["TODOGLASS_UI_PATH"] ?? bundledUI?.path ?? ""
        uiURL = URL(fileURLWithPath: path).standardizedFileURL
        guard FileManager.default.fileExists(atPath: uiURL.path) else {
            fputs("TodoGlass: missing panel.html.\n", stderr)
            NSApp.terminate(nil)
            return
        }
        // The plugin supplies a hash, never a vault path, for per-vault positioning.
        let instance = environment["TODOGLASS_INSTANCE"] ?? "default"
        frameKey = "TodoGlass.frame.\(instance)"

        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 3
        config.timeoutIntervalForResource = 5
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpShouldSetCookies = false
        config.connectionProxyDictionary = [:]
        session = URLSession(configuration: config)

        createEditingMenu()
        createPanel()
        createStatusMenu()
        watchPluginLifecycle()
        pollState()
        timer = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { [weak self] _ in
            self?.pollState()
        }
        RunLoop.main.add(timer!, forMode: .common)
    }

    private func createPanel() {
        let defaults = UserDefaults.standard
        collapsed = defaults.bool(forKey: frameKey + ".collapsed")
        let savedHeight = defaults.double(forKey: frameKey + ".expandedHeight")
        if savedHeight >= 240 { expandedHeight = CGFloat(savedHeight) }
        let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        var frame = NSRect(x: visible.maxX - 394, y: visible.maxY - 584, width: 370, height: 560)
        if let saved = defaults.string(forKey: frameKey) {
            let restored = NSRectFromString(saved)
            if restored.width >= 300, restored.height >= 62 { frame = restored }
        }
        if collapsed { frame.size.height = 62 }
        frame = clampedFrame(frame)
        panel = TodoPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel, .resizable], backing: .buffered, defer: false)
        panel.title = "TodoGlass · 今日待办"
        panel.backgroundColor = .clear
        panel.isOpaque = false
        // A window-wide shadow would still dim the desktop when the page's
        // background opacity is zero. Let only the HTML draw visible pixels.
        panel.hasShadow = false
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.isMovableByWindowBackground = false
        panel.acceptsMouseMovedEvents = true
        panel.isReleasedWhenClosed = false
        panel.minSize = NSSize(width: 320, height: collapsed ? 62 : 240)
        panel.maxSize = NSSize(width: 720, height: collapsed ? 62 : 1200)

        let content = WKUserContentController()
        content.add(self, name: "todoglass")
        let config = WKWebViewConfiguration()
        config.userContentController = content
        // Only hashed UI fold keys are stored by panel.html; no task text is persisted.
        config.websiteDataStore = .default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        webView = TransparentWebView(frame: NSRect(origin: .zero, size: frame.size), configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        // WKWebView's default under-page color follows the document color scheme
        // and can otherwise supply an opaque light/dark canvas behind clear CSS.
        webView.underPageBackgroundColor = .clear
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.wantsLayer = true
        webView.layer?.isOpaque = false
        webView.layer?.backgroundColor = NSColor.clear.cgColor
        webView.layer?.cornerRadius = 20
        webView.layer?.masksToBounds = true
        panel.contentView = webView
        webView.loadFileURL(uiURL, allowingReadAccessTo: uiURL.deletingLastPathComponent())
        panel.orderFrontRegardless()

        for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: panel, queue: .main) { [weak self] _ in
                self?.saveFrame()
            })
        }
        eventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged, .leftMouseUp]) { [weak self] event in
            guard let self else { return event }
            if event.type == .leftMouseUp {
                self.dragAnchor = nil
                self.dragOrigin = nil
                return event
            }
            guard let anchor = self.dragAnchor, let origin = self.dragOrigin else { return event }
            let location = NSEvent.mouseLocation
            self.panel.setFrameOrigin(NSPoint(x: origin.x + location.x - anchor.x, y: origin.y + location.y - anchor.y))
            return nil
        }
    }

    private func createEditingMenu() {
        // AppKit resolves standard editing shortcuts through the menu responder
        // chain, even for an accessory app whose menu bar is not displayed.
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "TodoGlass")
        let quit = NSMenuItem(title: "退出 TodoGlass", action: #selector(quitHelper), keyEquivalent: "q")
        quit.target = self
        appMenu.addItem(quit)
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        let entries = [("撤销", "undo:", "z"), ("重做", "redo:", "Z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")]
        for (title, selector, key) in entries {
            if selector == "cut:" { editMenu.addItem(.separator()) }
            editMenu.addItem(NSMenuItem(title: title, action: Selector(selector), keyEquivalent: key))
        }
        editItem.submenu = editMenu
        menu.addItem(editItem)
        NSApp.mainMenu = menu
    }

    private func createStatusMenu() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(systemSymbolName: "checkmark.circle", accessibilityDescription: "TodoGlass 今日待办")
        item.button?.toolTip = "TodoGlass · 今日待办"
        let menu = NSMenu()
        let entries: [(String, Selector)] = [
            ("显示浮窗", #selector(showPanel)),
            ("隐藏浮窗", #selector(hidePanel)),
            ("打开今日日记", #selector(openNote)),
            ("插件设置", #selector(openSettings))
        ]
        for (title, selector) in entries {
            let menuItem = NSMenuItem(title: title, action: selector, keyEquivalent: "")
            menuItem.target = self
            menu.addItem(menuItem)
        }
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "退出浮窗", action: #selector(quitHelper), keyEquivalent: "")
        quit.target = self
        menu.addItem(quit)
        item.menu = menu
        statusItem = item
    }

    @objc private func showPanel() {
        panel.setFrame(clampedFrame(panel.frame), display: true)
        panel.orderFrontRegardless()
    }

    @objc private func hidePanel() { panel.orderOut(nil) }
    @objc private func openNote() { postAction(["type": "openNote"], requestID: nil) }
    @objc private func openSettings() { postAction(["type": "settings"], requestID: nil) }
    @objc private func quitHelper() { NSApp.terminate(nil) }

    private func clampedFrame(_ original: NSRect) -> NSRect {
        let screens = NSScreen.screens.map(\.visibleFrame)
        let containing = screens.max { a, b in
            let intersectionA = a.intersection(original)
            let intersectionB = b.intersection(original)
            return intersectionA.width * intersectionA.height < intersectionB.width * intersectionB.height
        }
        guard let screen = containing ?? NSScreen.main?.visibleFrame else { return original }
        var frame = original
        frame.size.width = min(max(frame.width, 320), screen.width)
        frame.size.height = min(max(frame.height, 62), screen.height)
        frame.origin.x = max(screen.minX, min(frame.minX, screen.maxX - frame.width))
        frame.origin.y = max(screen.minY, min(frame.minY, screen.maxY - frame.height))
        return frame
    }

    private func saveFrame() {
        guard panel != nil else { return }
        UserDefaults.standard.set(NSStringFromRect(panel.frame), forKey: frameKey)
        UserDefaults.standard.set(collapsed, forKey: frameKey + ".collapsed")
        if !collapsed { expandedHeight = panel.frame.height }
        UserDefaults.standard.set(Double(expandedHeight), forKey: frameKey + ".expandedHeight")
    }

    private func setCollapsed(_ value: Bool) {
        guard value != collapsed else { return }
        if value { expandedHeight = panel.frame.height }
        collapsed = value
        let height: CGFloat = collapsed ? 62 : max(240, expandedHeight)
        var frame = panel.frame
        frame.origin.y += frame.height - height
        frame.size.height = height
        panel.minSize = NSSize(width: 320, height: collapsed ? 62 : 240)
        panel.maxSize = NSSize(width: 720, height: collapsed ? 62 : 1200)
        panel.setFrame(clampedFrame(frame), display: true, animate: false)
        saveFrame()
    }

    private func watchPluginLifecycle() {
        // Obsidian keeps this pipe open. EOF also handles force-quit and crashes.
        FileHandle.standardInput.readabilityHandler = { handle in
            if handle.availableData.isEmpty {
                handle.readabilityHandler = nil
                DispatchQueue.main.async { NSApp.terminate(nil) }
            }
        }
    }

    private func request(path: String, method: String = "GET", body: [String: Any]? = nil) -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return request
    }

    private func pollState() {
        guard !fetching else { return }
        fetching = true
        session.dataTask(with: request(path: "state")) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.fetching = false
                guard error == nil,
                      let response = response as? HTTPURLResponse, response.statusCode == 200,
                      let data, let state = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                    self.stateFailed()
                    return
                }
                self.failedRequests = 0
                self.firstFailure = nil
                self.cachedState = state
                self.applyPreferences(state["preferences"] as? [String: Any])
                self.applyCommand(state["command"] as? [String: Any])
                self.deliverState()
            }
        }.resume()
    }

    private func stateFailed() {
        failedRequests += 1
        if firstFailure == nil { firstFailure = Date() }
        if failedRequests >= 3 {
            var state = cachedState ?? ["tasks": [], "date": "", "label": "今日待办", "exists": false]
            state["connected"] = false
            state["error"] = "Obsidian 已断开，正在重连…"
            sendJavaScript(method: "receive", object: state)
        }
        if let firstFailure, Date().timeIntervalSince(firstFailure) >= 15 { NSApp.terminate(nil) }
    }

    private func applyPreferences(_ preferences: [String: Any]?) {
        guard let preferences else { return }
        let onTop = preferences["alwaysOnTop"] as? Bool ?? true
        panel.isFloatingPanel = onTop
        panel.level = onTop ? .floating : .normal
        switch preferences["theme"] as? String {
        case "dark": panel.appearance = NSAppearance(named: .darkAqua)
        case "light": panel.appearance = NSAppearance(named: .aqua)
        default: panel.appearance = nil
        }
    }

    private func applyCommand(_ command: [String: Any]?) {
        guard let command, let sequence = command["seq"] else { return }
        let key = String(describing: sequence)
        guard key != lastCommandSequence else { return }
        lastCommandSequence = key
        switch command["type"] as? String {
        case "show": showPanel()
        case "hide": hidePanel()
        case "toggle": panel.isVisible ? hidePanel() : showPanel()
        default: break
        }
    }

    private func deliverState() {
        guard var state = cachedState else { return }
        state["collapsed"] = collapsed
        sendJavaScript(method: "receive", object: state)
    }

    private func postAction(_ action: [String: Any], requestID: String?) {
        // Body is exactly the action object; requestId is only used in the UI.
        session.dataTask(with: request(path: "action", method: "POST", body: action)) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                var result = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any] ?? [:]
                let successfulHTTP = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
                let ok = error == nil && successfulHTTP && (result["ok"] as? Bool ?? true)
                result["ok"] = ok
                if !ok, result["error"] == nil { result["error"] = "未能写回日记，请检查 Obsidian 是否运行。" }
                if let requestID {
                    result["requestId"] = requestID
                    self.sendJavaScript(method: "result", object: result)
                }
                if let state = result["state"] as? [String: Any] {
                    self.cachedState = state
                    self.applyPreferences(state["preferences"] as? [String: Any])
                    self.deliverState()
                } else {
                    self.pollState()
                }
            }
        }.resume()
    }

    private func sendJavaScript(method: String, object: [String: Any]) {
        guard pageReady,
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.fragmentsAllowed]),
              let json = String(data: data, encoding: .utf8) else { return }
        let safeJSON = json.replacingOccurrences(of: "\u{2028}", with: "\\u2028").replacingOccurrences(of: "\u{2029}", with: "\\u2029")
        let script = "window.TodoGlass && window.TodoGlass.\(method)(\(safeJSON));"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let messageURL = message.frameInfo.request.url, messageURL.standardizedFileURL == uiURL,
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            pageReady = true
            deliverState()
            pollState()
        case "action":
            if let action = body["action"] as? [String: Any] {
                postAction(action, requestID: body["requestId"] as? String)
            }
        case "refresh": pollState()
        case "openNote": openNote()
        case "settings": openSettings()
        case "hide": hidePanel()
        case "drag":
            dragAnchor = NSEvent.mouseLocation
            dragOrigin = panel.frame.origin
        case "collapse":
            setCollapsed(body["collapsed"] as? Bool ?? !collapsed)
            deliverState()
        case "settingsUpdate":
            if let preferences = body["preferences"] as? [String: Any] {
                postAction(["type": "preferences", "preferences": preferences], requestID: body["requestId"] as? String)
            }
        default: break
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        // Links and pop-ups cannot navigate the privileged bridge to another page.
        let allowed = url.isFileURL && url.standardizedFileURL == uiURL
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        deliverState()
    }

    func applicationWillTerminate(_ notification: Notification) {
        saveFrame()
        timer?.invalidate()
        session?.invalidateAndCancel()
        FileHandle.standardInput.readabilityHandler = nil
        if let eventMonitor { NSEvent.removeMonitor(eventMonitor) }
        observers.forEach(NotificationCenter.default.removeObserver)
        if let statusItem { NSStatusBar.system.removeStatusItem(statusItem) }
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "todoglass")
    }
}

let app = NSApplication.shared
let delegate = TodoGlassApp()
app.setActivationPolicy(.accessory)
app.delegate = delegate
app.run()
