import { defineConfig } from "vitest/config";
export default defineConfig({test:{include:["scripts/joltBenchmark.test.ts"],environment:"node"}});
