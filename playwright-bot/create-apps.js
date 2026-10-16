// create-apps.js — Headless Play Console draft creator (port of the Chrome extension flow).
// Usage:
//   cp apps.example.txt apps.txt   # list your apps
//   DEV_ID=1234567890123456789 GH_TOKEN=ghp_... GH_REPO=OWNER/REPO node create-apps.js
//
// Env vars:
//   DEV_ID           (required) Play Console developer account ID
//   GH_TOKEN         (optional) GitHub PAT — enables workflow dispatch after each creation
//   GH_REPO          (optional) owner/repo for flutter-build.yml dispatch
//   GH_BASE_BRANCH   (default: main)
//   GH_WORKFLOW      (default: flutter-build.yml)
//   TRACK            (default: internal)
//   PUBLISH_TO_PLAY  (default: false)
//   UPLOAD_LISTING   (default: false)
//   APP_TYPE         app|game (default: app)
//   PRICING          free|paid (default: free)
//   DELAY_SEC        delay between apps (default: 3)
//   HEADFUL=1        show the browser (debugging)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const AUTH_FILE = path.join(__dirname, 'play-console-auth.json');
const APPS_FILE = path.join(__dirname, 'apps.txt');

const CONFIG = {
  devId: process.env.DEV_ID || '',
  ghToken: process.env.GH_TOKEN || '',
  ghRepo: process.env.GH_REPO || '',
  ghBaseBranch: process.env.GH_BASE_BRANCH || 'main',
  ghWorkflow: process.env.GH_WORKFLOW || 'flutter-build.yml',
  track: process.env.TRACK || 'internal',
  publishToPlay: process.env.PUBLISH_TO_PLAY === 'true',
  uploadListing: process.env.UPLOAD_LISTING === 'true',
  appType: process.env.APP_TYPE || 'app',
  pricing: process.env.PRICING || 'free',
  delaySec: Math.max(3, parseInt(process.env.DELAY_SEC || '3', 10)),
  headless: process.env.HEADFUL !== '1'
};

// Same palette as the extension sidebar
const VARIANT_COLOR_PALETTE = ['#8BC34A', '#558B2F', '#1565C0'];

function randomizeVariantColors() {
  const shuffled = [...VARIANT_COLOR_PALETTE];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return { primary: shuffled[0], dark: shuffled[1], iconBg: shuffled[2] };
}

function generateDefaultPackageName() {
  const segment = crypto.randomBytes(6).toString('hex'); // 12 hex chars
  return `com.app${segment}.generated`;
}

function readAppsQueue() {
  if (!fs.existsSync(APPS_FILE)) {
    console.error('❌ apps.txt introuvable. Copiez apps.example.txt vers apps.txt et listez vos apps.');
    process.exit(1);
  }
  return fs.readFileSync(APPS_FILE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [name, pkg] = l.split('|').map((s) => (s || '').trim());
      return { name, pkg };
    })
    .filter((a) => a.name);
}

