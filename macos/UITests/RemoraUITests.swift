import XCTest

// These UI tests require an Xcode installation and an app-host target. They are kept
// here as reviewable artifacts and are not compiled by Swift Package Manager, which
// cannot host XCUITest. See macos/README.md for how to run them.
//
// The views expose accessibility identifiers and labels so these queries remain stable.

final class RemoraUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
    }

    override func tearDown() {
        app.terminate()
    }

    private func invokeRemora() {
        // The global shortcut is registered through Carbon; XCUITest cannot synthesize a
        // system-wide hot key, so the menu path is used for determinism.
        let statusItem = app.statusItems.firstMatch
        XCTAssertTrue(statusItem.waitForExistence(timeout: 5))
        statusItem.click()
        app.menuItems["Show Remora"].click()
    }

    func testInvokeTypeSubmitAndFinish() {
        invokeRemora()

        let taskField = app.textViews["Task description"]
        XCTAssertTrue(taskField.waitForExistence(timeout: 5))
        taskField.click()
        taskField.typeText("Create a DynamoDB table")

        app.buttons["Run task"].click()

        XCTAssertTrue(app.staticTexts["Remora is working"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Done"].waitForExistence(timeout: 10))
    }

    func testCancelDuringWork() {
        invokeRemora()

        let taskField = app.textViews["Task description"]
        XCTAssertTrue(taskField.waitForExistence(timeout: 5))
        taskField.click()
        taskField.typeText("open settings")
        app.buttons["Run task"].click()

        XCTAssertTrue(app.staticTexts["Remora is working"].waitForExistence(timeout: 5))
        app.buttons["Stop task"].click()
        XCTAssertTrue(app.staticTexts["Stopped"].waitForExistence(timeout: 5))
    }

    func testEscapeDismissesReadyPanel() {
        invokeRemora()
        XCTAssertTrue(app.textViews["Task description"].waitForExistence(timeout: 5))
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertFalse(app.textViews["Task description"].waitForExistence(timeout: 2))
    }

    func testRepeatedInvocationKeepsSinglePanel() {
        invokeRemora()
        XCTAssertTrue(app.textViews["Task description"].waitForExistence(timeout: 5))

        let statusItem = app.statusItems.firstMatch
        statusItem.click()
        app.menuItems["Show Remora"].click()

        XCTAssertEqual(app.textViews.matching(identifier: "Task description").count, 1)
    }
}
