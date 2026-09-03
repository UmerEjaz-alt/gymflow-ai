import puppeteer from "puppeteer-core";
import path from "node:path";

const ARTIFACT_DIR =
  "C:\\Users\\SYS\\.gemini\\antigravity\\brain\\17fef2d3-e53c-4715-9ee7-8d6f7b30bf90";

async function verifyMarketingHero() {
  console.log("=== Launching Edge/Puppeteer to verify Marketing Hero & Nav ===");

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  const page = await browser.newPage();

  try {
    // 1. Desktop 1440px Viewport - Initial sequence
    console.log("Testing Desktop 1440x900 Viewport...");
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto("http://localhost:3000", { waitUntil: "networkidle0" });

    // Wait for the full signature interaction sequence (inquiry -> reply -> tour request -> booking secured)
    await new Promise((r) => setTimeout(r, 6000));

    const screen1 = path.join(ARTIFACT_DIR, "desktop_hero_1440.png");
    await page.screenshot({ path: screen1, fullPage: false });
    console.log("Saved screenshot 1 (Booking Secured):", screen1);

    const screen2 = path.join(ARTIFACT_DIR, "desktop_hero_fullpage.png");
    await page.screenshot({ path: screen2, fullPage: true });
    console.log("Saved screenshot 2:", screen2);

    // 2. Tablet 768px Viewport
    console.log("Testing Tablet 768x1024 Viewport...");
    await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 2 });
    await page.goto("http://localhost:3000", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 5500));

    const screen4 = path.join(ARTIFACT_DIR, "tablet_hero_768.png");
    await page.screenshot({ path: screen4, fullPage: true });
    console.log("Saved screenshot 4:", screen4);

    // 3. Mobile 390px Viewport (iPhone size)
    console.log("Testing Mobile 390x844 Viewport...");
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto("http://localhost:3000", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 5500));

    const screen5 = path.join(ARTIFACT_DIR, "mobile_hero_390.png");
    await page.screenshot({ path: screen5, fullPage: true });
    console.log("Saved screenshot 5:", screen5);

    // 4. Test Mobile Menu Drawer
    console.log("Testing Mobile Menu Drawer...");
    const mobileMenuBtn = await page.waitForSelector('button[aria-label="Open menu"]');
    await mobileMenuBtn?.click();
    await new Promise((r) => setTimeout(r, 600));

    const screen6 = path.join(ARTIFACT_DIR, "mobile_menu_open.png");
    await page.screenshot({ path: screen6, fullPage: false });
    console.log("Saved screenshot 6:", screen6);

    console.log("=== Marketing Hero Verification Complete! ===");
  } finally {
    await page.close();
    await browser.close();
  }
}

verifyMarketingHero().catch((err) => {
  console.error("Verification script failed:", err);
  process.exit(1);
});
