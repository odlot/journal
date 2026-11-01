# Workflow rules

- Every change must be made in its own git worktree. Never edit files directly in the main checkout.
- Each task gets its own branch and its own pull request. Do not bundle unrelated tasks into one PR.

# Development status

- The application is under active development. Breaking API changes are acceptable, and backwards compatibility is never required.
- Do not add migration paths, compatibility shims, or deprecated aliases; change things directly.