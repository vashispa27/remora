import Testing
@testable import RemoraCore

@Suite
struct StateMachineTests {
    private func state(_ phase: RemoraPhase) -> RemoraUIState {
        switch phase {
        case .hidden: return .hidden
        case .ready: return .ready
        case .submitting: return .submitting(command: "c")
        case .working: return .working(command: "c", step: "s", progress: 0.5)
        case .succeeded: return .succeeded(command: "c", summary: "ok")
        case .failed: return .failed(command: "c", message: "no")
        case .cancelled: return .cancelled(command: "c")
        }
    }

    @Test func allowedTransitions() {
        let allowed: [(RemoraPhase, RemoraPhase)] = [
            (.hidden, .ready),
            (.ready, .submitting),
            (.submitting, .working),
            (.submitting, .failed),
            (.submitting, .cancelled),
            (.working, .succeeded),
            (.working, .failed),
            (.working, .cancelled),
            (.succeeded, .ready),
            (.failed, .submitting),
            (.failed, .ready),
            (.cancelled, .ready),
            // Dismissal from any visible phase.
            (.ready, .hidden),
            (.submitting, .hidden),
            (.working, .hidden),
            (.succeeded, .hidden),
            (.failed, .hidden),
            (.cancelled, .hidden)
        ]

        for (from, to) in allowed {
            #expect(
                RemoraStateMachine.canTransition(from: from, to: to),
                "Expected \(from) -> \(to) to be allowed"
            )
            #expect(throws: Never.self) {
                try RemoraStateMachine.validate(from: state(from), to: state(to))
            }
        }
    }

    @Test func rejectedTransitions() {
        let rejected: [(RemoraPhase, RemoraPhase)] = [
            (.hidden, .hidden),
            (.ready, .ready),
            (.hidden, .working),
            (.hidden, .succeeded),
            (.hidden, .failed),
            (.hidden, .cancelled),
            (.ready, .working),
            (.ready, .succeeded),
            (.ready, .failed),
            (.ready, .cancelled),
            (.submitting, .ready),
            (.submitting, .succeeded),
            (.working, .ready),
            (.working, .submitting),
            (.succeeded, .working),
            (.succeeded, .submitting),
            (.succeeded, .failed),
            (.failed, .working),
            (.failed, .succeeded),
            (.failed, .cancelled),
            (.cancelled, .working),
            (.cancelled, .submitting),
            (.cancelled, .failed)
        ]

        for (from, to) in rejected {
            #expect(
                RemoraStateMachine.canTransition(from: from, to: to) == false,
                "Expected \(from) -> \(to) to be rejected"
            )
            #expect(throws: RemoraTransitionError.self) {
                try RemoraStateMachine.validate(from: state(from), to: state(to))
            }
        }
    }

    @Test func commandMismatchIsRejected() {
        let from = RemoraUIState.working(command: "first", step: "s", progress: 0.5)
        let to = RemoraUIState.succeeded(command: "second", summary: "ok")
        #expect(throws: RemoraTransitionError.commandMismatch(from: "first", to: "second")) {
            try RemoraStateMachine.validate(from: from, to: to)
        }
    }

    @Test func readyToSubmittingAcceptsNewCommand() {
        #expect(throws: Never.self) {
            try RemoraStateMachine.validate(from: .ready, to: .submitting(command: "new"))
        }
    }

    @Test func stateAccessors() {
        #expect(RemoraUIState.hidden.isVisible == false)
        #expect(RemoraUIState.ready.isVisible == true)
        #expect(RemoraUIState.ready.command == nil)
        #expect(RemoraUIState.working(command: "x", step: "s", progress: 0.1).command == "x")
        #expect(RemoraUIState.failed(command: "x", message: "m").command == "x")
        #expect(RemoraUIState.succeeded(command: "x", summary: "s").command == "x")
        #expect(RemoraUIState.cancelled(command: "x").command == "x")
    }
}
