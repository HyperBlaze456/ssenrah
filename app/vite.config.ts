import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Prevent vite from obscuring Rust errors
  clearScreen: false,

  server: {
    // Tauri expects a fixed port; fail if that port is not available
    port: 1420,
    strictPort: true,
    // Tauri v2 on mobile needs the host to be 0.0.0.0
    host: "0.0.0.0",
  },

  // Env variables starting with TAURI_ are exposed to the client
  envPrefix: ["VITE_", "TAURI_"],

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari14",
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
  },
});
