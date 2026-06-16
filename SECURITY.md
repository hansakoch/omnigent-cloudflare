# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please open a GitHub issue or contact the maintainer directly. All security vulnerabilities will be promptly addressed.

Please include the following information in your report:

- Type of issue (e.g. buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit the issue

## Security Considerations

### Cloudflare Secrets

Never commit API keys, tokens, or other secrets to the repository. Use Cloudflare Secrets instead:

```bash
npx wrangler secret put SERVER_URL
npx wrangler secret put OMNIGENT_HOST_TOKEN
```

### Container Isolation

Each sandbox runs in its own Firecracker microVM, providing strong isolation between sessions. However:

- Containers share the same CF Worker endpoint
- Network traffic between containers and the server is encrypted (TLS)
- Tokens are per-launch and expire with the session

### Token Management

- Use short-lived tokens when possible
- Rotate tokens regularly
- Monitor container logs for unauthorized access attempts
- Revoke compromised tokens immediately

### Network Security

- All communication uses TLS/HTTPS
- WebSocket connections are encrypted end-to-end
- Containers can only reach the configured server URL
- No inbound connections to containers (outbound only)

## Scope

This security policy applies to:

- The Cloudflare Worker code in `src/index.js`
- The Dockerfile and host image configuration
- The host boot script

It does NOT apply to:

- The Omnigent server itself (see [Omnigent's security policy](https://github.com/omnigent-ai/omnigent/blob/main/SECURITY.md))
- Third-party services (Cloudflare, LLM providers)
- User-generated code or configurations

## Updates

Security updates will be released as patch versions and announced in:

- GitHub Releases
- The Omnigent Discord
- Email notifications to maintainers