// ============================================================
// fillAndSubmitForm — ported 1:1 from the extension sidebar.js.
// Must stay self-contained (Playwright serializes it into the page).
// ============================================================
/* eslint-disable */
function fillAndSubmitForm(appName, packageName, appType, pricing, debug) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  return new Promise(async (resolve) => {
    try {
      const debugInfo = [];

      // Step A: Wait for splash screen to disappear
      for (let w = 0; w < 30; w++) {
        const splash = document.getElementById('console-splash-021280');
        if (!splash || splash.classList.contains('hide') || splash.style.opacity === '0' || splash.style.display === 'none') {
          debugInfo.push(`Splash gone after ${w}s`);
          break;
        }
        if (w === 29) { resolve('Splash never disappeared'); return; }
        await sleep(1000);
      }
      await sleep(2000);

      // Step B: Check if we're on the home page (has search input, no create form).
      let radios = document.querySelectorAll('[role="radio"], mat-radio-button, .mat-mdc-radio-button');
      let cbs = document.querySelectorAll('[role="checkbox"], mat-checkbox, .mat-mdc-checkbox, input[type="checkbox"]');

      if (radios.length === 0 && cbs.length === 0) {
        debugInfo.push('No form elements found — likely on home page. Looking for create link...');

        const allLinks = document.querySelectorAll('a');
        let createLink = null;
        for (const a of allLinks) {
          const t = a.textContent.trim().toLowerCase();
          if (t.includes('créer une application') || t.includes('create app') || t.includes('create an app')) {
            createLink = a;
            break;
          }
        }

        if (!createLink) {
          for (const a of allLinks) {
            if (a.href && a.href.includes('/app/create')) {
              createLink = a;
              break;
            }
          }
        }

        if (createLink) {
          debugInfo.push(`Clicking create link: "${createLink.textContent.trim().substring(0, 50)}"`);
          createLink.click();
        } else {
          debugInfo.push('No create link found on page');
          resolve('Could not find create app link on home page.\n' + debugInfo.join('\n'));
          return;
        }

        for (let w = 0; w < 20; w++) {
          await sleep(1000);
          radios = document.querySelectorAll('[role="radio"], mat-radio-button, .mat-mdc-radio-button');
          cbs = document.querySelectorAll('[role="checkbox"], mat-checkbox, .mat-mdc-checkbox, input[type="checkbox"]');
          if (radios.length > 0 || cbs.length > 0) {
            debugInfo.push(`Create form appeared after ${w + 1}s (radios=${radios.length}, cbs=${cbs.length})`);
            break;
          }
        }

        radios = document.querySelectorAll('[role="radio"], mat-radio-button, .mat-mdc-radio-button');
        cbs = document.querySelectorAll('[role="checkbox"], mat-checkbox, .mat-mdc-checkbox, input[type="checkbox"]');
        if (radios.length === 0 && cbs.length === 0) {
          const bodySnippet = document.body.innerText.substring(0, 600);
          debugInfo.push('Form never appeared. Body: ' + bodySnippet);
          resolve('Create form did not appear after clicking link.\n' + debugInfo.join('\n'));
          return;
        }
      } else {
        debugInfo.push(`Already on create form (radios=${radios.length}, cbs=${cbs.length})`);
      }

      await sleep(1000);

      // Step C: Gather all elements
      const inputs = document.querySelectorAll('input');
      const buttons = document.querySelectorAll('button, [role="button"]');
      cbs = document.querySelectorAll('[role="checkbox"], mat-checkbox, .mat-mdc-checkbox, input[type="checkbox"]');
      radios = document.querySelectorAll('[role="radio"], mat-radio-button, .mat-mdc-radio-button');

      if (debug) {
        debugInfo.push(`Form: ${inputs.length} inputs, ${buttons.length} buttons, ${cbs.length} cbs, ${radios.length} radios`);
      }

      // Step D: Fill app name
      let nameInput = null;
      for (const inp of inputs) {
        if ((inp.type === 'text' || inp.type === '') && !inp.readOnly && !inp.disabled) {
          const ariaLabel = (inp.getAttribute('aria-label') || '').toLowerCase();
          if (ariaLabel.includes('recherche') || ariaLabel.includes('search') || ariaLabel.includes('filter')) continue;
          nameInput = inp;
          break;
        }
      }

      if (!nameInput) {
        for (const inp of inputs) {
          if ((inp.type === 'text' || inp.type === '') && !inp.readOnly && !inp.disabled) {
            nameInput = inp;
            break;
          }
        }
      }

      if (!nameInput) {
        resolve('No text input found on create form.\n' + debugInfo.join('\n'));
        return;
      }

      debugInfo.push(`Filling name input (aria="${nameInput.getAttribute('aria-label') || ''}")`);
      nameInput.focus();
      nameInput.click();
      await sleep(300);
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(nameInput, appName);
      nameInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      nameInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      await sleep(1000);

      // Step D2: Fill package name if provided
      if (packageName) {
        let pkgInput = null;
        for (const inp of inputs) {
          const ariaLabel = (inp.getAttribute('aria-label') || '').toLowerCase();
          if (ariaLabel.includes('package') || ariaLabel.includes('nom du package')) {
            pkgInput = inp;
            break;
          }
        }
        if (!pkgInput) {
          const textInputs = Array.from(inputs).filter(inp =>
            (inp.type === 'text' || inp.type === '') && !inp.readOnly && !inp.disabled
          );
          if (textInputs.length >= 2) {
            pkgInput = textInputs[1];
          }
        }
        if (pkgInput) {
          debugInfo.push(`Filling package input (aria="${pkgInput.getAttribute('aria-label') || ''}")`);
          pkgInput.focus();
          pkgInput.click();
          await sleep(300);
          nativeSetter.call(pkgInput, packageName);
          pkgInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          pkgInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          pkgInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
          await sleep(1000);
        } else {
          debugInfo.push('No package name input found');
        }
      }

      // Step E: Click radios for App/Game and Free/Paid
      const radioInputs = document.querySelectorAll('input[type="radio"]');
      let radioClicked = { type: false, pricing: false };

      for (const radio of radioInputs) {
        let text = '';
        text = (radio.getAttribute('aria-label') || '').toLowerCase();

        if (!text && radio.id) {
          const lbl = document.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
          if (lbl) text = lbl.textContent.trim().toLowerCase();
        }

        if (!text) {
          const lbl = radio.closest('label');
          if (lbl) text = lbl.textContent.trim().toLowerCase();
        }

        if (!text) {
          let el = radio.parentElement;
          for (let i = 0; i < 4 && el; i++) {
            const t = el.textContent.trim().toLowerCase();
            if (t.length > 0 && t.length < 80) { text = t; break; }
            el = el.parentElement;
          }
        }

        debugInfo.push(`radio: "${text.substring(0, 60)}" name=${radio.name} val=${radio.value}`);

        if (!radioClicked.type) {
          if (appType === 'app' && (text.includes('application') || text.includes('appli') || (text.includes('app') && !text.includes('jeu') && !text.includes('game')))) {
            radio.click();
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            radioClicked.type = true;
            debugInfo.push('  → clicked App type');
          }
          if (appType === 'game' && (text.includes('jeu') || text.includes('game'))) {
            radio.click();
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            radioClicked.type = true;
            debugInfo.push('  → clicked Game type');
          }
        }

        if (!radioClicked.pricing) {
          if (pricing === 'free' && (text.includes('gratuit') || text.includes('free') || text.includes('sans frais'))) {
            radio.click();
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            radioClicked.pricing = true;
            debugInfo.push('  → clicked Free pricing');
          }
          if (pricing === 'paid' && (text.includes('payant') || text.includes('paid'))) {
            radio.click();
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            radioClicked.pricing = true;
            debugInfo.push('  → clicked Paid pricing');
          }
        }

        await sleep(200);
      }

      // Fallback: positional approach
      if (!radioClicked.type || !radioClicked.pricing) {
        debugInfo.push(`Radio text match incomplete (type=${radioClicked.type}, pricing=${radioClicked.pricing}). Trying positional...`);
        const radiosArr = Array.from(radioInputs);
        const groups = {};
        radiosArr.forEach(r => {
          const n = r.name || 'unnamed';
          if (!groups[n]) groups[n] = [];
          groups[n].push(r);
        });
        const groupKeys = Object.keys(groups);

        if (groupKeys.length >= 2) {
          if (!radioClicked.type) {
            const g = groups[groupKeys[0]];
            const idx = appType === 'app' ? 0 : 1;
            if (g[idx]) { g[idx].click(); g[idx].dispatchEvent(new Event('change', { bubbles: true })); }
            debugInfo.push(`Positional: clicked type group[0][${idx}]`);
          }
          if (!radioClicked.pricing) {
            const g = groups[groupKeys[1]];
            const idx = pricing === 'free' ? 0 : 1;
            if (g[idx]) { g[idx].click(); g[idx].dispatchEvent(new Event('change', { bubbles: true })); }
            debugInfo.push(`Positional: clicked pricing group[1][${idx}]`);
          }
        } else if (radiosArr.length === 4) {
          if (!radioClicked.type) {
            const idx = appType === 'app' ? 0 : 1;
            radiosArr[idx].click();
            radiosArr[idx].dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (!radioClicked.pricing) {
            const idx = pricing === 'free' ? 2 : 3;
            radiosArr[idx].click();
            radiosArr[idx].dispatchEvent(new Event('change', { bubbles: true }));
          }
          debugInfo.push('Positional: used 4-radio flat layout');
        }
      }

      await sleep(500);

      // Step F: Check all declaration checkboxes
      const cbInputs = document.querySelectorAll('input[type="checkbox"]');
      debugInfo.push(`Checkboxes: ${cbInputs.length} native inputs, ${cbs.length} role/material`);

      for (const cb of cbInputs) {
        if (!cb.checked) {
          const label = cb.closest('label');
          if (label) {
            label.click();
          } else {
            cb.click();
          }
          cb.dispatchEvent(new Event('change', { bubbles: true }));
          debugInfo.push(`  cb native clicked, now checked=${cb.checked}`);
          await sleep(300);
        }
      }

      for (const cb of cbs) {
        if (cb.tagName === 'INPUT') continue;
        const isChecked = cb.getAttribute('aria-checked') === 'true' ||
                          cb.classList.contains('mat-mdc-checkbox-checked');
        if (!isChecked) {
          const label = cb.querySelector('label') || cb;
          label.click();
          debugInfo.push(`  cb container clicked`);
          await sleep(300);
        }
      }
      await sleep(1000);

      // Step G: Find and click Create submit button
      let createBtn = null;
      const realButtons = document.querySelectorAll('button');

      for (const btn of realButtons) {
        const t = btn.textContent.toLowerCase().trim();
        if ((t.includes('créer') || t.includes('create')) &&
            !t.includes('cancel') && !t.includes('annuler')) {
          createBtn = btn;
          break;
        }
      }

      if (!createBtn) {
        for (const btn of realButtons) {
          const t = btn.textContent.toLowerCase().trim();
          if (t === 'envoyer' || t === 'submit') {
            createBtn = btn;
            break;
          }
        }
      }

      if (!createBtn) {
        const enabledBtns = Array.from(realButtons).filter(b => !b.disabled);
        if (enabledBtns.length > 0) {
          createBtn = enabledBtns[enabledBtns.length - 1];
        }
      }

      if (!createBtn) {
        resolve('No Create button found on form.\n' + debugInfo.join('\n'));
        return;
      }

      debugInfo.push(`Submit button: "${createBtn.textContent.trim().substring(0, 60)}" disabled=${createBtn.disabled}`);

      if (createBtn.disabled) {
        for (let w = 0; w < 8; w++) {
          await sleep(1000);
          if (!createBtn.disabled) {
            debugInfo.push(`Button enabled after ${w + 1}s wait`);
            break;
          }
        }
        if (createBtn.disabled) {
          resolve('Create button still disabled after filling form.\n' + debugInfo.join('\n'));
          return;
        }
      }

      createBtn.click();
      await sleep(3000);

      if (debug) {
        resolve('DEBUG OK: ' + debugInfo.join(' | '));
      } else {
        resolve(true);
      }
    } catch (err) {
      resolve('Script error: ' + err.message + '\n' + err.stack);
    }
  });
}
/* eslint-enable */

