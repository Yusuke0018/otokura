// ESLint flat config for Otokura (only lint project JS files)
export default [
  {
    files: ["src/js/**/*.js", "sw.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        indexedDB: "readonly",
        IDBKeyRange: "readonly",
        caches: "readonly",
        location: "readonly",
        self: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        alert: "readonly",
        confirm: "readonly",
        crypto: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-constant-condition": ["warn", { checkLoops: false }],
    },
  },
];

