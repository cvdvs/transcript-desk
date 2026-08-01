// Transcript Desk — native macOS shell (Objective-C).
// A real app: its own process, menu bar, Dock icon. Inside is a WKWebView
// showing the local Transcript Desk server; on launch the app health-checks
// the engine and revives the LaunchAgent if it's down.
//
// Build: clang -fobjc-arc -O2 -framework Cocoa -framework WebKit \
//        -o TranscriptDesk main.m

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSString *const kAppURL = @"http://localhost:3999";

@interface AppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate>
@property (strong) NSWindow *window;
@property (strong) WKWebView *webView;
@property (strong) NSTextField *statusLabel;
@property (assign) NSInteger attempts;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    config.preferences.elementFullscreenEnabled = YES;

    self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:config];
    self.webView.navigationDelegate = self;
    self.webView.UIDelegate = self;
    self.webView.hidden = YES;

    self.statusLabel = [NSTextField labelWithString:@"Starting the engine…"];
    self.statusLabel.font = [NSFont monospacedSystemFontOfSize:13 weight:NSFontWeightMedium];
    self.statusLabel.textColor = [NSColor secondaryLabelColor];
    self.statusLabel.alignment = NSTextAlignmentCenter;

    self.window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(0, 0, 1280, 860)
                  styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                             NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable)
                    backing:NSBackingStoreBuffered
                      defer:NO];
    self.window.title = @"Transcript Desk";
    self.window.minSize = NSMakeSize(700, 500);
    [self.window center];
    [self.window setFrameAutosaveName:@"TranscriptDeskMain"];

    NSView *content = [[NSView alloc] init];
    self.window.contentView = content;
    self.webView.translatesAutoresizingMaskIntoConstraints = NO;
    self.statusLabel.translatesAutoresizingMaskIntoConstraints = NO;
    [content addSubview:self.webView];
    [content addSubview:self.statusLabel];
    [NSLayoutConstraint activateConstraints:@[
        [self.webView.topAnchor constraintEqualToAnchor:content.topAnchor],
        [self.webView.bottomAnchor constraintEqualToAnchor:content.bottomAnchor],
        [self.webView.leadingAnchor constraintEqualToAnchor:content.leadingAnchor],
        [self.webView.trailingAnchor constraintEqualToAnchor:content.trailingAnchor],
        [self.statusLabel.centerXAnchor constraintEqualToAnchor:content.centerXAnchor],
        [self.statusLabel.centerYAnchor constraintEqualToAnchor:content.centerYAnchor],
    ]];

    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    [self checkEngine];
}

#pragma mark - engine management

- (void)checkEngine {
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:kAppURL]];
    req.timeoutInterval = 2;
    [[[NSURLSession sharedSession] dataTaskWithRequest:req
        completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        dispatch_async(dispatch_get_main_queue(), ^{
            NSHTTPURLResponse *http = (NSHTTPURLResponse *)resp;
            if ([http isKindOfClass:[NSHTTPURLResponse class]] && http.statusCode == 200) {
                self.statusLabel.hidden = YES;
                self.webView.hidden = NO;
                [self.webView loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:kAppURL]]];
            } else {
                [self reviveEngine];
            }
        });
    }] resume];
}

- (void)reviveEngine {
    self.attempts += 1;
    if (self.attempts == 1) {
        NSString *plist = [NSHomeDirectory()
            stringByAppendingPathComponent:@"Library/LaunchAgents/com.transcript-desk.plist"];
        [self runCmd:@"/bin/launchctl" args:@[ @"load", @"-w", plist ]];
        NSString *target = [NSString stringWithFormat:@"gui/%d/com.transcript-desk", getuid()];
        [self runCmd:@"/bin/launchctl" args:@[ @"kickstart", target ]];
    }
    if (self.attempts > 45) {
        self.statusLabel.stringValue = @"The engine won't start — check ~/Library/Logs/transcript-desk.log";
        return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.7 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{ [self checkEngine]; });
}

- (void)runCmd:(NSString *)path args:(NSArray<NSString *> *)args {
    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:path];
    task.arguments = args;
    [task launchAndReturnError:nil];
}

- (void)reloadPage {
    [self.webView reload];
}

// if the engine dies mid-use, go back to the revive loop
- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation
      withError:(NSError *)error {
    self.webView.hidden = YES;
    self.statusLabel.hidden = NO;
    self.statusLabel.stringValue = @"Reconnecting…";
    self.attempts = 0;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.0 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{ [self checkEngine]; });
}

#pragma mark - browser behaviors

// target=_blank links (open original, timestamps) → default browser
- (WKWebView *)webView:(WKWebView *)webView
    createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
               forNavigationAction:(WKNavigationAction *)navigationAction
                    windowFeatures:(WKWindowFeatures *)windowFeatures {
    if (navigationAction.request.URL) {
        [[NSWorkspace sharedWorkspace] openURL:navigationAction.request.URL];
    }
    return nil;
}

