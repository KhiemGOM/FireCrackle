import {defineConfig} from "vitest/config";
export default defineConfig({test:{include:["scripts/fire-ai/row32/soul/integration.test.ts"],environment:"node",testTimeout:30000}});
