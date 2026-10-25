# Using AI Safely and Responsibly in Software Development

> **"AI delivers the code. I take the accountability."**
>
> Everything in this guide follows from that sentence. The assistant can write, debug and suggest, but every line that ships is mine: I understand it, I can defend it, and I answer for it.

This is how I work with AI assistants on this project and my others. It's based on practices from
[mattpocock/skills](https://github.com/mattpocock/skills) (`diagnosing-bugs`, `grill-me`) and
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (`security-and-hardening`).

## Contents

1. [The mindset: I am the engineer of record](#1-the-mindset-i-am-the-engineer-of-record)
2. [Before writing code: get grilled on the plan](#2-before-writing-code-get-grilled-on-the-plan)
3. [Security: threat model first, then guardrails](#3-security-threat-model-first-then-guardrails)
4. [Secrets and personal data in an AI workflow](#4-secrets-and-personal-data-in-an-ai-workflow)
5. [Dependencies: don't let the AI pick the supply chain](#5-dependencies-dont-let-the-ai-pick-the-supply-chain)
6. [Debugging with AI: build the loop before the theory](#6-debugging-with-ai-build-the-loop-before-the-theory)
7. [If the app itself uses AI](#7-if-the-app-itself-uses-ai)
8. [Excuses to recognise and reject](#8-excuses-to-recognise-and-reject)
9. [Checklist](#9-checklist)

## 1. The mindset: I am the engineer of record

An AI assistant is a very fast collaborator. It is not a reviewer, a security team or a substitute for judgment. I treat what it produces like a pull request from a capable colleague I've never worked with: probably good, never merged unread.

- **Decisions are mine, facts are the AI's.** The assistant gathers facts from the codebase and docs. Architecture, scope, security trade-offs and anything irreversible stay with me.
- **AI output is untrusted input.** Trust follows who *wrote* a value, not which channel delivered it. Generated code, commands and package names get the same scrutiny as data from a stranger.
- **Evidence over plausibility.** "It looks right" is not done. Done is a test that went red and then green, an audit that ran, a check I actually performed.
- **Nothing sensitive goes into the context.** Secrets, credentials and personal data stay out of prompts, logs and pasted output.

## 2. Before writing code: get grilled on the plan

Most bad AI-assisted code starts with a vague request that the assistant fills with silent assumptions. The `grill-me` approach reverses that: before building anything, the assistant interviews **me** until the plan is fully understood.

- **Map the plan as a design tree.** Every decision branches into the decisions that depend on it (choice of database → migration strategy → rollback plan).
- **Work in rounds.** Each round, the assistant asks every question that can be answered *now* (the "frontier"), numbers them and gives a recommended answer. I confirm or correct, and the frontier moves outward.
- **Don't ask for what can be looked up.** Facts from files, tools or docs are the assistant's job. Only real decisions come to me.
- **No building until there is shared understanding.** The session ends when every branch has been visited and nothing is left silently assumed, and I explicitly confirm.

> **How I use it:** *"Before you write any code, interview me about this feature. Ask in numbered rounds, recommend an answer for each, and don't start until I confirm we agree."*

## 3. Security: threat model first, then guardrails

Security isn't a phase. It is a constraint on every line that touches user data, authentication or external systems. Controls added without a threat model are guesses.

### 3.1 Five-minute threat model (before asking the AI to implement)

1. **Map the trust boundaries.** Where does untrusted data enter? HTTP requests, forms, uploads, webhooks, third-party APIs, queues and **LLM output**, plus values that only look internal: filenames, environment variables, job payloads.
2. **Name the assets.** Credentials, personal data, payment data, admin actions, money movement.
3. **Run STRIDE over each boundary.**
4. **Write abuse cases next to use cases.** For every feature, ask "how would I misuse this?" and make that the first test.

| Threat | Ask | Typical mitigation |
|---|---|---|
| **S**poofing | Can someone impersonate a user or service? | Authentication, signature verification |
| **T**ampering | Can data be altered in transit or at rest? | Integrity checks, parameterized queries, HTTPS |
| **R**epudiation | Can an action be denied later? | Audit logging of security events |
| **I**nformation disclosure | Can data leak? | Encryption, field allowlists, generic errors |
| **D**enial of service | Can it be overwhelmed? | Rate limiting, input size caps, timeouts |
| **E**levation of privilege | Can a user gain rights they shouldn't? | Authorization checks, least privilege |

If I can't name the trust boundaries for a feature, I'm not ready to secure it, and neither is the AI.

### 3.2 The three-tier boundary system: rules for the assistant

These tiers belong in the project's AI instructions (for example `CLAUDE.md`) so the assistant follows them every session. The middle tier needs **my** approval.

| ✅ Always do | ⚠️ Ask first (human approval) | ⛔ Never do |
|---|---|---|
| Validate all external input at the boundary | New or changed authentication logic | Commit secrets |
| Parameterize every database query | Storing new kinds of sensitive data | Log passwords, tokens or card numbers |
| Encode output (framework auto-escaping) | New external integrations | Trust client-side validation |
| HTTPS for all external traffic | CORS changes | Disable security headers for convenience |
| Hash passwords (bcrypt / scrypt / argon2) | File upload handlers | `eval()` / `innerHTML` with user data |
| Security headers (CSP, HSTS, …) | Rate-limit changes | Auth tokens in localStorage |
| httpOnly, secure, sameSite cookies | Granting elevated roles or permissions | Expose stack traces to users |
| Run the package manager's audit before every release | | |

### 3.3 What to check in AI-generated code

- **Injection and XSS:** no SQL, NoSQL or shell commands built from strings; no raw HTML without an allowlist sanitizer.
- **Authorization, not just authentication:** every request checks that *this* user may access *this* resource (IDOR, OWASP A01).
- **Input validation:** schema validation at the boundary (shape, lengths, enums); downstream code uses only the parsed value.
- **Server-side fetches (SSRF):** user-influenced URLs are allowlisted by scheme and host, private and internal addresses rejected, redirects forbidden.
- **Destructive operations:** deletes and overwrites on derived paths need a resolved path under an allowlisted root, at least one level below it, with ownership verified first. Never fall back to a broader default.
- **Errors and responses:** generic error bodies; strip sensitive fields such as password hashes and reset tokens.
- **Rate limiting:** strict on authentication endpoints, backed by a shared store when more than one instance runs.

## 4. Secrets and personal data in an AI workflow

> **The prompt is a publication channel.** Anything pasted into an assistant (logs, configs, HTTP traces, database rows) leaves the machine. Treat it like sending data to a third party, because it is.

- **Redact before sharing.** Replace every secret with `<REDACTED>` and quote only the lines that carry the signal. Captured requests carry auth headers.
- **Keep credentials in environment variables**, so scripts reference `$API_KEY` rather than the value. Commit `.env.example` with placeholders, gitignore real `.env` files, grep the staged diff before committing.
- **A secret that reaches a remote is compromised.** Rotate it first, then purge history. Deleting the commit is not enough.
- **Personal data is a liability.** Collect only for a stated purpose, classify fields as they're added, set retention up front, and make export and deletion actually work, including backups, caches and analytics copies.
- **Sending personal data to an LLM vendor is sharing.** It needs consent and a data-processing agreement (GDPR / CCPA). Use synthetic or anonymized data when working with the assistant.

## 5. Dependencies: don't let the AI pick the supply chain

Assistants suggest packages confidently. A suggestion can be outdated, unmaintained, or a near-miss name a typosquatter registered (`cross-env` vs `crossenv`). Every new dependency is my decision.

- **Review each new package** before installing: ownership, maintenance, release age, provenance, transitive dependencies. Review new dependencies, lockfile diffs and script-policy changes together.
- **Block install scripts before first run.** Install with scripts disabled, inspect what wants to run, approve the minimum. Never blanket-approve.
- **Run the native audit** (`npm audit`, `pnpm audit`, `dotnet list package --vulnerable`, …) against the committed lockfile before every release. Triage by reachability.
- **Never auto-apply forced fixes** such as `npm audit fix --force`. Preview, read changelogs, test each upgrade. Document every deferral with a reason and a review date.
- **Know the limit:** audits only match *known* advisories. A passing audit doesn't prove a new package is safe. Verify registry signatures where supported.

## 6. Debugging with AI: build the loop before the theory

The most common AI debugging failure is jumping to a plausible explanation and "fixing" the wrong thing. The `diagnosing-bugs` discipline:

1. **Build a feedback loop.** One command that goes **red on this exact bug**: a failing test, a curl script, a CLI call diffed against a snapshot, a headless browser script. Red-capable, deterministic, fast, runnable unattended. *No loop, no hypothesis.*
2. **Reproduce and minimise.** Confirm the loop shows the failure that was actually reported, not a nearby one. Cut inputs and steps one at a time until every remaining element is needed.
3. **Hypothesise.** 3–5 ranked, falsifiable hypotheses: "If X is the cause, then changing Y makes the bug disappear." Review the list before testing.
4. **Instrument.** One variable at a time. Prefer a debugger; otherwise targeted logs tagged with a unique prefix like `[DEBUG-a4f2]`. For performance, measure a baseline first.
5. **Fix and add a regression test** at a seam that exercises the real bug pattern: watch it fail, fix, watch it pass, re-run the original loop.
6. **Clean up.** Remove tagged debug logs (one grep), delete throwaway harnesses, record the confirmed cause in the commit or PR message.

When someone asks "how do you know it's fixed?", I can point to a command that failed before and passes now, not to the assistant's confidence.

## 7. If the app itself uses AI

LLM features (chatbots, summarizers, agents, RAG) map to the [OWASP Top 10 for LLM Applications (2025)](https://genai.owasp.org/llm-top-10/):

- **Model output is untrusted input (LLM05).** Never into `eval`, SQL, a shell, `innerHTML` or a file path. Validate against a schema, then encode.
- **Prompts can be hijacked (LLM01).** A user message, fetched page or PDF can carry instructions. The system prompt is not a security boundary; enforce permissions in code.
- **Keep secrets, other tenants' data and the full system prompt out of the context (LLM02, LLM07).**
- **Scope tool permissions (LLM06).** Validate every tool argument; confirm destructive actions.
- **Cap tokens, request rate and recursion depth (LLM10).** Partition RAG data per tenant and validate documents before indexing (LLM08).

## 8. Excuses to recognise and reject

| Rationalization | Reality |
|---|---|
| "The AI wrote it, so it's probably fine." | Its code is untrusted input until I've read, tested and understood it. I sign off, so I verify. |
| "It's an internal tool, security doesn't matter." | Internal tools get compromised. Attackers target the weakest link. |
| "We'll add security later." | Retrofitting security is far harder than building it in. |
| "It's just a prototype." | Prototypes become production. Keep the habits from day one. |
| "The framework handles security." | Frameworks provide tools, not guarantees. |
| "It's just LLM output, it's only text." | That text can be a SQL statement, a script tag or a shell command. |
| "The audit passed, so the dependency is safe." | Audits match known advisories only. They don't catch new malicious packages. |
| "Collect it now, we might need it later." | Data you don't hold can't be breached. "Might need it" is breach scope, not a purpose. |
| "I found the bug, the explanation makes sense." | Without a loop that went red and then green, it's a theory, not a fix. |

## 9. Checklist

**Before coding**
- [ ] Plan reviewed in "grill me" rounds; every decision confirmed, nothing silently assumed
- [ ] Trust boundaries and assets named; STRIDE run; abuse cases written as first tests
- [ ] Always / Ask first / Never tiers written into the project's AI instructions

**While coding with AI**
- [ ] No secrets, credentials or real personal data in prompts; logs redacted
- [ ] Every generated change read and understood before accepting it
- [ ] "Ask first" changes (auth, CORS, uploads, roles, new integrations) explicitly approved
- [ ] Every new dependency reviewed by name, owner and age; install scripts blocked by default

**Before merging or releasing**
- [ ] Input validated at boundaries; queries parameterized; output encoded
- [ ] Authentication and authorization checked on every protected endpoint
- [ ] Security headers present; errors generic; no stack traces exposed
- [ ] Rate limiting on auth endpoints; SSRF allowlist on server-side fetches
- [ ] Native dependency audit run; no unmitigated reachable critical/high findings
- [ ] No secrets in source or git history
- [ ] LLM output validated and encoded before use (if AI features exist)
- [ ] Personal data minimised, with retention and working export / deletion

**After a bug fix**
- [ ] Feedback loop went red before the fix and green after
- [ ] Regression test added (or the missing seam documented)
- [ ] All `[DEBUG-...]` logs and throwaway code removed
- [ ] Root cause written in the commit / PR message

---

**AI delivers the code. I take the accountability.**

<sub>Sources: mattpocock/skills (MIT): `skills/engineering/diagnosing-bugs`, `skills/productivity` (grill-me). addyosmani/agent-skills (MIT): `skills/security-and-hardening`. OWASP Top 10 for LLM Applications (2025).</sub>
