import Testing
@testable import RemoraCore

@Suite
@MainActor
struct MockTaskUIDriverTests {
    @Test func labelSelection() {
        #expect(
            MockTaskLabels.labels(for: "Create a DynamoDB table")
                == ["Opening DynamoDB…", "Filling table details…", "Reviewing the request…"]
        )
        #expect(
            MockTaskLabels.labels(for: "delete my TABLE")
                == ["Opening DynamoDB…", "Filling table details…", "Reviewing the request…"]
        )
        #expect(
            MockTaskLabels.labels(for: "open settings")
                == ["Looking at the current app…", "Preparing the task…", "Finishing up…"]
        )
    }

    @Test func normalRunEmitsSubmittingThreeStepsThenSuccess() async {
        var events: [MockTaskEvent] = []
        let driver = MockTaskUIDriver(
            sleeper: ImmediateRemoraSleeper(),
            onEvent: { events.append($0) }
        )
        await driver.start(command: "Create a DynamoDB table")

        #expect(events.count == 5)
        #expect(events.first == .submitting(command: "Create a DynamoDB table"))
        guard case .working(_, let step1, let index1, let total, let progress1) = events[1] else {
            Issue.record("Expected working event")
            return
        }
        #expect(step1 == "Opening DynamoDB…")
        #expect(index1 == 1)
        #expect(total == 3)
        #expect(abs(progress1 - 1.0 / 3.0) < 0.0001)
        #expect(events.last == .succeeded(command: "Create a DynamoDB table", summary: "Demo complete"))
        #expect(driver.isRunning == false)
    }

    @Test func debugCancellationPreventsLateSuccess() async {
        var events: [MockTaskEvent] = []
        let driver = MockTaskUIDriver(
            sleeper: ImmediateRemoraSleeper(),
            onEvent: { events.append($0) }
        )
        driver.debugForceCancellation = true
        await driver.start(command: "do something")

        #expect(events.last == .cancelled(command: "do something"))
        #expect(events.contains { if case .succeeded = $0 { return true }; return false } == false)
    }

    @Test func debugFailureStopsBeforeSuccess() async {
        var events: [MockTaskEvent] = []
        let driver = MockTaskUIDriver(
            sleeper: ImmediateRemoraSleeper(),
            onEvent: { events.append($0) }
        )
        driver.debugForceFailure = true
        await driver.start(command: "do something")

        #expect(events.last == .failed(command: "do something", message: MockTaskLabels.failureMessage))
        #expect(events.contains { if case .succeeded = $0 { return true }; return false } == false)
    }

    @Test func externalCancelWhileSuspendedEmitsCancelled() async {
        let sleeper = ManualRemoraSleeper()
        var events: [MockTaskEvent] = []
        let driver = MockTaskUIDriver(sleeper: sleeper, onEvent: { events.append($0) })

        let run = Task { await driver.start(command: "long task") }
        await sleeper.waitForRequestCount(1)
        await driver.cancel()
        await run.value

        #expect(events.first == .submitting(command: "long task"))
        #expect(events.last == .cancelled(command: "long task"))
        #expect(events.contains { if case .succeeded = $0 { return true }; return false } == false)
        #expect(driver.isRunning == false)
    }

    @Test func secondStartIgnoredWhileRunning() async {
        let sleeper = ManualRemoraSleeper()
        var events: [MockTaskEvent] = []
        let driver = MockTaskUIDriver(sleeper: sleeper, onEvent: { events.append($0) })

        let first = Task { await driver.start(command: "first") }
        await sleeper.waitForRequestCount(1)
        await driver.start(command: "second")
        #expect(events.filter { if case .submitting = $0 { return true }; return false }.count == 1)

        await driver.cancel()
        await first.value
    }
}
