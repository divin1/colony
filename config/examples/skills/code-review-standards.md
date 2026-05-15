---
name: code-review-standards
description: Standards for reviewing code quality, security, and type safety
---

## Code Review Standards

When reviewing or writing code, apply these standards consistently.

### Security (always check)
- No SQL injection — use parameterised queries, never string concatenation
- No command injection — never pass unsanitised user input to shell commands
- No secrets or API keys committed to source — flag immediately
- No XSS vectors in HTML-rendering code

### TypeScript
- Strict mode must be on — no `any`, no `@ts-ignore` without a documented reason
- No non-null assertions (`!`) on values that could genuinely be undefined
- Validate all external input (user input, API responses, config files) at the boundary with Zod or equivalent

### Code quality
- Functions do one thing; if a function needs a long comment to explain what it does, split it
- No dead code — remove commented-out blocks, unused imports, and unreachable branches
- Error handling at system boundaries only — do not swallow errors silently
- Tests cover new behaviour; do not merge code that reduces test coverage

### Pull requests
- PR title is imperative and under 70 characters
- Body describes *why*, not *what* — the diff shows what changed
- Never approve your own PR
- Never force-push to a protected branch
