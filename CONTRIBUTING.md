# Contributing

Thanks for contributing to `int-vml-core`. This guide covers local setup, commit messages, and pull requests.

## Getting started

```bash
pnpm install
pnpm dev
```

Useful commands:

```bash
pnpm lint       # ESLint
pnpm typecheck  # TypeScript, no emit
pnpm format     # Prettier
pnpm build      # Production build
```

Before opening a pull request, make sure `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass.

## Commit message guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/). Every commit message should follow this structure:

```text
<type>(<scope>): <subject>

<body>

<footer>
```

### Type

Use one of the following types:

| Type       | Use for                                              |
| ---------- | ---------------------------------------------------- |
| `feat`     | A new feature                                        |
| `fix`      | A bug fix                                            |
| `docs`     | Documentation only                                  |
| `style`    | Formatting or whitespace, no behavior change        |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`     | A performance improvement                            |
| `test`     | Adding or updating tests                             |
| `build`    | Build system or dependency changes                   |
| `ci`       | CI configuration changes                             |
| `chore`    | Maintenance tasks                                    |
| `revert`   | Reverting a previous commit                          |

### Scope

Optional, but useful for larger changes. Use the area of the codebase affected, for example `components`, `ui`, `hooks`, `lib`, or `app`.

### Subject

- Use the imperative mood: "add button", not "added button" or "adds button".
- Start with a lowercase letter and do not end with a period.
- Keep it under about 72 characters.
- Describe what the change does, not how you did it.

### Body

Add a body when the change is not self-explanatory. Explain the motivation and any notable decisions. Wrap lines at about 72 characters.

### Footer

Reference issues and note breaking changes here:

```text
Closes #123
BREAKING CHANGE: <what changed and how to migrate>
```

### Examples

```text
feat(ui): add theme switcher to header
fix(hooks): prevent double subscription on remount
docs: document component import conventions
refactor(lib): extract date formatting helper
```

## Pull request guidelines

### Title

Use the same conventional format as commits, for example:

```text
feat(ui): add theme switcher
```

### Description

Describe the change clearly and concisely. A good description includes:

- **Summary** — what the PR does and why.
- **Changes** — the main changes, especially non-obvious ones.
- **Testing** — how you verified the change (commands run, manual checks).
- **Screenshots** — before/after images for visual changes.
- **Related issues** — use `Closes #123` to link issues.

### Checklist

Before requesting review, confirm that:

- [ ] The PR is focused on a single concern.
- [ ] `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass.
- [ ] Existing behavior is preserved unless the PR intends to change it.
- [ ] Documentation (including `README.md`) is updated when needed.
- [ ] New or changed UI has been checked at relevant screen sizes.
- [ ] No unrelated changes, debugging code, or generated files are included.

### Review

- Keep review conversations focused and resolve threads once addressed.
- Prefer follow-up PRs over expanding the scope of an open one.
- Squash or rebase as needed to keep history clean; avoid merge commits from `main` inside a feature branch.
