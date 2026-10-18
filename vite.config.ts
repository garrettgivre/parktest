import { defineConfig } from "vite";

// Relative base so the build works from a GitHub Pages sub-path.
// index.html = gameplay test, spike.html = Blender art spike.
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: { input: { main: "index.html", spike: "spike.html" } },
  },
});
