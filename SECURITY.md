# Security Policy

SilentCart handles payment detection, digital fulfillment, and temporary delivery identity linkage. Please report security issues responsibly.

## Supported Versions

Security fixes are intended for:

- the latest development branch
- the newest tagged release, when releases exist

Older snapshots may not receive backported fixes.

## Reporting A Vulnerability

Please do not post exploit details in a public issue.

This repository should not actively solicit private security reports until the maintainer publishes a private reporting channel on the public repository front page, profile, or release notes.

If you are the maintainer preparing a public launch, publish one of these before inviting reports:

- a dedicated security email address
- a private issue intake workflow
- a clearly monitored contact method on the repository profile

Until that channel exists, do not disclose sensitive exploit details in public issues.

When reporting, include:

- affected version or commit
- impact summary
- reproduction steps
- whether sensitive data or payment integrity is affected
- any suggested fix or mitigation

## What We Care About Most

Please prioritize reports involving:

- admin authorization bypass
- duplicate fulfillment or double license allocation
- payment-detection integrity
- retention-link leaks or failure to purge
- plaintext storage or logging of sensitive payloads
- replay or callback tampering in Telegram flows
- Docker or deployment defaults that create unsafe exposure

## Disclosure Expectations

- We will try to confirm receipt quickly once a private channel exists
- We prefer coordinated disclosure after a fix or mitigation is ready
- Please avoid publishing working exploit details before maintainers have time to respond
