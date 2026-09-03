import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ARTIFACT_DIR =
  "C:\\Users\\SYS\\.gemini\\antigravity\\brain\\cca15418-574e-4bbf-97af-66c879b288cf";

async function testCustomerCombobox() {
  console.log("=== Testing Searchable Customer Combobox in Browser ===");

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  const page = await browser.newPage();

  try {
    // 1. Desktop Viewport
    await page.setViewport({ width: 1280, height: 800 });

    console.log("Navigating to login...");
    await page.goto("http://localhost:3000/login", { waitUntil: "networkidle0" });

    // Login
    await page.waitForSelector("#email");
    await page.type("#email", "umerejaz650@gmail.com");
    await page.type("#password", "TestPassword123!");
    await page.click('button[type="submit"]');

    await page.waitForNavigation({ waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 1000));

    console.log("Navigating to /bookings...");
    await page.goto("http://localhost:3000/bookings", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 1500));

    // Open New Booking sheet
    console.log("Opening New Booking Sheet...");
    const newBtn = await page.waitForSelector("button ::-p-text(New booking)");
    await newBtn?.click();
    await new Promise((r) => setTimeout(r, 800));

    // 2. Test "Existing Member" mode
    console.log("Switching to Existing Member tab...");
    const memberTab = await page.waitForSelector("#customer-mode-member");
    await memberTab?.click();
    await new Promise((r) => setTimeout(r, 500));

    // Click to open combobox popover
    console.log("Opening Member Combobox...");
    const memberComboboxBtn = await page.waitForSelector(
      "button ::-p-text(Search member by name or phone)",
    );
    await memberComboboxBtn?.click();
    await new Promise((r) => setTimeout(r, 500));

    // Screenshot of open member combobox
    const screenshot1 = path.join(ARTIFACT_DIR, "combobox_member_open.png");
    await page.screenshot({ path: screenshot1 });
    console.log("Saved screenshot:", screenshot1);

    // Type a search query (e.g. "a" or phone)
    console.log("Typing search query...");
    await page.keyboard.type("03");
    await new Promise((r) => setTimeout(r, 500));

    const screenshot2 = path.join(ARTIFACT_DIR, "combobox_member_search.png");
    await page.screenshot({ path: screenshot2 });
    console.log("Saved screenshot:", screenshot2);

    // Select the first item by pressing Enter or clicking
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 500));

    const screenshot3 = path.join(ARTIFACT_DIR, "combobox_member_selected.png");
    await page.screenshot({ path: screenshot3 });
    console.log("Saved screenshot:", screenshot3);

    // 3. Test "Lead" mode
    console.log("Switching to Lead tab...");
    const leadTab = await page.waitForSelector("#customer-mode-lead");
    await leadTab?.click();
    await new Promise((r) => setTimeout(r, 500));

    console.log("Opening Lead Combobox...");
    const leadComboboxBtn = await page.waitForSelector(
      "button ::-p-text(Search lead by name or phone)",
    );
    await leadComboboxBtn?.click();
    await new Promise((r) => setTimeout(r, 500));

    const screenshot4 = path.join(ARTIFACT_DIR, "combobox_lead_open.png");
    await page.screenshot({ path: screenshot4 });
    console.log("Saved screenshot:", screenshot4);

    // Type a non-matching search to verify empty state
    await page.keyboard.type("xyz999nonexistent");
    await new Promise((r) => setTimeout(r, 500));

    const screenshot5 = path.join(ARTIFACT_DIR, "combobox_empty_state.png");
    await page.screenshot({ path: screenshot5 });
    console.log("Saved screenshot:", screenshot5);

    // 4. Test Mobile Layout (390x844)
    console.log("Testing Mobile Layout...");
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 500));

    // Clear search
    const leadTabMob = await page.waitForSelector("#customer-mode-lead");
    await leadTabMob?.click();
    await new Promise((r) => setTimeout(r, 400));

    const screenshot6 = path.join(ARTIFACT_DIR, "combobox_mobile_layout.png");
    await page.screenshot({ path: screenshot6 });
    console.log("Saved screenshot:", screenshot6);

    console.log("=== Combobox Browser Verification Complete! ===");
  } finally {
    await page.close();
    await browser.close();
  }
}

testCustomerCombobox().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
