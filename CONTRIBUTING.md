# Contributing to Omnigent Cloudflare Containers Provider

Thank you for your interest in contributing! This is a community project that extends [Omnigent](https://github.com/omnigent-ai/omnigent) with Cloudflare Containers support.

## Getting Started

1. Fork the repository
2. Clone your fork
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feature/my-feature`

## Development

### Local Development

```bash
# Start dev server
npm run dev

# Run tests
npm test

# Lint
npm run lint
```

### Building the Host Image

```bash
# Build locally
npm run build

# Push to CF Container Registry
npm run push
```

## Submitting Changes

1. Ensure your code follows the project's style
2. Add tests for new functionality
3. Update documentation if needed
4. Commit with clear, descriptive messages
5. Push to your fork
6. Open a pull request

## Pull Request Guidelines

- Keep PRs focused on a single change
- Include a clear description of what changed and why
- Reference any related issues
- Ensure all tests pass
- Update README if adding new features

## Code Style

- Use standard JavaScript/TypeScript conventions
- Follow existing patterns in the codebase
- Keep functions small and focused
- Add comments for complex logic

## Reporting Issues

- Use GitHub Issues for bug reports
- Include steps to reproduce
- Include expected vs actual behavior
- Include environment details (OS, Node version, etc.)

## Security

- Never commit secrets or API keys
- Use Cloudflare Secrets for sensitive values
- Report security issues privately to security@omnigent.ai

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
