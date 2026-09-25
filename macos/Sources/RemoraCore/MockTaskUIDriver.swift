import Foundation

/// Presentation fixtures for the mock driver. These strings are not derived from any
/// real task and must never be read as evidence that a resource was created.
public enum MockTaskLabels {
    public static let successSummary = "Demo complete"
    public static let failureMessage = "Something went wrong while demonstrating the task."

    public static func labels(for command: String) -> [String] {
        let lowered = command.lowercased()
        if lowered.contains("dynamodb") || lowered.contains("table") {
            return ["Opening DynamoDB…", "Filling table details…", "Reviewing the request…"]
        }
        return ["Looking at the current app…", "Preparing the task…", "Finishing up…"]
    }
}

/// Deterministic, UI-only task driver.
///
/// It performs no external work, inspects no application, and posts no input events.
/// Debug toggles allow the demonstration to end in failure or cancellation.
@MainActor
public final class MockTaskUIDriver: TaskUIDriving {
    public typealias EventHandler = @MainActor (MockTaskEvent) -> Void

    private let sleeper: RemoraSleeping
    private let submittingDuration: Duration
    private let stepDuration: Duration
    private let finalDuration: Duration

    /// Receives every mock event. Assigned by the session controller after construction.
    public var onEvent: EventHandler?

    /// When true, the next run fails after its final step instead of succeeding.
    public var debugForceFailure = false
    /// When true, the next run cancels after its first step.
    public var debugForceCancellation = false

    public private(set) var isRunning = false
    private var runTask: Task<Void, Never>?

    public init(
        sleeper: RemoraSleeping = ContinuousRemoraSleeper(),
        submittingDuration: Duration = .milliseconds(400),
        stepDuration: Duration = .milliseconds(700),
        finalDuration: Duration = .milliseconds(250),
        onEvent: EventHandler? = nil
    ) {
        self.sleeper = sleeper
        self.submittingDuration = submittingDuration
        self.stepDuration = stepDuration
        self.finalDuration = finalDuration
        self.onEvent = onEvent
    }

    public func start(command: String) async {
        guard !isRunning else { return }
        isRunning = true

        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.run(command: command)
        }
        runTask = task
        await task.value
        runTask = nil
        isRunning = false
    }

    public func cancel() async {
        guard isRunning else { return }
        runTask?.cancel()
        await runTask?.value
    }

    private func run(command: String) async {
        onEvent?(.submitting(command: command))

        do {
            try await sleeper.sleep(for: submittingDuration)
            try Task.checkCancellation()

            let labels = MockTaskLabels.labels(for: command)
            for (index, label) in labels.enumerated() {
                try await sleeper.sleep(for: stepDuration)
                try Task.checkCancellation()

                let total = labels.count
                let progress = total == 0 ? 1 : Double(index + 1) / Double(total)
                onEvent?(.working(
                    command: command,
                    step: label,
                    index: index + 1,
                    total: total,
                    progress: progress
                ))

                if debugForceCancellation && index == 0 {
                    throw CancellationError()
                }

                if debugForceFailure && index == total - 1 {
                    onEvent?(.failed(command: command, message: MockTaskLabels.failureMessage))
                    return
                }
            }

            try await sleeper.sleep(for: finalDuration)
            try Task.checkCancellation()
            onEvent?(.succeeded(command: command, summary: MockTaskLabels.successSummary))
        } catch is CancellationError {
            onEvent?(.cancelled(command: command))
        } catch {
            onEvent?(.failed(command: command, message: MockTaskLabels.failureMessage))
        }
    }
}
