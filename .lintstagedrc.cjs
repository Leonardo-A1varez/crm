/**
 * Ejecutado por lefthook pre-commit. Solo staged files.
 * Re-stage cuando lint:fix / prettier modifican (stage_fixed: true en lefthook.yml).
 */
module.exports = {
  "*.{ts,tsx,js,jsx,mjs,cjs}": ["eslint --fix --max-warnings=0", "prettier --write"],
  "*.{json,md,yml,yaml,css}": ["prettier --write"],
};
