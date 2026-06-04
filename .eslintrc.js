module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*", // Ignore built files.
    "*.js", // Ignore JS files like jest.config.js and scripts
    "scripts/**/*", // Ignore scripts directory
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  rules: {
    "quotes": ["error", "double"],
    "import/no-unresolved": 0,
    "indent": ["error", 2],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "max-len": ["error", { "code": 100 }],
  },
  overrides: [
    {
      // New architecture folders - enforce snake_case naming convention
      files: [
        "src/functions/entry/**/*.ts",
        "src/functions/orchestrators/**/*.ts",
        "src/functions/resolvers/**/*.ts",
        "src/functions/domain/**/*.ts",
        "src/functions/repositories/**/*.ts",
        "src/functions/dependencies/**/*.ts",
        "src/functions/events/**/*.ts",
        "src/functions/jobs/**/*.ts",
        "src/functions/observability/**/*.ts",
        "src/functions/infrastructure/**/*.ts",
        "src/functions/types/**/*.ts",
      ],
      rules: {
        "@typescript-eslint/naming-convention": [
          "error",
          // Variables: snake_case (allow UPPER_CASE for constants)
          {
            selector: "variable",
            format: ["snake_case", "UPPER_CASE"],
            leadingUnderscore: "allow",
          },
          // Functions: snake_case
          {
            selector: "function",
            format: ["snake_case"],
          },
          // Parameters: snake_case
          {
            selector: "parameter",
            format: ["snake_case"],
            leadingUnderscore: "allow",
          },
          // Object/class properties: snake_case
          {
            selector: "property",
            format: ["snake_case", "UPPER_CASE"],
          },
          // Type properties (interface/type members): snake_case
          {
            selector: "typeProperty",
            format: ["snake_case"],
          },
          // Types, Interfaces, Classes, Enums: PascalCase
          {
            selector: "typeLike",
            format: ["PascalCase"],
          },
          // Enum members: UPPER_CASE
          {
            selector: "enumMember",
            format: ["UPPER_CASE"],
          },
        ],
      },
    },
  ],
};