import SwiftUI

@main
struct SHarkWatchApp: App {
  @State private var model: WatchModel

  init() {
    #if DEBUG
      let preview = ProcessInfo.processInfo.arguments.contains("-SHARK_PREVIEW")
        ? WatchSnapshot.preview
        : nil
    #else
      let preview: WatchSnapshot? = nil
    #endif
    _model = State(initialValue: WatchModel(preview: preview))
  }

  var body: some Scene {
    WindowGroup {
      WatchRootView(model: model)
    }
  }
}
