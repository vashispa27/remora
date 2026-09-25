import Foundation

/// Abstraction over time so the mock driver can be tested deterministically.
public protocol RemoraSleeping: Sendable {
    func sleep(for duration: Duration) async throws
}

/// Production sleeper backed by the continuous clock.
public struct ContinuousRemoraSleeper: RemoraSleeping {
    public init() {}
    public func sleep(for duration: Duration) async throws {
        try await Task.sleep(for: duration)
    }
}

/// Returns immediately but still honours cooperative cancellation. Useful for tests
/// that only assert ordering of emitted events.
public struct ImmediateRemoraSleeper: RemoraSleeping {
    public init() {}
    public func sleep(for duration: Duration) async throws {
        try Task.checkCancellation()
    }
}

/// A sleeper that suspends until a test explicitly releases or cancels it. Only one
/// sleep is pending at a time, which matches the sequential mock run.
public actor ManualRemoraSleeper: RemoraSleeping {
    private var pendingContinuation: CheckedContinuation<Void, Error>?
    private var requestCount = 0
    private var requestWaiters: [CheckedContinuation<Void, Never>] = []

    public init() {}

    public func sleep(for duration: Duration) async throws {
        requestCount += 1
        resumeRequestWaiters()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                pendingContinuation = continuation
            }
        } onCancel: {
            Task { await self.failPending() }
        }
    }

    /// Resumes the pending sleep successfully.
    public func release() {
        let continuation = pendingContinuation
        pendingContinuation = nil
        continuation?.resume()
    }

    /// Resumes the pending sleep with a cancellation error.
    public func failPending() {
        let continuation = pendingContinuation
        pendingContinuation = nil
        continuation?.resume(throwing: CancellationError())
    }

    /// Waits until at least `count` sleeps have been requested.
    public func waitForRequestCount(_ count: Int) async {
        if requestCount >= count { return }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            requestWaiters.append(continuation)
        }
    }

    private func resumeRequestWaiters() {
        let waiters = requestWaiters
        requestWaiters.removeAll()
        for waiter in waiters { waiter.resume() }
    }
}
