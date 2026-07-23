import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const compat = new FlatCompat({ baseDirectory: currentDir });

export default [
  {
    ignores: [".next/**", "node_modules/**", "venv/**"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];
