import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Apchi",
        short_name: "Apchi",
        description: "Мессенджер для общения, друзей и личных заметок.",
        lang: "ru",
        start_url: "/chats",
        scope: "/",
        display: "standalone",
        background_color: "#f1ebe1",
        theme_color: "#f1ebe1",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: { globPatterns: ["**/*.{js,css,html,svg,png,ico}"] },
    }),
  ],
  server: {
    host: "127.0.0.1",
  },
});