// ============================================================
// GitHub workflow dispatch (flutter-build.yml) with random colors
// ============================================================
async function dispatchFlutterBuild(appName, pkg) {
  if (!CONFIG.ghToken || !CONFIG.ghRepo) return null;

  const colors = randomizeVariantColors();
  const requestId = `bot-${pkg}-${Date.now()}`;
  const url = `https://api.github.com/repos/${CONFIG.ghRepo}/actions/workflows/${CONFIG.ghWorkflow}/dispatches`;

  const body = {
    ref: CONFIG.ghBaseBranch,
    inputs: {
      publish_to_play: String(CONFIG.publishToPlay),
      upload_listing: String(CONFIG.uploadListing),
      request_id: requestId,
      track: CONFIG.track
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CONFIG.ghToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify(body)
  });

  if (res.status === 204) {
    return { requestId, colors };
  }
  const text = await res.text();
  throw new Error(`GitHub dispatch failed (${res.status}): ${text.substring(0, 200)}`);
}

// ============================================================
// Main loop
// ============================================================
(async () => {
  if (!CONFIG.devId) {
    console.error('❌ DEV_ID manquant. Ex: DEV_ID=1234567890123456789 node create-apps.js');
    process.exit(1);
  }
  if (!fs.existsSync(AUTH_FILE)) {
    console.error('❌ play-console-auth.json introuvable. Lancez d\'abord: npm run login');
    process.exit(1);
  }

  const apps = readAppsQueue();
  if (apps.length === 0) {
    console.log('ℹ️  apps.txt est vide — rien à faire.');
    process.exit(0);
  }

  console.log(`🤖 ${apps.length} app(s) dans la file. Headless: ${CONFIG.headless}`);

  const browser = await chromium.launch({ headless: CONFIG.headless });
  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US'
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  let created = 0;
  let failed = 0;

  for (let i = 0; i < apps.length; i++) {
    const { name } = apps[i];
    const pkg = apps[i].pkg || generateDefaultPackageName();
    console.log(`\n[${i + 1}/${apps.length}] "${name}" (${pkg})`);

    try {
      const createUrl = `https://play.google.com/console/u/0/developers/${CONFIG.devId}/app/create`;
      await page.goto(createUrl, { waitUntil: 'domcontentloaded' });

      // Detect expired session (redirected to Google login)
      if (page.url().includes('accounts.google.com')) {
        console.error('❌ Session Google expirée — relancez: npm run login');
        break;
      }

      const result = await page.evaluate(fillAndSubmitForm, name, pkg, CONFIG.appType, CONFIG.pricing, false);

      if (result === true) {
        created++;
        console.log(`  ✅ Draft créé: "${name}"`);

        const dispatch = await dispatchFlutterBuild(name, pkg);
        if (dispatch) {
          console.log(`  🚀 Build déclenché (${dispatch.requestId}) couleurs: ${dispatch.colors.primary}/${dispatch.colors.dark}/${dispatch.colors.iconBg}`);
        }
      } else {
        failed++;
        console.error(`  ❌ Échec: ${String(result).split('\n')[0]}`);
        const shot = `error-${Date.now()}.png`;
        await page.screenshot({ path: shot, fullPage: true });
        console.error(`  📸 Capture: ${shot}`);
        console.error(String(result).split('\n').slice(1).join('\n'));
      }
    } catch (err) {
      failed++;
      console.error(`  ❌ Erreur: ${err.message}`);
      try {
        const shot = `error-${Date.now()}.png`;
        await page.screenshot({ path: shot, fullPage: true });
        console.error(`  📸 Capture: ${shot}`);
      } catch (_) {}
    }

    if (i < apps.length - 1) {
      await new Promise((r) => setTimeout(r, CONFIG.delaySec * 1000));
    }
  }

  // Persist refreshed cookies (Google rotates them)
  await context.storageState({ path: AUTH_FILE });
  await browser.close();

  console.log(`\n🏁 Terminé: ${created} créée(s), ${failed} échec(s).`);
  process.exit(failed > 0 && created === 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
