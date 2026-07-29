/** @type {import("next").NextConfig} */
const nextConfig = {
  // PDF.js performs runtime feature detection and loads its own worker module.
  // Bundling it into a Next.js server chunk rewrites those module boundaries
  // and crashes in production with "Object.defineProperty called on non-object".
  // Keep the document-processing stack as native Node dependencies.
  serverExternalPackages: [
    "pdfjs-dist",
    "pdf-to-img",
    "tesseract.js",
    "tesseract.js-core",
  ],
};

export default nextConfig;
