import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Fixed port + strictPort: tauri.conf.json's `build.devUrl` points here, so a silent
// port fallback would leave the shell staring at a dead origin instead of failing fast.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
