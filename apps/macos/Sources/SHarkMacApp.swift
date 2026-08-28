import ServiceManagement
import SwiftUI
import UserNotifications

@main
struct SHarkMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var store: CompanionStore

    init() {
        let store = CompanionStore.live()
        _store = StateObject(wrappedValue: store)
        AppDelegate.store = store
    }

    var body: some Scene {
        MenuBarExtra {
            MenuBarRoot(store: store)
                .frame(width: 410, height: 560)
        } label: {
            if let menuIcon {
                Label("SHark", systemImage: menuIcon)
            } else {
                Image("MenuBarIcon")
                    .accessibilityLabel("SHark")
            }
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView(store: store)
        }
    }

    private var menuIcon: String? {
        if (store.snapshot?.unresolvedCount ?? 0) > 0 { return "exclamationmark.bubble.fill" }
        if case .stale = store.state { return "wifi.exclamationmark" }
        return nil
    }
}

struct MenuBarRoot: View {
    @ObservedObject var store: CompanionStore
    @State private var filter = Filter.all
    @State private var replyingTo: InboxItem?
    @State private var reply = ""

    enum Filter: String, CaseIterable, Identifiable {
        case all = "All"
        case action = "Needs action"
        var id: String { rawValue }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
            Divider()
            footer
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .alert("Reply", isPresented: Binding(
            get: { replyingTo != nil },
            set: { if !$0 { replyingTo = nil; reply = "" } }
        )) {
            TextField("Reply", text: $reply)
            Button("Cancel", role: .cancel) { replyingTo = nil; reply = "" }
            Button("Send") {
                guard let item = replyingTo else { return }
                let text = reply
                replyingTo = nil
                reply = ""
                Task { await store.respond(to: item, with: .reply(text)) }
            }
            .disabled(reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } message: {
            Text(replyingTo?.body ?? "")
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image("SharkDevilMark")
                .resizable()
                .scaledToFit()
                .frame(width: 42, height: 24)
            VStack(alignment: .leading, spacing: 1) {
                Text("SHark").font(.headline)
                if let snapshot = store.snapshot {
                    Text("\(snapshot.unresolvedCount) need action")
                        .font(.caption)
                        .foregroundStyle(snapshot.unresolvedCount > 0 ? .orange : .secondary)
                } else {
                    Text("macOS companion").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if store.isSignedIn {
                Button {
                    Task { await store.refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help("Refresh")
            }
        }
        .padding(14)
    }

    @ViewBuilder
    private var content: some View {
        switch store.state {
        case .signedOut:
            SignInView(store: store)
        case .authorizing(let authorization):
            AuthorizationView(store: store, authorization: authorization)
        case .loading:
            VStack(spacing: 12) {
                ProgressView()
                Text("Loading SHark…").foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ErrorView(message: message) { Task { await store.start() } }
        case .ready(let snapshot):
            inbox(snapshot, staleMessage: nil)
        case .stale(let snapshot, let message):
            inbox(snapshot, staleMessage: message)
        }
    }

    private func inbox(_ snapshot: MacSnapshot, staleMessage: String?) -> some View {
        VStack(spacing: 0) {
            if let staleMessage {
                Label(staleMessage, systemImage: "wifi.exclamationmark")
                    .font(.caption)
                    .foregroundStyle(.yellow)
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
            }
            Picker("Filter", selection: $filter) {
                ForEach(Filter.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(12)

            let items = filter == .action ? snapshot.items.filter(\.needsAction) : snapshot.items
            if items.isEmpty {
                ContentUnavailableView(
                    filter == .action ? "Nothing needs action" : "No notifications yet",
                    systemImage: filter == .action ? "checkmark.circle" : "bell.slash"
                )
            } else {
                List(items) { item in
                    InboxRow(
                        item: item,
                        hidePreviews: store.hidePreviews,
                        disabled: store.isSubmitting || staleMessage != nil,
                        onAction: { action in Task { await store.respond(to: item, with: action) } },
                        onReply: { replyingTo = item },
                        onRead: { Task { await store.markRead(item) } }
                    )
                }
                .listStyle(.plain)
            }
            if let notice = store.notice {
                Text(notice)
                    .font(.caption)
                    .foregroundStyle(notice.contains("sent") ? .green : .orange)
                    .padding(8)
            }
        }
    }

    private var footer: some View {
        HStack {
            if store.isSignedIn {
                NotificationButton(store: store)
            }
            Spacer()
            SettingsLink { Image(systemName: "gearshape") }
                .buttonStyle(.borderless)
                .help("Settings")
            Button("Quit") { NSApplication.shared.terminate(nil) }
                .buttonStyle(.borderless)
        }
        .font(.caption)
        .padding(12)
    }
}

private struct SignInView: View {
    @ObservedObject var store: CompanionStore
    var body: some View {
        VStack(spacing: 16) {
            Image("SharkDevilMark")
                .resizable()
                .scaledToFit()
                .frame(width: 120, height: 70)
            Text("SHark on your Mac").font(.title2.bold())
            Text("Receive desktop alerts and handle approvals without opening the web dashboard.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .frame(maxWidth: 300)
            Button("Connect to SHark") { Task { await store.beginSignIn() } }
                .buttonStyle(.borderedProminent)
                .tint(.red)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}

private struct AuthorizationView: View {
    @ObservedObject var store: CompanionStore
    let authorization: AuthorizationStart
    var body: some View {
        VStack(spacing: 14) {
            ProgressView()
            Text("Approve this Mac").font(.title3.bold())
            Text(authorization.userCode).font(.system(.title2, design: .monospaced).bold())
                .textSelection(.enabled)
            Text("A secure sign-in page opened in your browser. The code expires automatically.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .frame(maxWidth: 300)
            Button("Open sign-in page") { NSWorkspace.shared.open(authorization.verificationUriComplete) }
            Button("Cancel", role: .cancel) { store.cancelSignIn() }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}

private struct ErrorView: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark").font(.largeTitle)
            Text(message).multilineTextAlignment(.center).frame(maxWidth: 300)
            Button("Try again", action: retry)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}

private struct InboxRow: View {
    let item: InboxItem
    let hidePreviews: Bool
    let disabled: Bool
    let onAction: (CompanionAction) -> Void
    let onReply: () -> Void
    let onRead: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(hidePreviews ? "SHark alert" : item.title).font(.headline).lineLimit(1)
                Spacer()
                Text(item.occurredAt, style: .relative).font(.caption2).foregroundStyle(.secondary)
            }
            Text(hidePreviews ? "Open SHark to view details." : item.body)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(3)
            HStack {
                Text(item.sourceName).font(.caption).foregroundStyle(.tertiary)
                Spacer()
                if item.readAt == nil {
                    Button("Mark read", action: onRead).buttonStyle(.link).font(.caption)
                }
            }
            if let action = item.action {
                actionButtons(action)
            } else if let result = item.result {
                Label(result, systemImage: item.status == "failed" ? "xmark.circle" : "checkmark.circle")
                    .font(.caption)
                    .foregroundStyle(item.status == "failed" ? .red : .secondary)
            }
        }
        .padding(.vertical, 7)
    }

    @ViewBuilder
    private func actionButtons(_ action: InboxAction) -> some View {
        HStack {
            if action.kind == "approval" {
                Button(action.primaryLabel ?? "Approve") { onAction(.approve) }.tint(.green)
                Button(action.secondaryLabel ?? "Deny") { onAction(.deny) }.tint(.red)
            } else if action.kind == "yes_no" {
                Button(action.primaryLabel ?? "Yes") { onAction(.yes) }.tint(.green)
                Button(action.secondaryLabel ?? "No") { onAction(.no) }.tint(.red)
            } else {
                Button("Reply", action: onReply)
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .disabled(disabled)
    }
}

private struct NotificationButton: View {
    @ObservedObject var store: CompanionStore
    @State private var status = UNAuthorizationStatus.notDetermined

    var body: some View {
        Button(label) {
            Task {
                do {
                    let granted = try await UNUserNotificationCenter.current()
                        .requestAuthorization(options: [.alert, .sound, .badge])
                    status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
                    if granted { NSApplication.shared.registerForRemoteNotifications() }
                } catch {
                    store.registrationFailed(error.localizedDescription)
                }
            }
        }
        .buttonStyle(.borderless)
        .task {
            status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        }
        .help(store.registrationError ?? label)
    }

    private var label: String {
        switch status {
        case .authorized, .provisional: "Alerts on"
        case .denied: "Alerts blocked"
        default: "Enable alerts"
        }
    }
}

private struct SettingsView: View {
    @ObservedObject var store: CompanionStore
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var loginError: String?

    var body: some View {
        Form {
            Section("Notifications") {
                Toggle("Hide notification previews", isOn: $store.hidePreviews)
                Text("Private mode removes titles, message bodies, and quick actions from macOS banners.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let registrationError = store.registrationError {
                    Text(registrationError).foregroundStyle(.red).font(.caption)
                }
            }
            Section("General") {
                Toggle("Launch SHark at login", isOn: Binding(
                    get: { launchAtLogin },
                    set: updateLoginItem
                ))
                if let loginError { Text(loginError).foregroundStyle(.red).font(.caption) }
            }
            if store.isSignedIn {
                Section("Account") {
                    Button("Sign out", role: .destructive) { Task { await store.signOut() } }
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 440, height: 300)
        .padding()
    }

    private func updateLoginItem(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            launchAtLogin = enabled
            loginError = nil
        } catch {
            launchAtLogin = SMAppService.mainApp.status == .enabled
            loginError = error.localizedDescription
        }
    }
}
