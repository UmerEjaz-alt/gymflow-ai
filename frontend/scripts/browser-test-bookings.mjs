import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR =
  "C:\\Users\\SYS\\.gemini\\antigravity\\brain\\cca15418-574e-4bbf-97af-66c879b288cf";

async function runBrowserTests() {
  console.log("=== Starting GymFlow Bookings Browser Verification ===");

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  const page = await browser.newPage();

  try {
    // 1. Set Desktop Viewport
    await page.setViewport({ width: 1280, height: 800 });

    // 2. Navigate to login
    console.log("Navigating to http://localhost:3000/login");
    await page.goto("http://localhost:3000/login", { waitUntil: "networkidle0" });

    // Fill login form
    console.log("Logging in as umerejaz650@gmail.com...");
    await page.waitForSelector("#email");
    await page.type("#email", "umerejaz650@gmail.com");
    await page.type("#password", "TestPassword123!");
    await page.click('button[type="submit"]');

    // Wait for redirect to finish
    console.log("Waiting for authentication...");
    await page.waitForNavigation({ waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 1000));

    // 3. Navigate to Bookings
    console.log("Navigating to http://localhost:3000/bookings");
    await page.goto("http://localhost:3000/bookings", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 1500));

    // Screenshot 1: Desktop Initial View
    const screenshot1 = path.join(ARTIFACT_DIR, "desktop_bookings_initial.png");
    await page.screenshot({ path: screenshot1, fullPage: false });
    console.log("Saved screenshot 1:", screenshot1);

    // 4. Click "+ New booking"
    console.log("Opening New Booking Sheet...");
    const newBtn = await page.waitForSelector("button ::-p-text(New booking)");
    await newBtn?.click();
    await new Promise((r) => setTimeout(r, 800));

    // Fill customer name and phone
    console.log("Filling booking form: Ahmed Khan - PT Session with umer...");
    await page.waitForSelector("#customer-name");
    await page.type("#customer-name", "Ahmed Khan");
    await page.type("#customer-phone", "03001234567");

    // Click "PT Session"
    const ptSessionBtn = await page.waitForSelector("#type-btn-pt_session");
    await ptSessionBtn?.click();
    await new Promise((r) => setTimeout(r, 400));

    // Select trainer umer
    const trainerSelect = await page.waitForSelector("#booking-trainer");
    const options = await page.$$eval("#booking-trainer option", (opts) =>
      opts.map((o) => ({ value: o.value, text: o.textContent })),
    );
    const umerOpt = options.find(
      (o) => o.text && o.text.toLowerCase().includes("umer"),
    );
    if (umerOpt) {
      await trainerSelect?.select(umerOpt.value);
    }

    // Set time to 10:00
    await page.evaluate(() => {
      const el = document.getElementById("booking-time");
      if (el) {
        el.value = "10:00";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    // Notes
    await page.type("#booking-notes", "First session with trainer");

    // Screenshot 2: New Booking Sheet
    const screenshot2 = path.join(ARTIFACT_DIR, "desktop_new_booking_sheet.png");
    await page.screenshot({ path: screenshot2, fullPage: false });
    console.log("Saved screenshot 2:", screenshot2);

    // Submit
    const submitBtn = await page.waitForSelector('button[type="submit"]');
    await submitBtn?.click();
    await new Promise((r) => setTimeout(r, 2000));

    // 5. Test Trainer Conflict: Try booking Sara Ali with umer at 10:30 (Overlap with 10:00-11:00)
    console.log("Testing Trainer Conflict at 10:30...");
    const newBtn2 = await page.waitForSelector("button ::-p-text(New booking)");
    await newBtn2?.click();
    await new Promise((r) => setTimeout(r, 800));

    await page.waitForSelector("#customer-name");
    await page.type("#customer-name", "Sara Ali");
    await page.type("#customer-phone", "03119876543");

    const ptConsultBtn = await page.waitForSelector("#type-btn-pt_consultation");
    await ptConsultBtn?.click();
    await new Promise((r) => setTimeout(r, 400));

    const trainerSelect2 = await page.waitForSelector("#booking-trainer");
    if (umerOpt) {
      await trainerSelect2?.select(umerOpt.value);
    }

    await page.evaluate(() => {
      const el = document.getElementById("booking-time");
      if (el) {
        el.value = "10:30";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    const submitBtn2 = await page.waitForSelector('button[type="submit"]');
    await submitBtn2?.click();
    await new Promise((r) => setTimeout(r, 1500));

    // Screenshot 3: Conflict Error
    const screenshot3 = path.join(ARTIFACT_DIR, "desktop_trainer_conflict_error.png");
    await page.screenshot({ path: screenshot3, fullPage: false });
    console.log("Saved screenshot 3 (Conflict Error):", screenshot3);

    // Now change time to 11:00 (Back-to-back allowed)
    console.log("Changing time to 11:00 (back-to-back)...");
    await page.evaluate(() => {
      const el = document.getElementById("booking-time");
      if (el) {
        el.value = "11:00";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await submitBtn2?.click();
    await new Promise((r) => setTimeout(r, 2000));

    // 6. Create Gym Visit and Trial Session
    console.log("Creating Gym Visit for Bilal Ahmed...");
    const newBtn3 = await page.waitForSelector("button ::-p-text(New booking)");
    await newBtn3?.click();
    await new Promise((r) => setTimeout(r, 800));
    await page.waitForSelector("#customer-name");
    await page.type("#customer-name", "Bilal Ahmed");
    const gymVisitBtn = await page.waitForSelector("#type-btn-gym_visit");
    await gymVisitBtn?.click();
    await page.evaluate(() => {
      const el = document.getElementById("booking-time");
      if (el) {
        el.value = "14:00";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const submitBtn3 = await page.waitForSelector('button[type="submit"]');
    await submitBtn3?.click();
    await new Promise((r) => setTimeout(r, 2000));

    console.log("Creating Trial Session for Zainab Tariq...");
    const newBtn4 = await page.waitForSelector("button ::-p-text(New booking)");
    await newBtn4?.click();
    await new Promise((r) => setTimeout(r, 800));
    await page.waitForSelector("#customer-name");
    await page.type("#customer-name", "Zainab Tariq");
    const trialBtn = await page.waitForSelector("#type-btn-trial_session");
    await trialBtn?.click();
    await page.evaluate(() => {
      const el = document.getElementById("booking-time");
      if (el) {
        el.value = "16:00";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const submitBtn4 = await page.waitForSelector('button[type="submit"]');
    await submitBtn4?.click();
    await new Promise((r) => setTimeout(r, 2000));

    // Screenshot 4: Filled Today View
    const screenshot4 = path.join(ARTIFACT_DIR, "desktop_today_view_filled.png");
    await page.screenshot({ path: screenshot4, fullPage: false });
    console.log("Saved screenshot 4 (Today View):", screenshot4);

    // 7. Switch to Week View
    console.log("Switching to Week View...");
    const weekTab = await page.waitForSelector("button ::-p-text(Week)");
    await weekTab?.click();
    await new Promise((r) => setTimeout(r, 1000));

    const screenshot5 = path.join(ARTIFACT_DIR, "desktop_week_view.png");
    await page.screenshot({ path: screenshot5, fullPage: false });
    console.log("Saved screenshot 5 (Week View):", screenshot5);

    // Switch back to Today View
    const todayTab = await page.waitForSelector("button ::-p-text(Today)");
    await todayTab?.click();
    await new Promise((r) => setTimeout(r, 1000));

    // 8. Open Booking Details for Ahmed Khan
    console.log("Opening Booking Details for Ahmed Khan...");
    const ahmedRow = await page.waitForSelector("button ::-p-text(Ahmed Khan)");
    await ahmedRow?.click();
    await new Promise((r) => setTimeout(r, 1000));

    const screenshot6 = path.join(ARTIFACT_DIR, "desktop_booking_details_sheet.png");
    await page.screenshot({ path: screenshot6, fullPage: false });
    console.log("Saved screenshot 6 (Details Sheet):", screenshot6);

    // 9. Reschedule Ahmed Khan
    console.log("Testing Reschedule modal...");
    const rescheduleBtn = await page.waitForSelector("button ::-p-text(Reschedule)");
    await rescheduleBtn?.click();
    await new Promise((r) => setTimeout(r, 800));

    await page.evaluate(() => {
      const el = document.getElementById("reschedule-time");
      if (el) {
        el.value = "12:00";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const confirmReschedBtn = await page.waitForSelector(
      "button ::-p-text(Confirm reschedule)",
    );
    await confirmReschedBtn?.click();
    await new Promise((r) => setTimeout(r, 2000));

    const screenshot7 = path.join(ARTIFACT_DIR, "desktop_rescheduled_booking.png");
    await page.screenshot({ path: screenshot7, fullPage: false });
    console.log("Saved screenshot 7 (Rescheduled):", screenshot7);

    // Close detail sheet
    const closeSheetBtn = await page.$('button[aria-label="Close panel"]');
    await closeSheetBtn?.click();
    await new Promise((r) => setTimeout(r, 500));

    // 10. Test Status Transitions
    console.log("Marking Bilal Ahmed as Completed...");
    const bilalRow = await page.waitForSelector("button ::-p-text(Bilal Ahmed)");
    await bilalRow?.click();
    await new Promise((r) => setTimeout(r, 800));
    const completeBtn = await page.waitForSelector("button ::-p-text(Completed)");
    await completeBtn?.click();
    await new Promise((r) => setTimeout(r, 1500));
    const closeSheetBtn2 = await page.$('button[aria-label="Close panel"]');
    await closeSheetBtn2?.click();
    await new Promise((r) => setTimeout(r, 500));

    console.log("Marking Zainab Tariq as No-show...");
    const zainabRow = await page.waitForSelector("button ::-p-text(Zainab Tariq)");
    await zainabRow?.click();
    await new Promise((r) => setTimeout(r, 800));
    const noShowBtn = await page.waitForSelector("button ::-p-text(No-show)");
    await noShowBtn?.click();
    await new Promise((r) => setTimeout(r, 1500));
    const closeSheetBtn3 = await page.$('button[aria-label="Close panel"]');
    await closeSheetBtn3?.click();
    await new Promise((r) => setTimeout(r, 500));

    console.log("Cancelling Sara Ali booking...");
    const saraRow = await page.waitForSelector("button ::-p-text(Sara Ali)");
    await saraRow?.click();
    await new Promise((r) => setTimeout(r, 800));
    const cancelBtn = await page.waitForSelector("button ::-p-text(Cancel)");
    await cancelBtn?.click();
    await new Promise((r) => setTimeout(r, 800));

    // Confirm cancel in dialog
    const confirmCancelBtn = await page.waitForSelector(
      "button ::-p-text(Cancel Appointment)",
    );
    await confirmCancelBtn?.click();
    await new Promise((r) => setTimeout(r, 1500));
    const closeSheetBtn4 = await page.$('button[aria-label="Close panel"]');
    await closeSheetBtn4?.click();
    await new Promise((r) => setTimeout(r, 500));

    const screenshot8 = path.join(ARTIFACT_DIR, "desktop_status_transitions.png");
    await page.screenshot({ path: screenshot8, fullPage: false });
    console.log("Saved screenshot 8 (Status Transitions):", screenshot8);

    // 11. Mobile Viewport Tests (390x844)
    console.log("Testing Mobile Viewport (390x844)...");
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 1000));

    const screenshot9 = path.join(ARTIFACT_DIR, "mobile_today_view.png");
    await page.screenshot({ path: screenshot9, fullPage: false });
    console.log("Saved screenshot 9 (Mobile Today View):", screenshot9);

    // Open new booking on mobile
    const mobileNewBtn = await page.waitForSelector("button ::-p-text(New booking)");
    await mobileNewBtn?.click();
    await new Promise((r) => setTimeout(r, 800));

    const screenshot10 = path.join(ARTIFACT_DIR, "mobile_new_booking_sheet.png");
    await page.screenshot({ path: screenshot10, fullPage: false });
    console.log("Saved screenshot 10 (Mobile New Booking Sheet):", screenshot10);

    const mobileCloseSheetBtn = await page.$('button[aria-label="Close panel"]');
    await mobileCloseSheetBtn?.click();
    await new Promise((r) => setTimeout(r, 500));

    // Open detail on mobile
    const mobileAhmedRow = await page.waitForSelector("button ::-p-text(Ahmed Khan)");
    await mobileAhmedRow?.click();
    await new Promise((r) => setTimeout(r, 800));

    const screenshot11 = path.join(ARTIFACT_DIR, "mobile_details_sheet.png");
    await page.screenshot({ path: screenshot11, fullPage: false });
    console.log("Saved screenshot 11 (Mobile Details Sheet):", screenshot11);

    console.log("=== All Browser Tests Completed Successfully! ===");
  } finally {
    await page.close();
    await browser.close();
  }
}

runBrowserTests().catch((err) => {
  console.error("Browser test failed:", err);
  process.exit(1);
});
