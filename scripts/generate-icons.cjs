// ============================================================
// generate-icons.cjs — Generate all PWA + favicon sizes
// Usage: node scripts/generate-icons.cjs
// ============================================================
const sharp = require("sharp");
const path  = require("path");
const fs    = require("fs");

const SRC    = path.resolve(__dirname, "../public/robinos-logo-new.png");
const OUTDIR = path.resolve(__dirname, "../public");

if (!fs.existsSync(SRC)) {
  console.error("❌  Source not found:", SRC);
  process.exit(1);
}

const icons = [
  // PWA maskable + any
  { file: "pwa-512x512.png",           size: 512, pad: false },
  { file: "pwa-192x192.png",           size: 192, pad: false },
  // Android Chrome
  { file: "android-chrome-512x512.png",size: 512, pad: false },
  { file: "android-chrome-192x192.png",size: 192, pad: false },
  // Apple touch icon — 180×180, slight padding looks better on iOS
  { file: "apple-touch-icon.png",      size: 180, pad: true  },
];

async function run() {
  console.log("🎨  Generating icons from:", SRC, "\n");

  for (const { file, size, pad } of icons) {
    const out = path.join(OUTDIR, file);
    let pipeline = sharp(SRC).resize(size, size, {
      fit: pad ? "contain" : "cover",
      background: pad ? { r: 11, g: 18, b: 32, alpha: 1 } : undefined, // #0b1220
    });

    await pipeline.png({ compressionLevel: 9 }).toFile(out);
    console.log(`  ✅  ${file.padEnd(30)} ${size}×${size}`);
  }

  // Generate robinos.ico from source (32×32 PNG for browsers)
  const icoSrc = path.join(OUTDIR, "__tmp-robinos-32.png");
  await sharp(SRC).resize(32, 32, { fit: "cover" }).png({ compressionLevel: 9 }).toFile(icoSrc);
  const icoOut = path.join(OUTDIR, "robinos.ico");
  fs.copyFileSync(icoSrc, icoOut);
  fs.unlinkSync(icoSrc);
  console.log(`  ✅  robinos.ico                    (32×32 PNG)`);

  console.log("\n✨  All icons generated successfully.");
}

run().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
