# Discoveries

## PKCE required on public clients

<!-- id: 11111111-1111-4111-8111-111111111111 | created: 2026-09-07T00:00:00.000Z | source: claude-code -->

The token endpoint rejects public clients that omit PKCE. Store the verifier in session storage for the callback.
