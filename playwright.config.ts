import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5178",
    headless: true,
    channel: "msedge",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5178 --strictPort",
    url: "http://127.0.0.1:5178",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "https://apchi-test.invalid",
      VITE_SUPABASE_ANON_KEY: "test-public-key",
    },
    timeout: 30000,
  },
});
