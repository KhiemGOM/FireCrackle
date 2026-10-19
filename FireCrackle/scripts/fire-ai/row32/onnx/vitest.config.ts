import {defineConfig} from "vitest/config";
export default defineConfig({test:{include:["scripts/fire-ai/row32/onnx/frontend.test.ts"],environment:"node"}});