// JS alert/confirm (delete uses confirm) → native dialogs
- (void)webView:(WKWebView *)webView
    runJavaScriptAlertPanelWithMessage:(NSString *)message
                      initiatedByFrame:(WKFrameInfo *)frame
                     completionHandler:(void (^)(void))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = message;
    [alert runModal];
    completionHandler();
}

- (void)webView:(WKWebView *)webView
    runJavaScriptConfirmPanelWithMessage:(NSString *)message
                        initiatedByFrame:(WKFrameInfo *)frame
                       completionHandler:(void (^)(BOOL))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = message;
    [alert addButtonWithTitle:@"OK"];
    [alert addButtonWithTitle:@"Cancel"];
    completionHandler([alert runModal] == NSAlertFirstButtonReturn);
}

// export buttons (.md/.txt/.srt) → save into ~/Downloads
- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    decisionHandler(navigationAction.shouldPerformDownload ? WKNavigationActionPolicyDownload
                                                           : WKNavigationActionPolicyAllow);
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationResponse:(WKNavigationResponse *)navigationResponse
                      decisionHandler:(void (^)(WKNavigationResponsePolicy))decisionHandler {
    decisionHandler(navigationResponse.canShowMIMEType ? WKNavigationResponsePolicyAllow
                                                       : WKNavigationResponsePolicyDownload);
}

- (void)webView:(WKWebView *)webView
    navigationAction:(WKNavigationAction *)navigationAction
    didBecomeDownload:(WKDownload *)download {
    download.delegate = self;
}

- (void)webView:(WKWebView *)webView
    navigationResponse:(WKNavigationResponse *)navigationResponse
     didBecomeDownload:(WKDownload *)download {
    download.delegate = self;
}

- (void)download:(WKDownload *)download
    decideDestinationUsingResponse:(NSURLResponse *)response
                 suggestedFilename:(NSString *)suggestedFilename
                 completionHandler:(void (^)(NSURL *))completionHandler {
    NSURL *downloads = [[NSFileManager defaultManager] URLsForDirectory:NSDownloadsDirectory
                                                              inDomains:NSUserDomainMask][0];
    NSURL *dest = [downloads URLByAppendingPathComponent:suggestedFilename];
    NSString *base = [suggestedFilename stringByDeletingPathExtension];
    NSString *ext = [suggestedFilename pathExtension];
    NSInteger i = 2;
    while ([[NSFileManager defaultManager] fileExistsAtPath:dest.path]) {
        NSString *name = ext.length
            ? [NSString stringWithFormat:@"%@-%ld.%@", base, (long)i, ext]
            : [NSString stringWithFormat:@"%@-%ld", base, (long)i];
        dest = [downloads URLByAppendingPathComponent:name];
        i += 1;
    }
    completionHandler(dest);
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES; // closing the window quits the app; the engine keeps running for the phone
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        app.delegate = delegate;

        NSMenu *mainMenu = [[NSMenu alloc] init];

        NSMenuItem *appItem = [[NSMenuItem alloc] init];
        [mainMenu addItem:appItem];
        NSMenu *appMenu = [[NSMenu alloc] init];
        [appMenu addItemWithTitle:@"About Transcript Desk"
                           action:@selector(orderFrontStandardAboutPanel:)
                    keyEquivalent:@""];
        [appMenu addItem:[NSMenuItem separatorItem]];
        [appMenu addItemWithTitle:@"Hide Transcript Desk" action:@selector(hide:) keyEquivalent:@"h"];
        [appMenu addItem:[NSMenuItem separatorItem]];
        [appMenu addItemWithTitle:@"Quit Transcript Desk" action:@selector(terminate:) keyEquivalent:@"q"];
        appItem.submenu = appMenu;

        NSMenuItem *editItem = [[NSMenuItem alloc] init];
        [mainMenu addItem:editItem];
        NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
        [editMenu addItemWithTitle:@"Undo" action:NSSelectorFromString(@"undo:") keyEquivalent:@"z"];
        [editMenu addItemWithTitle:@"Redo" action:NSSelectorFromString(@"redo:") keyEquivalent:@"Z"];
        [editMenu addItem:[NSMenuItem separatorItem]];
        [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
        [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
        [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
        [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
        editItem.submenu = editMenu;

        NSMenuItem *viewItem = [[NSMenuItem alloc] init];
        [mainMenu addItem:viewItem];
        NSMenu *viewMenu = [[NSMenu alloc] initWithTitle:@"View"];
        NSMenuItem *reloadItem = [[NSMenuItem alloc] initWithTitle:@"Reload"
                                                            action:@selector(reloadPage)
                                                     keyEquivalent:@"r"];
        reloadItem.target = delegate;
        [viewMenu addItem:reloadItem];
        viewItem.submenu = viewMenu;

        app.mainMenu = mainMenu;
        [app run];
    }
    return 0;
}
