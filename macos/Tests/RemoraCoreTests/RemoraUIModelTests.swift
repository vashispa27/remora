import CoreGraphics
import Testing
@testable import RemoraCore

@Suite
@MainActor
struct RemoraUIModelTests {
    @Test func initialStateIsHidden() {
        let model = RemoraUIModel()
        #expect(model.state == .hidden)
        #expect(model.invocationPoint == nil)
    }

    @Test func showReadySetsInvocationPointAndClearsDraft() {
        let model = RemoraUIModel()
        model.draft = "stale"
        model.showReady(at: CGPoint(x: 10, y: 20), frontmostApp: FrontmostAppSummary(name: "Safari"))
        #expect(model.state == .ready)
        #expect(model.invocationPoint == CGPoint(x: 10, y: 20))
        #expect(model.draft == "")
        #expect(model.frontmostApp?.name == "Safari")
    }

    @Test func submitTrimsWhitespace() {
        let model = RemoraUIModel()
        model.showReady(at: .zero, frontmostApp: nil)
        model.draft = "   Create a DynamoDB table \n"
        let command = model.submitDraft()
        #expect(command == "Create a DynamoDB table")
        #expect(model.state == .submitting(command: "Create a DynamoDB table"))
    }

    @Test func emptyDraftCannotSubmit() {
        let model = RemoraUIModel()
        model.showReady(at: .zero, frontmostApp: nil)
        model.draft = "   \n  "
        #expect(model.submitDraft() == nil)
        #expect(model.state == .ready)
        #expect(model.canSubmit == false)
    }

    @Test func characterLimitClampsDraft() {
        let model = RemoraUIModel()
        let long = String(repeating: "a", count: 2500)
        model.draft = long
        #expect(model.draft.count == model.maxCommandLength)
    }

    @Test func characterCountVisibilityThreshold() {
        let model = RemoraUIModel()
        model.draft = String(repeating: "a", count: model.countWarningThreshold - 1)
        #expect(model.shouldShowCharacterCount == false)
        model.draft = String(repeating: "a", count: model.countWarningThreshold)
        #expect(model.shouldShowCharacterCount)
    }

    @Test func hideClearsDraftAndInvocationPoint() {
        let model = RemoraUIModel()
        model.showReady(at: CGPoint(x: 5, y: 5), frontmostApp: nil)
        model.draft = "hello"
        model.hide()
        #expect(model.state == .hidden)
        #expect(model.invocationPoint == nil)
        #expect(model.draft == "")
    }

    @Test func rejectedTransitionLeavesStateUnchanged() {
        let model = RemoraUIModel()
        #expect(model.apply(.working(command: "x", step: "s", progress: 0.5)) == false)
        #expect(model.state == .hidden)
    }

    @Test func editingLocksAfterSubmit() {
        let model = RemoraUIModel()
        model.showReady(at: .zero, frontmostApp: nil)
        #expect(model.isEditingLocked == false)
        model.draft = "do a thing"
        _ = model.submitDraft()
        #expect(model.isEditingLocked)
    }

    @Test func retryReusesFailedCommand() {
        let model = RemoraUIModel()
        model.showReady(at: .zero, frontmostApp: nil)
        model.draft = "run"
        _ = model.submitDraft()
        model.applyFailed(command: "run", message: "boom")
        #expect(model.beginRetry() == "run")
        #expect(model.state == .submitting(command: "run"))
    }

    @Test func retryFromNonFailedStateIsRejected() {
        let model = RemoraUIModel()
        model.showReady(at: .zero, frontmostApp: nil)
        #expect(model.beginRetry() == nil)
    }

    @Test func progressIsClamped() {
        let model = RemoraUIModel()
        model.showReady(at: .zero, frontmostApp: nil)
        model.applySubmitting(command: "c")
        model.applyWorking(command: "c", step: "s", progress: 5)
        if case .working(_, _, let progress) = model.state {
            #expect(progress == 1)
        } else {
            Issue.record("Expected working state")
        }
    }
}
