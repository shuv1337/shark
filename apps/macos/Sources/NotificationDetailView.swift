import AppKit
import SwiftUI

struct NotificationDetailView: View {
    @ObservedObject var store: CompanionStore
    let initialItem: InboxItem
    @Environment(\.dismiss) private var dismiss
    @State private var reply = ""
    @State private var linkError: String?

    private var currentItem: InboxItem? {
        store.snapshot?.items.first { $0.id == initialItem.id }
    }

    private var item: InboxItem { currentItem ?? initialItem }

    private var canRespond: Bool {
        store.canRespond(to: initialItem)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Notification").font(.headline)
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(16)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.sourceName).font(.subheadline).foregroundStyle(.secondary)
                        Text(item.title).font(.title2.bold()).textSelection(.enabled)
                        Text(item.occurredAt, format: .dateTime.month().day().year().hour().minute())
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Text(item.body)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)

                    if let link = item.url, !link.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Link").font(.headline)
                            Text(link).font(.caption).textSelection(.enabled)
                            if let url = item.browserURL {
                                Button {
                                    linkError = NSWorkspace.shared.open(url)
                                        ? nil : "The link could not be opened."
                                } label: {
                                    Label("Open in Browser", systemImage: "arrow.up.right.square")
                                }
                            } else {
                                Text("This link is not a web address.")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            if let linkError {
                                Text(linkError).font(.caption).foregroundStyle(.red)
                            }
                        }
                    }

                    if let action = currentItem?.action, item.needsAction {
                        Divider()
                        responseControls(action)
                        if !canRespond && !store.isSubmitting {
                            Text("Refresh the inbox before responding.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    } else if let result = item.result {
                        Label(result, systemImage: item.status == "failed" ? "xmark.circle" : "checkmark.circle")
                            .foregroundStyle(item.status == "failed" ? .red : .secondary)
                    }
                    if let notice = store.notice {
                        Text(notice).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(16)
            }
        }
        .frame(width: 420, height: 520)
        .task {
            if initialItem.readAt == nil { await store.markRead(initialItem) }
        }
        .onChange(of: store.isSignedIn) { _, signedIn in
            if !signedIn { dismiss() }
        }
    }

    @ViewBuilder
    private func responseControls(_ action: InboxAction) -> some View {
        if action.kind == "reply" {
            VStack(alignment: .leading, spacing: 8) {
                Text("Reply").font(.headline)
                TextField("Your reply", text: $reply, axis: .vertical)
                    .lineLimit(3...8)
                    .textFieldStyle(.roundedBorder)
                    .disabled(!canRespond)
                Button(store.isSubmitting ? "Sending…" : "Send Reply") {
                    respond(.reply(reply))
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canRespond || reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        } else {
            HStack {
                if action.kind == "approval" {
                    Button(action.primaryLabel ?? "Approve") { respond(.approve) }.tint(.green)
                    Button(action.secondaryLabel ?? "Deny") { respond(.deny) }.tint(.red)
                } else if action.kind == "yes_no" {
                    Button(action.primaryLabel ?? "Yes") { respond(.yes) }.tint(.green)
                    Button(action.secondaryLabel ?? "No") { respond(.no) }.tint(.red)
                }
            }
            .buttonStyle(.bordered)
            .disabled(!canRespond)
        }
    }

    private func respond(_ action: CompanionAction) {
        guard canRespond, let currentItem else { return }
        Task {
            await store.respond(to: currentItem, with: action)
            if self.currentItem?.needsAction == false { reply = "" }
        }
    }
}
