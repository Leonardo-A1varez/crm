/**
 * Conventional Commits enforcement.
 * AGENTS.md §4 dice: feat/fix/chore/refactor/test/docs/perf. Subject ≤50 chars, español.
 * Permitimos `build`, `ci`, `revert`, `style` para cubrir CI workflows + reverts.
 */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "chore",
        "refactor",
        "test",
        "docs",
        "perf",
        "build",
        "ci",
        "revert",
        "style",
      ],
    ],
    "subject-case": [0], // español permite mixed case
    "subject-max-length": [2, "always", 72], // 72 estándar git, 50 ideal
    "body-max-line-length": [2, "always", 100],
    "footer-max-line-length": [2, "always", 100],
  },
};
