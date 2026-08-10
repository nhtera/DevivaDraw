# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in Deviva Draw, please report it
privately rather than opening a public issue.

- Use GitHub's [private vulnerability reporting](https://github.com/nhtera/DevivaDraw/security/advisories/new)
  ("Report a vulnerability" under the repository's **Security** tab), or
- Email the maintainers via the contact listed on [deviva.app](https://deviva.app/).

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (a proof of concept if possible).
- Affected package(s) and version(s).

We'll acknowledge your report, investigate, and keep you updated on the fix and
disclosure timeline.

## Scope notes

Two areas are security-sensitive by design:

- **End-to-end-encrypted share links.** The decryption key lives only in the URL
  fragment (`#…`) and is never sent to the server. The collab-server stores only
  the encrypted blob in R2.
- **Live collaboration.** The session key is exchanged out-of-band via the room
  URL and never transmitted to the Durable Object; the server relays ciphertext.

Reports that these guarantees can be broken are especially valuable.

## Supported versions

Deviva Draw is pre-1.0. Security fixes are applied to the latest published
version of each `@deviva-draw/*` package.
