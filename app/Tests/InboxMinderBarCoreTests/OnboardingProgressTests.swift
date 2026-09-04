import XCTest

@testable import InboxMinderBarCore

final class OnboardingProgressTests: XCTestCase {
    func doc(
        config: Bool = false, llmKey: Bool = false, gmailClient: Bool = false,
        gmailTokens: Bool = false, agent: Bool = false
    ) -> SetupStatusDoc {
        SetupStatusDoc(
            config: config, llmKey: llmKey, gmailClient: gmailClient,
            gmailTokens: gmailTokens, agent: agent)
    }

    func testResumePointIsTheFirstUnmetCondition() {
        XCTAssertEqual(OnboardingProgress.firstUnmet(doc()), .llm)
        XCTAssertEqual(
            OnboardingProgress.firstUnmet(doc(config: true, llmKey: true)),
            .gmail)
        XCTAssertEqual(
            OnboardingProgress.firstUnmet(
                doc(config: true, llmKey: true, gmailClient: true)),
            .authorize)
        XCTAssertEqual(
            OnboardingProgress.firstUnmet(
                doc(
                    config: true, llmKey: true, gmailClient: true,
                    gmailTokens: true)),
            .goLive)
        XCTAssertEqual(
            OnboardingProgress.firstUnmet(
                doc(
                    config: true, llmKey: true, gmailClient: true,
                    gmailTokens: true, agent: true)),
            .done)
    }

    func testHalfStatesHealThroughTheLLMStep() {
        // Config without key, key without config: both re-run .llm,
        // which rewrites both sides.
        XCTAssertEqual(
            OnboardingProgress.firstUnmet(doc(config: true)), .llm)
        XCTAssertEqual(
            OnboardingProgress.firstUnmet(doc(llmKey: true)), .llm)
    }

    func testAutoOpenOnlyOnAFreshProfile() {
        XCTAssertTrue(
            OnboardingProgress.isNeeded(
                configExists: false, agentPlistExists: false))
        XCTAssertFalse(
            OnboardingProgress.isNeeded(
                configExists: true, agentPlistExists: false))
        XCTAssertFalse(
            OnboardingProgress.isNeeded(
                configExists: false, agentPlistExists: true))
    }

    func testDecodeTakesTheLastParsableLine() {
        let raw = """
            some warning line
            {"config":true,"llmKey":true,"gmailClient":false,"gmailTokens":false,"agent":false}
            """
        let doc = SetupStatusDoc.decode(raw)
        XCTAssertEqual(doc?.config, true)
        XCTAssertEqual(doc?.gmailClient, false)
        XCTAssertNil(SetupStatusDoc.decode("no json here"))
    }
}
