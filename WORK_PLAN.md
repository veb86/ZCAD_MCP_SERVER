# Issue #3 work plan

Objective: fully implement and verify issue #3 in PR #4. Fix the Windows
`npm run verify` failure without weakening lifecycle checks or removing features.

## Requirements and verification plan

- [x] Read issue #3, every comment and required sub-issue, PR #4 conversation,
  inline comments and reviews, repository guidance and latest merged PR #2.
  No comments, reviews, sub-issues or AGENTS.md apply.
- [x] Verify the prepared branch and upstream main ancestry; inspect lifecycle
  implementation, tests and documented Node.js Windows signal behavior.
- [x] Reproduce the incorrect zero-code assertion with the reported Windows exit
  tuple and run the original focused test on the available Linux host.
- [x] Correct lifecycle expectations: EOF must exit normally on all platforms;
  SIGTERM must exit normally on POSIX and report forced termination on Windows;
  invalid configuration must still fail without leaking its value.
- [x] Keep automated regression checks for exact exit code and signal, useful
  failure diagnostics, finite child lifetimes and complete child cleanup.
- [x] Explain the root cause and Windows graceful-stop option in README.
- [x] Run focused checks and `npm run verify` with logs saved to files. Record
  platform/version limits honestly; do not claim a native Windows run on Linux.
- [x] Review the full PR diff and refresh all feedback; commit atomic changes,
  push only issue-3-e7c41f4fd3bf, update PR #4 with reproduction and test evidence,
  retain `Fixes #3`, confirm clean status and upstream main ancestry, mark ready.

## Investigation and evidence

Issue reports Windows 10 / Node.js 24.13.1; only lifecycle assertion fails:
`tests/integration.test.mjs:162`, actual `null`, expected `0`.
Node's official child-process/process documentation specifies that Windows
`child.kill('SIGTERM')` terminates unconditionally, yielding a null exit code
and SIGTERM signal. It does not invoke the application's JavaScript handler.
The original test asserted zero for both EOF and SIGTERM, ignoring the signal.

No release workflows, other Actions workflows or PR checks exist in either
upstream or fork. No package release trigger/version change is necessary.
CI addition was not requested; owner may consider
https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md.

## Results

Linux / Node 26.13.0: original focused lifecycle check passed. The bounded
simulation in experiments/windows-sigterm.mjs reproduced the original line-162
`null !== 0` failure; the corrected test passed all three lifecycle subtests
under the same simulation. `npm run verify`: build + 30 tests passed, no skips
or failures (~6 seconds). No native Windows execution is claimed.

Logs: /tmp/issue-3-{npm-ci,baseline-build,baseline-lifecycle,windows-before,
windows-after,verify}.log. See docs/verification.md for permanent evidence,
expected exit tuples and repeatable automated verification commands.

Final review: all issue/PR feedback and sub-issues remain empty. The complete
PR diff was reviewed; application behavior and existing features are preserved.
Upstream main is an ancestor of this branch. PR #4 has its final title, cause,
reproduction, automated-check commands, evidence and positive `Fixes #3`
reference. It is ready for review and remains unmerged. No CI runs/checks exist.
