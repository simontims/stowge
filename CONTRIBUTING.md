# Contributing

Thanks for contributing to Stowge.

## Before you start

- Read [ARCHITECTURE.md](ARCHITECTURE.md) for the current system design.
- Follow [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) to set up and run the project.
- Check [ROADMAP.md](ROADMAP.md) for planned work.
- Follow [ui/UI_CONVENTIONS.md](ui/UI_CONVENTIONS.md) for frontend actions, colors, and button styles.

## Workflow

1. Create a focused branch for the change.
2. Keep implementation and documentation changes scoped to one purpose.
3. Add or update tests for changed behavior.
4. Run the relevant API and UI validation commands from the development guide.
5. Regenerate external API artifacts when changing the integrator API.
6. Open a pull request describing the change and how it was validated.

Use Conventional Commit prefixes for commit messages, such as `feat:`, `fix:`, `docs:`, `ui:`, or `ci:`.

## Pull requests

Complete the repository pull request template. CI checks generated API documentation, Python linting and tests, and UI linting, tests, and production builds.

Keep pull requests reviewable and avoid unrelated refactoring. Update [ARCHITECTURE.md](ARCHITECTURE.md) when a change alters the documented system structure or a significant architectural decision.