// Transcript Desk — native macOS shell.
// A real app: its own process, menu bar, Dock icon. Inside is a WKWebView
// showing the local Transcript Desk server; on launch the app health-checks
// the engine and revives the LaunchAgent if it's down.
//
// Build: swiftc -swift-version 5 -O -framework Cocoa -framework WebKit \
//        -o TranscriptDesk main.swift

import Cocoa
import WebKit

let APP_URL = URL(string: "http://localhost:3999")!

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var statusLabel: NSTextField!
    var attempts = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        config.preferences.isElementFullscreenEnabled = true

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isHidden = true

        statusLabel = NSTextField(labelWithString: "Starting the engine…")
        statusLabel.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .medium)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.alignment = .center

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Transcript Desk"
        window.minSize = NSSize(width: 700, height: 500)
        window.center()
        window.setFrameAutosaveName("TranscriptDeskMain")

        let content = NSView()
        window.contentView = content
        for v in [webView as NSView, statusLabel as NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            content.addSubview(v)
        }
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: content.topAnchor),
            webView.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            statusLabel.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            statusLabel.centerYAnchor.constraint(equalTo: content.centerYAnchor),
        ])

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        checkEngine()
    }

    // ---------- engine management ----------

    func checkEngine() {
        var req = URLRequest(url: APP_URL)
        req.timeoutInterval = 2
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            DispatchQueue.main.async {
                if let http = resp as? HTTPURLResponse, http.statusCode == 200 {
                    self.statusLabel.isHidden = true
                    self.webView.isHidden = false
                    self.webView.load(URLRequest(url: APP_URL))
                } else {
                    self.reviveEngine()
                }
            }
        }.resume()
    }

    func reviveEngine() {
        attempts += 1
        if attempts == 1 {
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            runCmd("/bin/launchctl", ["load", "-w", "\(home)/Library/LaunchAgents/com.transcript-desk.plist"])
            runCmd("/bin/launchctl", ["kickstart", "gui/\(getuid())/com.transcript-desk"])
        }
        if attempts > 45 {
            statusLabel.stringValue = "The engine won't start — check ~/Library/Logs/transcript-desk.log"
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { self.checkEngine() }
    }

    func runCmd(_ path: String, _ args: [String]) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        try? p.run()
    }

    @objc func reloadPage() {
        webView.reload()
    }

    // if the engine dies mid-use, go back to the revive loop
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        webView.isHidden = true
        statusLabel.isHidden = false
        statusLabel.stringValue = "Reconnecting…"
        attempts = 0
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.checkEngine() }
    }

    // ---------- browser behaviors ----------

    // target=_blank links (open original, timestamps) → default browser
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    // JS alert/confirm (delete uses confirm) → native dialogs
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Cancel")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }

    // export buttons (.md/.txt/.srt) → save into ~/Downloads
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        var dest = downloads.appendingPathComponent(suggestedFilename)
        let base = (suggestedFilename as NSString).deletingPathExtension
        let ext = (suggestedFilename as NSString).pathExtension
        var i = 2
        while FileManager.default.fileExists(atPath: dest.path) {
            dest = downloads.appendingPathComponent("\(base)-\(i)\(ext.isEmpty ? "" : ".\(ext)")")
            i += 1
        }
        completionHandler(dest)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true // closing the window quits the app; the engine keeps running for the phone
    }
}

// ---------- app + menu bar ----------

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate

let mainMenu = NSMenu()

let appItem = NSMenuItem()
mainMenu.addItem(appItem)
let appMenu = NSMenu()
appMenu.addItem(withTitle: "About Transcript Desk",
                action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
appMenu.addItem(.separator())
appMenu.addItem(withTitle: "Hide Transcript Desk", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
appMenu.addItem(.separator())
appMenu.addItem(withTitle: "Quit Transcript Desk", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
appItem.submenu = appMenu

let editItem = NSMenuItem()
mainMenu.addItem(editItem)
let editMenu = NSMenu(title: "Edit")
editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
editMenu.addItem(.separator())
editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
editItem.submenu = editMenu

let viewItem = NSMenuItem()
mainMenu.addItem(viewItem)
let viewMenu = NSMenu(title: "View")
let reloadItem = NSMenuItem(title: "Reload", action: #selector(AppDelegate.reloadPage), keyEquivalent: "r")
reloadItem.target = delegate
viewMenu.addItem(reloadItem)
viewItem.submenu = viewMenu

app.mainMenu = mainMenu
app.run()
