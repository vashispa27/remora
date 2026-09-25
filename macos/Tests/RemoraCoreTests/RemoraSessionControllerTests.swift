import CoreGraphics
import Foundation
import Testing
@testable import RemoraCore

@MainActor
private final class FakePointer: AgentPointerAnimating {
    enum Action: Equatable {
        case appear(CGPoint)
        case move(CGPoint)
        case result(PointerResult)
        case disappear
    }

    private(set) var actions: [Action] = []

    func appear(at point: CGPoint) async { actions.append(.appear(point)) }
    func move(to point: CGPoint, duration: Duration) async { actions.append(.move(point)) }
    func showResult(_ result: PointerResult) async { actions.append(.result(result)) }
    func disappear() async { actions.append(.disappear) }

    func count(of action: Action) -> Int { actions.filter { $0 == action }.count }
}

@Suite
@MainActor
struct RemoraSessionControllerTests {
    private let frame = CGRect(x: 0, y: 0, width: 1440, height: 900)

    private func makeSession() -> (RemoraSessionController, FakePointer) {
        let driver = MockTaskUIDriver(sleeper: ImmediateRemoraSleeper())
        let session = RemoraSessionController(driver: driver)
        let pointer = FakePointer()
        session.pointer = pointer
        session.visibleFrameProvider = { self.frame }
        return (session, pointer)
    }

    private func waitForTerminal(_ session: RemoraSessionController) async {
        let deadline = Date().addingTimeInterval(2)
        while Date() < deadline {
            switch session.model.state.phase {
            case .succeeded, .failed, .cancelled:
                return
            default:
                try? await Task.sleep(for: .milliseconds(1))
            }
        }
    }

    @Test func presentShowsReadyAndAppearsPointer() async {
        let (session, pointer) = makeSession()
        session.present(at: CGPoint(x: 100, y: 200), context: FrontmostAppSummary(name: "Safari"))

        #expect(session.model.state == .ready)
        #expect(session.model.frontmostApp?.name == "Safari")
        try? await Task.sleep(for: .milliseconds(5))
        #expect(pointer.actions.first == .appear(CGPoint(x: 100, y: 200)))
    }

    @Test func submitRunsThreeStepsThenSucceeds() async {
        let (session, pointer) = makeSession()
        session.present(at: CGPoint(x: 200, y: 300), context: nil)
        session.model.draft = "Create a DynamoDB table"
        session.submit()

        await waitForTerminal(session)

        #expect(session.model.state == .succeeded(command: "Create a DynamoDB table", summary: "Demo complete"))
        #expect(session.model.workingStepTotal == 3)
        #expect(session.model.workingStepIndex == 3)
        #expect(pointer.actions.contains(.result(.success)))
    }

    @Test func reduceMotionSkipsPointerTravel() async {
        let (session, pointer) = makeSession()
        session.reduceMotion = true
        session.present(at: CGPoint(x: 200, y: 300), context: nil)
        session.model.draft = "open settings"
        session.submit()

        await waitForTerminal(session)

        #expect(session.model.state.phase == .succeeded)
        #expect(pointer.actions.contains { if case .move = $0 { return true }; return false } == false)
    }

    @Test func stopDuringWorkCancelsAndPreventsSuccess() async {
        let sleeper = ManualRemoraSleeper()
        let driver = MockTaskUIDriver(sleeper: sleeper)
        let session = RemoraSessionController(driver: driver)
        let pointer = FakePointer()
        session.pointer = pointer
        session.visibleFrameProvider = { self.frame }

        session.present(at: CGPoint(x: 200, y: 300), context: nil)
        session.model.draft = "long task"
        session.submit()

        await sleeper.waitForRequestCount(1)
        session.stop()

        // Let the run observe cancellation and finish.
        try? await Task.sleep(for: .milliseconds(20))
        #expect(session.model.state.phase == .cancelled)
        #expect(pointer.actions.contains(.result(.cancelled)))
    }

    @Test func retryCompletesAfterFailure() async {
        let driver = MockTaskUIDriver(sleeper: ImmediateRemoraSleeper())
        driver.debugForceFailure = true
        let session = RemoraSessionController(driver: driver)
        session.visibleFrameProvider = { self.frame }

        session.present(at: CGPoint(x: 10, y: 10), context: nil)
        session.model.draft = "run"
        session.submit()
        await waitForTerminal(session)
        #expect(session.model.state.phase == .failed)

        driver.debugForceFailure = false
        session.retry()
        await waitForTerminal(session)
        #expect(session.model.state == .succeeded(command: "run", summary: "Demo complete"))
    }

    @Test func dismissHidesAndIgnoresLateEvents() async {
        let sleeper = ManualRemoraSleeper()
        let driver = MockTaskUIDriver(sleeper: sleeper)
        let session = RemoraSessionController(driver: driver)
        session.visibleFrameProvider = { self.frame }

        session.present(at: CGPoint(x: 10, y: 10), context: nil)
        session.model.draft = "task"
        session.submit()
        await sleeper.waitForRequestCount(1)

        session.dismiss()
        #expect(session.model.state == .hidden)

        // Release the suspended run; its late events must not resurrect the UI.
        await sleeper.release()
        try? await Task.sleep(for: .milliseconds(10))
        #expect(session.model.state == .hidden)
    }

    @Test func mockPathStaysInsideVisibleFrame() {
        let path = RemoraSessionController.mockPath(
            from: CGPoint(x: 1430, y: 890),
            in: frame
        )
        #expect(path.count == 3)
        for point in path {
            #expect(point.x >= frame.minX)
            #expect(point.x <= frame.maxX)
            #expect(point.y >= frame.minY)
            #expect(point.y <= frame.maxY)
        }
    }

    @Test func successAutoDismissesAfterDelay() async {
        let driver = MockTaskUIDriver(sleeper: ImmediateRemoraSleeper())
        let session = RemoraSessionController(driver: driver)
        session.successAutoDismissDelay = .milliseconds(5)
        session.visibleFrameProvider = { self.frame }

        session.present(at: CGPoint(x: 10, y: 10), context: nil)
        session.model.draft = "task"
        session.submit()
        await waitForTerminal(session)
        #expect(session.model.state.phase == .succeeded)

        try? await Task.sleep(for: .milliseconds(30))
        #expect(session.model.state == .hidden)
    }
}
