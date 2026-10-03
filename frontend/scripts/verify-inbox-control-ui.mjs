import assert from "node:assert/strict";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

// Actual Inbox component + production CSS, isolated mocked actions, no Supabase/Meta.
// Test-only runtime: npm install --prefix .tmp-control-db --no-save --no-package-lock @electric-sql/pglite esbuild
const { build } = await import(
  process.env.ESBUILD_MODULE ??
    new URL("../.tmp-control-db/node_modules/esbuild/lib/main.js", import.meta.url).href
);
const root = fileURLToPath(new URL("../", import.meta.url));
const actions = `
export async function refreshInboxThread(id) {
  const state = window.fixture;
  state.refreshes.push(id);
  const c = state.conversations.find(c=>c.id===id);
  return {data:{conversation:c,messages:c.messages,ownerSendAllowed:c.status==='human'&&!state.expired,
    ownerSendExplanation:state.expired?'WhatsApp replies are available for 24 hours after the latest customer message. Wait for a new message to reply.':null}};
}
export async function takeOverConversation(id) {
  const state = window.fixture;
  state.controls.push(['take',id]);
  const c=state.conversations.find(c=>c.id===id);c.status='human';c.control_version++;
  return {conversation:{...c},notice:null};
}
export async function returnConversationToAI(id) {
  const state = window.fixture;
  state.controls.push(['return',id]);
  const c=state.conversations.find(c=>c.id===id);c.status='active';c.control_version++;
  return {conversation:{...c},notice:null};
}
export async function sendOwnerMessage(...args) {
  const state = window.fixture;
  state.requests.push(args);
  const [id,text,key]=args;
  const c=state.conversations.find(c=>c.id===id);
  let m=c.messages.find(m=>m.client_request_id===key);
  if(!m){m={id:crypto.randomUUID(),conversation_id:id,content:text,sender_type:'human',message_type:'text',created_at:new Date().toISOString(),metadata:{},client_request_id:key,owner_delivery_state:'pending'};c.messages.push(m);}
  if(state.interruptOnce){state.interruptOnce=false;throw Error('connection interrupted after commit');}
  return {message:{...m}};
}
`;
const entry = `
import {createRoot} from 'react-dom/client';
import {ConversationSimulator} from './src/features/conversation-simulator/components/conversation-simulator';
const c=(id,name,source='whatsapp',status='active')=>({id,customer_name:name,customer_phone:'+923001234567',source,status,ai_enabled:true,control_version:0,branch_id:null,whatsapp_endpoint_id:null,gym_id:'fixture-gym',last_message_at:new Date().toISOString(),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),lead_stage:'new_lead',messages:[{id:id+'-inbound',conversation_id:id,sender_type:'customer',message_type:'text',content:'Customer message '+name,metadata:{},created_at:new Date().toISOString()}]});
window.fixture={conversations:[c('A','Customer A'),c('B','Customer B'),c('S','Simulator','simulator'),c('C','Closed customer','whatsapp','closed')],requests:[],controls:[],refreshes:[],expired:false,interruptOnce:false};
createRoot(document.getElementById('root')).render(<ConversationSimulator initialConversations={structuredClone(window.fixture.conversations)} activeEndpoints={[]} branches={[]} onLoadMessages={async(id)=>({data:window.fixture.conversations.find(c=>c.id===id).messages,error:null})} onCreateCustomer={async()=>({})} onSendMessage={async(id,text)=>({messages:[...window.fixture.conversations.find(c=>c.id===id).messages,{id:'sim-reply',sender_type:'ai',message_type:'text',metadata:{},content:'Simulator response: '+text,created_at:new Date().toISOString()}]})} />);
`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": "'production'" },
  plugins: [
    {
      name: "mock-actions",
      setup(b) {
        b.onResolve({ filter: /^@\/app\/\(app\)\/inbox\/actions$/ }, () => ({
          path: "actions",
          namespace: "mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents: actions,
          loader: "js",
        }));
        b.onResolve({ filter: /^@\// }, (args) => {
          const base = path.join(root, "src", args.path.slice(2));
          const resolved = [
            base,
            base + ".tsx",
            base + ".ts",
            path.join(base, "index.tsx"),
          ].find((f) => existsSync(f));
          return resolved ? { path: resolved } : null;
        });
      },
    },
  ],
});
const cssDir = path.join(root, ".next/static/chunks");
const css = (
  await Promise.all(
    (await readdir(cssDir))
      .filter((f) => f.endsWith(".css"))
      .map((f) => readFile(path.join(cssDir, f), "utf8")),
  )
).join("\n");
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundle.outputFiles[0].text);
  } else if (req.url === "/style.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><main id="root" class="flex flex-col" style="height:100dvh;padding:12px"></main><script src="/bundle.js"></script></body></html>',
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
const errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clickText = async (text) => {
    const clicked = await page.evaluate((text) => {
      const b = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === text || b.textContent.includes(text),
      );
      if (!b) return false;
      b.click();
      return true;
    }, text);
    assert(clicked, `Missing button: ${text}`);
  };
  const hasText = async (text) =>
    page.waitForFunction((text) => document.body.textContent.includes(text), {}, text);
  const screenshotDir = process.env.QA_ARTIFACT_DIR;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [768, 1024],
    [390, 844],
  ]) {
    if (process.env.QA_WIDTH && width !== Number(process.env.QA_WIDTH)) continue;
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(url);
    if (width < 1024) await clickText("Customer A");
    await hasText("Kroway AI is handling this conversation");
    assert.equal(await page.$('input[aria-label="Your WhatsApp reply"]'), null);
    await clickText("Take Over");
    await hasText("You're handling this conversation");
    await page.waitForSelector(
      'input[aria-label="Your WhatsApp reply"]:not([disabled])',
    );
    await page.type('input[aria-label="Your WhatsApp reply"]', "Hello from the owner");
    if (width === 1440)
      await page.evaluate(() => (window.fixture.interruptOnce = true));
    await page.click('button[aria-label="Send WhatsApp reply"]');
    if (width === 1440) {
      await hasText("Connection interrupted. Retry this same message");
      // Sending in B must not erase A's unknown-outcome idempotency key.
      await clickText("Customer B");
      await clickText("Take Over");
      await page.waitForSelector(
        'input[aria-label="Your WhatsApp reply"]:not([disabled])',
      );
      await page.type('input[aria-label="Your WhatsApp reply"]', "Reply in B");
      await page.click('button[aria-label="Send WhatsApp reply"]');
      await page.waitForFunction(
        () =>
          window.fixture.requests.length === 2 &&
          document.querySelector('input[aria-label="Your WhatsApp reply"]').value ===
            "",
      );
      await clickText("Return to AI");
      await hasText("Kroway AI is handling this conversation");
      await clickText("Customer A");
      await page.waitForSelector(
        'input[aria-label="Your WhatsApp reply"]:not([disabled])',
      );
      await page.type(
        'input[aria-label="Your WhatsApp reply"]',
        "Hello from the owner",
      );
      await page.click('button[aria-label="Send WhatsApp reply"]');
      await page.waitForFunction(() => window.fixture.requests.length === 3);
      const keys = await page.evaluate(() => window.fixture.requests.map((r) => r[2]));
      assert.equal(keys[0], keys[2]);
    }
    await hasText("Waiting to send");
    assert.equal(
      await page.evaluate(
        () =>
          window.fixture.conversations[0].messages.filter(
            (m) => m.sender_type === "human",
          ).length,
      ),
      1,
    );
    assert.equal(
      await page.evaluate(() => window.fixture.conversations[1].status),
      "active",
    );
    assert(
      await page.evaluate(() =>
        window.fixture.requests.every(
          (r) => r.length === 3 && ["A", "B"].includes(r[0]),
        ),
      ),
    );
    const bounds = await page.evaluate(() => {
      const section = document.querySelector("section").getBoundingClientRect();
      const elements = [...document.querySelectorAll("button,input,p,span")].filter(
        (e) =>
          e.textContent.trim() === "Return to AI" ||
          e.textContent.trim() === "Hello from the owner" ||
          e.textContent.trim() === "You're handling this conversation" ||
          e.getAttribute("aria-label") === "Send WhatsApp reply" ||
          e.getAttribute("aria-label") === "Your WhatsApp reply",
      );
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        buttons: elements
          .filter((e) => e.getBoundingClientRect().width > 0)
          .map((e) => {
            const r = e.getBoundingClientRect();
            return {
              text: e.textContent.trim(),
              label: e.getAttribute("aria-label"),
              x: r.x,
              right: r.right,
              bottom: r.bottom,
              valid:
                r.x >= section.x && r.right <= section.right && r.bottom <= innerHeight,
            };
          }),
      };
    });
    assert.equal(bounds.overflow, false, `Overflow at ${width}`);
    if (screenshotDir)
      await page.screenshot({
        path: path.join(screenshotDir, `inbox-human-${width}.png`),
      });
    assert(
      bounds.buttons.every((b) => b.valid),
      `Clipped controls at ${width}: ${JSON.stringify(bounds)}`,
    );
    await page.evaluate(() => {
      window.fixture.conversations[0].messages.push({
        id: "live-inbound",
        sender_type: "customer",
        message_type: "text",
        metadata: {},
        content: "New customer message while human",
        created_at: new Date().toISOString(),
      });
      window.fixture.conversations[0].messages.find(
        (m) => m.sender_type === "human",
      ).owner_delivery_state = "sent";
    });
    await hasText("New customer message while human");
    await hasText("Sent to WhatsApp");
    await page.evaluate(() => (window.fixture.expired = true));
    await hasText("WhatsApp replies are available for 24 hours");
    assert(await page.$('input[aria-label="Your WhatsApp reply"][disabled]'));
    await page.evaluate(() => {
      window.fixture.conversations[0].ai_enabled = false;
    });
    await clickText("Return to AI");
    await hasText("AI replies are paused for this conversation");
    assert.equal(
      await page.evaluate(() => window.fixture.conversations[0].ai_enabled),
      false,
    );
    assert.equal(await page.$('input[aria-label="Your WhatsApp reply"]'), null);
    if (width < 1024) await page.click('button[aria-label="Back to conversations"]');
    await clickText("Closed customer");
    await hasText("This conversation is closed");
    assert.equal(await page.$('input[aria-label="Your WhatsApp reply"]'), null);
    if (width < 1024) await page.click('button[aria-label="Back to conversations"]');
    await clickText("Simulator");
    await page.waitForSelector('input[aria-label="Customer message"]');
    await page.type('input[aria-label="Customer message"]', "Test simulator");
    await page.click('button[aria-label="Send message"]');
    await hasText("Simulator response: Test simulator");
    console.log(
      `Inbox actual-component QA passed at ${width}x${height}: control, composer, delivery labels, selected-thread polling, window rejection, closed and simulator UI; no overflow/clipped controls.`,
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
