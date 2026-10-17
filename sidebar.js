let isRunning = false;

// Gather all config values from the UI
// Stores the data safety CSV content when a file is selected
let dataSafetyCsvContent = '';
// Stores the app logo as base64 (PNG) when a file is selected
let appLogoBase64 = '';
let appLogoUploaded = false;
let playScreenshotAssets = [];

function generateRandomPackageSegment(length = 12) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const bytes = new Uint8Array(length * 2);
  let segment = '';
  while (segment.length < length) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < 234 && segment.length < length) segment += alphabet[byte % alphabet.length];
    }
  }
  return segment;
}

function generateDefaultPackageName() {
  return `com.app${generateRandomPackageSegment()}.generated`;
}

// Theme color palette used for variant randomization
const VARIANT_COLOR_PALETTE = ['#8BC34A', '#558B2F', '#1565C0'];

// Shuffle the palette and assign one random color to each variant color input
function randomizeVariantColors() {
  const shuffled = [...VARIANT_COLOR_PALETTE];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const primary = document.getElementById('ghPrimaryColor');
  const dark = document.getElementById('ghDarkColor');
  const iconBg = document.getElementById('ghIconBg');
  if (primary) primary.value = shuffled[0];
  if (dark) dark.value = shuffled[1];
  if (iconBg) iconBg.value = shuffled[2];
}

const generatedPackageNames = new Map();

function parseAppLine(line, index) {
  const separator = line.indexOf('|');
  const name = (separator < 0 ? line : line.slice(0, separator)).trim();
  if (!name) return null;

  const providedPackage = separator < 0 ? '' : line.slice(separator + 1).trim();
  const cacheKey = `${index}\0${line}`;
  if (providedPackage) {
    if (!/^com\.taziggg100(?=\.|$)/i.test(providedPackage)) return { name, pkg: providedPackage };
    if (!generatedPackageNames.has(cacheKey)) {
      generatedPackageNames.set(cacheKey, providedPackage.replace(/^com\.taziggg100(?=\.|$)/i, `com.${generateRandomPackageSegment()}`));
    }
    return { name, pkg: generatedPackageNames.get(cacheKey) };
  }

  if (!generatedPackageNames.has(cacheKey)) {
    generatedPackageNames.set(cacheKey, generateDefaultPackageName());
  }
  return { name, pkg: generatedPackageNames.get(cacheKey) };
}

function getAppEntries(persistPackages = false) {
  const input = document.getElementById('appNames');
  const lines = input.value.split('\n').map(line => line.trim()).filter(Boolean);
  const apps = lines.map(parseAppLine).filter(Boolean);

  if (persistPackages) {
    input.value = apps.map(({ name, pkg }) => `${name}|${pkg}`).join('\n');
    const branchInput = document.getElementById('ghBranch');
    if (branchInput) branchInput.value = apps[0]?.pkg || '';
  }
  return apps;
}

// Per-window state persistence (side panel keeps logs across re-opens)
let _windowId = null;
function _stateKey() { return _windowId ? `panel_${_windowId}` : null; }

async function _saveState() {
  const key = _stateKey();
  if (!key) return;
  const statusEl = document.getElementById('status');
  const buildStatusEl = document.getElementById('buildStatus');
  const progressEl = document.getElementById('progressBar');
  const state = {
    logs: statusEl ? statusEl.innerHTML : '',
    buildLogs: buildStatusEl ? buildStatusEl.innerHTML : '',
    progress: progressEl ? progressEl.style.width : '0%',
    isRunning,
    ts: Date.now()
  };
  try { await chrome.storage.session.set({ [key]: state }); } catch(e) {}
}

async function _restoreState() {
  const key = _stateKey();
  if (!key) return;
  try {
    const data = await chrome.storage.session.get(key);
    const state = data[key];
    if (!state) return;
    // Only restore if less than 2 hours old
    if (Date.now() - state.ts > 2 * 60 * 60 * 1000) return;
    const statusEl = document.getElementById('status');
    const buildStatusEl = document.getElementById('buildStatus');
    const progressEl = document.getElementById('progressBar');
    if (statusEl && state.logs) statusEl.innerHTML = state.logs;
    if (buildStatusEl && state.buildLogs) buildStatusEl.innerHTML = state.buildLogs;
    if (progressEl && state.progress) progressEl.style.width = state.progress;
  } catch(e) {}
}

function getConfig() {
  const firstAppLine = (document.getElementById('appNames')?.value || '').split('\n')[0] || '';
  return {
    appName: firstAppLine.split('|')[0].trim(),
    privacyUrl: document.getElementById('privacyUrl').value.trim(),
    appAccess: document.getElementById('appAccess').value,
    containsAds: document.getElementById('containsAds').value,
    govApp: document.getElementById('govApp').value,
    targetAge: document.getElementById('targetAge').value,
    financialFeatures: document.getElementById('financialFeatures').value,
    healthApp: document.getElementById('healthApp').value,
    dataShared: document.getElementById('dataShared').value,
    crViolence: document.getElementById('crViolence').value,
    appCategory: document.getElementById('appCategory').value,
    contactEmail: document.getElementById('contactEmail').value.trim(),
    contactPhone: document.getElementById('contactPhone').value.trim(),
    websiteUrl: document.getElementById('websiteUrl').value.trim(),
    shortDesc: document.getElementById('shortDesc').value.trim(),
    fullDesc: document.getElementById('fullDesc').value.trim(),
    driveIconUrl: document.getElementById('driveIconUrl').value.trim(),
    driveScreenshotUrl: document.getElementById('driveScreenshotUrl').value.trim(),
    dataSafetyCsv: dataSafetyCsvContent,
  };
}

// Read data safety CSV file when selected
document.addEventListener('DOMContentLoaded', async () => {
  // Detect window ID for per-window state persistence
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) _windowId = tab.windowId;
  } catch(e) {
    try {
      const win = await chrome.windows.getCurrent();
      _windowId = win.id;
    } catch(e2) {}
  }
  // Restore logs/progress from previous side panel session for this window
  await _restoreState();

  // Toggle config section
  const configToggle = document.getElementById('configToggle');
  if (configToggle) {
    configToggle.addEventListener('click', function() {
      const section = document.getElementById('configSection');
      const btn = document.getElementById('configBtn');
      section.classList.toggle('open');
      if (section.classList.contains('open')) {
        this.textContent = '▼ Hide config fields';
        btn.style.display = 'block';
      } else {
        this.textContent = '▶ Show config fields';
        btn.style.display = 'none';
      }
    });
  }

  // Auto-load bundled default data safety CSV
  try {
    const csvUrl = chrome.runtime.getURL('data_safety_default.csv');
    const resp = await fetch(csvUrl);
    if (resp.ok) {
      dataSafetyCsvContent = await resp.text();
      console.log('Default data safety CSV loaded:', dataSafetyCsvContent.length, 'chars');
      const csvLabel = document.querySelector('label[for="dataSafetyCsv"], #dataSafetyCsv');
      const csvInput = document.getElementById('dataSafetyCsv');
      if (csvInput) {
        const hint = document.createElement('small');
        hint.style.color = '#2ed573';
        hint.textContent = '✅ Default CSV pre-loaded';
        csvInput.parentNode.insertBefore(hint, csvInput.nextSibling);
      }
    }
  } catch(e) { console.warn('Failed to load default data safety CSV:', e); }

  const csvInput = document.getElementById('dataSafetyCsv');
  if (csvInput) {
    csvInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          dataSafetyCsvContent = ev.target.result;
          console.log('Data safety CSV loaded:', file.name, dataSafetyCsvContent.length, 'chars');
        };
        reader.readAsText(file);
      }
    });
  }

  // Randomize theme colors button (picks from the variant palette)
  const randomizeColorsBtn = document.getElementById('ghRandomizeColors');
  if (randomizeColorsBtn) {
    randomizeColorsBtn.addEventListener('click', () => randomizeVariantColors());
  }

  // Logo file input: read as base64 PNG (resize to 512x512 via canvas)
  const logoInput = document.getElementById('ghAppLogo');
  if (logoInput) {
    logoInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) { appLogoBase64 = ''; appLogoUploaded = false; return; }
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 512, 512);
        // Store as raw base64 (no data: prefix)
        appLogoBase64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
        appLogoUploaded = true;
        // Show preview
        const preview = document.getElementById('logoPreview');
        const previewImg = document.getElementById('logoPreviewImg');
        if (preview && previewImg) {
          previewImg.src = canvas.toDataURL('image/png');
          preview.style.display = 'block';
        }
        console.log('Logo loaded and resized to 512x512:', (appLogoBase64.length * 0.75 / 1024).toFixed(1), 'KB');
      };
      img.src = URL.createObjectURL(file);
    });
  }

  const screenshotsInput = document.getElementById('ghPlayScreenshots');
  if (screenshotsInput) {
    screenshotsInput.addEventListener('change', async () => {
      const files = Array.from(screenshotsInput.files || []);
      const status = document.getElementById('playScreenshotsStatus');
      if (files.length > 8) {
        screenshotsInput.value = '';
        playScreenshotAssets = [];
        status.textContent = 'Select no more than 8 phone screenshots.';
        return;
      }
      if (files.some(file => !['image/png', 'image/jpeg'].includes(file.type) || file.size > 8 * 1024 * 1024)) {
        screenshotsInput.value = '';
        playScreenshotAssets = [];
        status.textContent = 'Use PNG or JPEG screenshots, each no larger than 8 MB.';
        return;
      }
      try {
        playScreenshotAssets = await Promise.all(files.map(file => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = String(reader.result);
            const image = new Image();
            image.onload = () => {
              const ratio = image.width / image.height;
              if (image.width < 320 || image.height < 320 || image.width > 3840 || image.height > 3840 || ratio > 2 || ratio < 0.5) {
                reject(new Error(`${file.name} must be 320–3840 px with an aspect ratio between 1:2 and 2:1.`));
                return;
              }
              resolve({
                name: file.name,
                mimeType: file.type,
                extension: file.type === 'image/png' ? 'png' : 'jpg',
                base64: dataUrl.replace(/^data:[^;]+;base64,/, '')
              });
            };
            image.onerror = () => reject(new Error(`Could not decode ${file.name}`));
            image.src = dataUrl;
          };
          reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
          reader.readAsDataURL(file);
        })));
        status.textContent = playScreenshotAssets.length
          ? `${playScreenshotAssets.length} Play Store screenshot(s) ready.`
          : 'Optional for AAB build; required for Play listing upload.';
      } catch (error) {
        playScreenshotAssets = [];
        status.textContent = error.message;
      }
    });
  }
});

// Auto-update branch field from first app's package name
document.addEventListener('DOMContentLoaded', () => {
  const appNamesEl = document.getElementById('appNames');
  const ghBranchEl = document.getElementById('ghBranch');
  if (appNamesEl && ghBranchEl) {
    const updateBranch = () => {
      const firstLine = appNamesEl.value.split('\n')[0] || '';
      const app = parseAppLine(firstLine.trim(), 0);
      ghBranchEl.value = app?.pkg || '';
    };
    appNamesEl.addEventListener('input', updateBranch);
    updateBranch();
  }
});

// Fetch developer email from Play Console account settings
document.addEventListener('DOMContentLoaded', () => {
  const fetchBtn = document.getElementById('fetchDevEmailBtn');
  if (fetchBtn) {
    fetchBtn.addEventListener('click', async () => {
      fetchBtn.disabled = true;
      fetchBtn.textContent = '⏳ Fetching...';
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url.includes('play.google.com/console')) {
          alert('Please navigate to Google Play Console first!');
          fetchBtn.disabled = false;
          fetchBtn.textContent = '📧 Fetch from Play Console';
          return;
        }
        // Extract dev ID from URL
        const devMatch = tab.url.match(/developers\/(\d+)/);
        if (!devMatch) {
          alert('Cannot find developer ID in URL.');
          fetchBtn.disabled = false;
          fetchBtn.textContent = '📧 Fetch from Play Console';
          return;
        }
        const devId = devMatch[1];
        // Navigate to developer account contact info page
        const contactUrl = `https://play.google.com/console/u/0/developers/${devId}/contact-details`;
        await chrome.tabs.update(tab.id, { url: contactUrl });
        // Wait for page to load
        await new Promise(r => setTimeout(r, 5000));
        // Extract email from the page
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // Look for email patterns in input fields and text on the contact-details page
            const inputs = document.querySelectorAll('input[type="email"], input[type="text"]');
            for (const inp of inputs) {
              if (inp.value && inp.value.includes('@')) return inp.value;
            }
            // Fallback: search in all visible text that looks like an email
            const allText = document.body.innerText;
            const emailMatch = allText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
            if (emailMatch) return emailMatch[0];
            return null;
          }
        });
        const email = results && results[0] && results[0].result;
        if (email) {
          document.getElementById('contactEmail').value = email;
          fetchBtn.textContent = '✅ Got it!';
          setTimeout(() => { fetchBtn.textContent = '📧 Fetch from Play Console'; }, 2000);
        } else {
          // Retry after a bit more wait (SPA may take longer)
          await new Promise(r => setTimeout(r, 3000));
          const retry = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const inputs = document.querySelectorAll('input[type="email"], input[type="text"]');
              for (const inp of inputs) {
                if (inp.value && inp.value.includes('@')) return inp.value;
              }
              const allText = document.body.innerText;
              const emailMatch = allText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
              if (emailMatch) return emailMatch[0];
              return null;
            }
          });
          const email2 = retry && retry[0] && retry[0].result;
          if (email2) {
            document.getElementById('contactEmail').value = email2;
            fetchBtn.textContent = '✅ Got it!';
            setTimeout(() => { fetchBtn.textContent = '📧 Fetch from Play Console'; }, 2000);
          } else {
            alert('Could not find developer email on the page. Try navigating to Settings > Developer account manually.');
            fetchBtn.textContent = '📧 Fetch from Play Console';
          }
        }
      } catch (e) {
        alert('Error: ' + e.message);
        fetchBtn.textContent = '📧 Fetch from Play Console';
      }
      fetchBtn.disabled = false;
    });

    // Fetch the developer email automatically when the active tab is Play Console.
    setTimeout(async () => {
      if (document.getElementById('contactEmail').value.trim()) return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url?.includes('play.google.com/console') && /developers\/\d+/.test(tab.url)) {
        fetchBtn.click();
      }
    }, 0);
  }
});

// Run all configuration tasks for a single app on its dashboard
async function configureApp(tab, devId, appId, appName, config, delay) {
  log(`  🔧 Auto-configuring "${appName}" (id=${appId})...`, 'info');

  const dashUrl = `https://play.google.com/console/u/0/developers/${devId}/app/${appId}/app-dashboard`;
  await chrome.tabs.update(tab.id, { url: dashUrl });
  await waitForTabLoad(tab.id);
  await sleep(4000);

  const taskResult = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: getDashboardTasks
  });
  const taskData = taskResult[0].result || { tasks: [], debug: [] };
  const tasks = taskData.tasks || taskData || [];

  const pending = Array.isArray(tasks) ? tasks.filter(t => !t.done) : [];
  const configTasks = pending.filter(t => {
    const pt = identifyPageType(t.label);
    return pt && pt !== 'skip';
  });
  log(`  ${configTasks.length} config task(s) to process`, 'info');

  if (configTasks.length === 0) {
    log('  No config tasks — app may already be configured.', 'info');
    return;
  }

  let categoryDone = false;
  for (const task of configTasks) {
    if (!isRunning) break;

    const pageType = identifyPageType(task.label);

    // Skip contact-details if category already handled coordonnées
    if (pageType === 'contact-details' && categoryDone) {
      log(`  → [${pageType}] ${task.label}... (skipped — already handled by category)`, 'info');
      continue;
    }

    log(`  → [${pageType}] ${task.label}...`, 'info');

    // Click the task button on the dashboard (SPA navigation)
    const clickResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: clickDashboardTask,
      args: [task.ariaLabel || task.label]
    });
    const clicked = clickResult[0].result;
    if (clicked !== true) {
      log(`  ⚠️ ${clicked}`, 'error');
      continue;
    }

    // SPA navigation: poll for URL to change from dashboard (faster than waitForTabLoad)
    for (let w = 0; w < 20; w++) {
      await sleep(500);
      const info = await chrome.tabs.get(tab.id);
      if (!info.url.includes('app-dashboard')) break;
    }
    await sleep(2000);

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: configPage,
        args: [pageType, config]
      });
      const r = results[0].result;
      if (r === true || (typeof r === 'string' && r.startsWith('OK:'))) {
        log(`  ✅ ${task.label} ${typeof r === 'string' ? r : ''}`, 'success');
      } else {
        log(`  ⚠️ ${task.label}: ${JSON.stringify(r)}`, 'error');
      }
    } catch (err) {
      log(`  ❌ ${task.label}: ${err.message}`, 'error');
    }

    if (pageType === 'category') categoryDone = true;

    // Go back to dashboard for next task (use direct navigation — faster than SPA back)
    await chrome.tabs.update(tab.id, { url: dashUrl });
    await waitForTabLoad(tab.id);
    await sleep(2000);
  }

  log(`  ✅ "${appName}" configuration complete`, 'success');
}

document.getElementById('startBtn').addEventListener('click', async () => {
  const apps = getAppEntries(true);

  if (apps.length === 0) {
    log('Enter at least one app name', 'error');
    return;
  }

  const language = document.getElementById('language').value;
  const appType = document.getElementById('appType').value;
  const pricing = document.getElementById('pricing').value;
  const delay = parseInt(document.getElementById('delay').value) || 5;
  const autoConfig = document.getElementById('autoConfig').checked;
  const config = autoConfig ? getConfig() : null;

  isRunning = true;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').style.display = 'block';
  document.getElementById('status').innerHTML = '';

  log(`Starting creation of ${apps.length} draft(s)...`, 'info');
  if (autoConfig) log('Auto-configure enabled — will configure each app after creation', 'info');

  // Get the active tab — must be on play.google.com
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes('play.google.com/console')) {
    log('Please navigate to Google Play Console first!', 'error');
    reset();
    return;
  }

  // Extract developer ID from URL
  const devMatch = tab.url.match(/developers\/(\d+)/);
  if (!devMatch) {
    log('Cannot find developer ID in URL. Go to Play Console dashboard.', 'error');
    reset();
    return;
  }
  const devId = devMatch[1];
  log(`Developer ID: ${devId}`, 'info');

  let autoBuildProjectType = null;
  let flutterWorkflowReady = false;
  if (document.getElementById('autoBuild').checked) {
    const ghToken = document.getElementById('ghToken').value.trim();
    const ghRepo = document.getElementById('ghRepo').value.trim();
    if (ghToken && ghRepo) {
      const baseBranch = document.getElementById('ghBaseBranch').value.trim() || 'main';
      try {
        const inspection = await showProjectInspection(ghToken, ghRepo, baseBranch);
        autoBuildProjectType = inspection.projectType;
        if (inspection.projectType === 'flutter') {
          const publishToPlay = document.getElementById('publishFlutterPlay').checked;
          await ensureFlutterBuildWorkflow(ghToken, ghRepo, publishToPlay);
          flutterWorkflowReady = true;
          log('Flutter project detected. Automatic build after each draft is enabled.', 'info');
        }
        else if (inspection.projectType !== 'android-native' || !inspection.safeForVariantWorkflow) {
          log('Project does not match the native Android variant workflow. No drafts were created.', 'error');
          reset();
          return;
        }
      } catch (error) {
        log(`Project preflight failed. No drafts were created: ${error.message}`, 'error');
        reset();
        return;
      }
    }
  }

  for (let i = 0; i < apps.length; i++) {
    if (!isRunning) {
      log('Stopped by user', 'info');
      break;
    }

    const { name, pkg } = apps[i];
    const progress = ((i + 1) / apps.length * 100).toFixed(0);
    document.getElementById('progressBar').style.width = progress + '%';

    log(`[${i + 1}/${apps.length}] Creating "${name}"${pkg ? ' (' + pkg + ')' : ''}...`, 'info');

    try {
      const ghToken = document.getElementById('ghToken').value.trim();
      const ghRepo = document.getElementById('ghRepo').value.trim();
      const listingCopy = ghToken && ghRepo
        ? await prepareAppListingCopy(ghToken, ghRepo, document.getElementById('ghBaseBranch').value.trim() || 'main', name, pkg, {
            shortDescription: document.getElementById('shortDesc').value.trim(),
            fullDescription: document.getElementById('fullDesc').value.trim()
          }, log)
        : {
            title: name.substring(0, 30),
            shortDescription: document.getElementById('shortDesc').value.trim(),
            fullDescription: document.getElementById('fullDesc').value.trim()
          };
      const appConfig = config ? {
        ...config,
        appName: listingCopy.title,
        shortDesc: listingCopy.shortDescription,
        fullDesc: listingCopy.fullDescription
      } : null;

      // Step 1: Navigate to create app page
      const createUrl = `https://play.google.com/console/u/0/developers/${devId}/app/create`;
      await chrome.tabs.update(tab.id, { url: createUrl });

      // Step 2: Wait for page to fully load
      await waitForTabLoad(tab.id);
      await sleep(2000); // initial wait

      // Step 3: Inject and run the form-filling script (it polls for splash to go away)
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillAndSubmitForm,
        args: [listingCopy.title, pkg, appType, pricing, false]
      });

      const result = results[0].result;
      if (result === true) {
        log(`✅ "${name}" — form submitted`, 'success');

        // Step 3.5: Auto-generate privacy policy URL before configuring
        if (document.getElementById('autoPrivacyPolicy').checked && isRunning) {
          let ghToken = document.getElementById('ghToken').value.trim();
          let ghRepo = document.getElementById('ghRepo').value.trim();
          // Fallback: read from storage if input is empty
          if (!ghToken || !ghRepo) {
            const stored = await new Promise(r => chrome.storage.local.get(['ghToken', 'ghRepo'], r));
            if (!ghToken && stored.ghToken) ghToken = stored.ghToken;
            if (!ghRepo && stored.ghRepo) ghRepo = stored.ghRepo;
          }
          // If still no repo but have token, derive owner from token for privacy-policies repo
          if (ghToken && !ghRepo) {
            try {
              const u = await fetch('https://api.github.com/user', { headers: { Authorization: `token ${ghToken}` } });
              if (u.ok) { const j = await u.json(); ghRepo = j.login + '/privacy-policies'; }
            } catch(_) {}
          }
          if (ghToken && ghRepo) {
            const privPkg = pkg;
            const contactEmail = document.getElementById('contactEmail').value.trim() || 'dev@example.com';
            const policyUrl = await pushPrivacyPolicyToBranch(ghToken, ghRepo, privPkg, listingCopy.title, privPkg, contactEmail, log);
            if (policyUrl) {
              document.getElementById('privacyUrl').value = policyUrl;
              if (appConfig) appConfig.privacyUrl = policyUrl;
              log(`  📜 Privacy URL set: ${policyUrl}`, 'info');
            }
          } else {
            log('  ⚠️ GitHub token/repo needed for auto privacy policy', 'error');
          }
        }

        // Step 4: Auto-configure if enabled
        if (autoConfig && isRunning) {
          // Wait for redirect after creation — poll for URL change up to 15s
          let appId = null;
          for (let w = 0; w < 15; w++) {
            await sleep(1000);
            const tabInfo = await chrome.tabs.get(tab.id);
            const appIdMatch = tabInfo.url.match(/\/app\/(\d+)/);
            if (appIdMatch) {
              appId = appIdMatch[1];
              log(`  App created with ID: ${appId}`, 'info');
              break;
            }
          }

          if (!appId) {
            // Fallback: go to app list and find the app
            log('  Could not extract app ID from URL, searching app list...', 'info');
            const listUrl = `https://play.google.com/console/u/0/developers/${devId}/app-list`;
            await chrome.tabs.update(tab.id, { url: listUrl });
            await waitForTabLoad(tab.id);
            await sleep(6000);

            const mapResult = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: extractAppList
            });
            const appMap = mapResult[0].result;

            // Log found apps for debugging
            const entries = Object.entries(appMap);
            log(`  Found ${entries.length} app(s) in list`, 'info');
            for (const [key, val] of entries) {
              log(`    📱 "${key}" → id=${val.id}, pkg=${val.pkg || 'n/a'}`, 'info');
            }

            // Try exact name match
            for (const [key, val] of entries) {
              if (key.toLowerCase().trim() === name.toLowerCase().trim()) { appId = val.id; break; }
            }
            // Try partial name match
            if (!appId) {
              for (const [key, val] of entries) {
                if (key.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(key.toLowerCase())) { appId = val.id; break; }
              }
            }
            // Try package match
            if (!appId && pkg) {
              for (const [key, val] of entries) {
                if (val.pkg && (val.pkg.includes(pkg) || pkg.includes(val.pkg))) { appId = val.id; break; }
              }
            }
            // Last resort: pick the most recently added app (last in list)
            if (!appId && entries.length > 0) {
              appId = entries[entries.length - 1][1].id;
              log(`  Using last app in list as fallback: ${entries[entries.length - 1][0]}`, 'info');
            }
          }

          if (appId) {
            await configureApp(tab, devId, appId, listingCopy.title, appConfig, delay);
          } else {
            log(`  ❌ Could not find "${name}" in app list for configuration`, 'error');
          }
        }

        // Step 5: Auto GitHub Build & Publish if enabled
        const autoBuild = document.getElementById('autoBuild').checked;
        if (autoBuild && isRunning) {
          // Shuffle theme colors from the palette for this app if enabled
          const randomPerApp = document.getElementById('ghRandomColorsPerApp');
          if (randomPerApp && randomPerApp.checked) randomizeVariantColors();
          // Generate default package name if not provided
          let buildPkg = pkg;
          if (!buildPkg) {
            buildPkg = generateDefaultPackageName();
            log(`  📦 No package provided, using default: ${buildPkg}`, 'info');
          }
          const ghToken = document.getElementById('ghToken').value.trim();
          const ghRepo = document.getElementById('ghRepo').value.trim();
          const ghPrimary = document.getElementById('ghPrimaryColor').value.trim() || '#8BC34A';
          const ghDark = document.getElementById('ghDarkColor').value.trim() || '#558B2F';
          const ghIconBg = document.getElementById('ghIconBg').value.trim() || '#1565C0';
          const shortDesc = document.getElementById('shortDesc').value.trim();
          const fullDesc = document.getElementById('fullDesc').value.trim();

          if (!ghToken || !ghRepo) {
            log('  ⚠️ GitHub token/repo not set — skipping auto-build', 'error');
          } else if (autoBuildProjectType === 'flutter') {
            const publishToPlay = document.getElementById('publishFlutterPlay').checked;
            const baseBranch = document.getElementById('ghBaseBranch').value.trim() || 'main';
            const buildOk = await runFlutterVariantBuild(ghToken, ghRepo, baseBranch, {
              applicationId: buildPkg,
              appName: listingCopy.title,
              title: listingCopy.title,
              shortDescription: listingCopy.shortDescription || (shortDesc || 'Discover Latest Movie & Series Trailers').substring(0, 80),
              fullDescription: listingCopy.fullDescription || fullDesc || `${name} lets you explore movie and TV show trailers powered by TMDB. Simple, fast, and easy to use.`,
              screenshots: playScreenshotAssets,
              publishToPlay,
              track: document.getElementById('ghTrack').value || 'internal'
            }, log, flutterWorkflowReady);
            if (buildOk) log(`  🎉 "${name}" Flutter build completed!`, 'success');
            else log(`  ⚠️ "${name}" Flutter build failed. Check GitHub Actions.`, 'error');
          } else {
            // Use package name as branch name
            const branchName = buildPkg;
            log(`  🚀 Auto-build: setup-variant → build for branch "${branchName}"`, 'log-info');

            const baseBranch = document.getElementById('ghBaseBranch').value.trim() || 'apkaward';
            // Get repo default branch (where setup-variant.yml lives)
            let defaultBranch = 'main';
            try {
              const repoInfo = await fetch(`https://api.github.com/repos/${ghRepo}`, {
                headers: { 'Authorization': `token ${ghToken}`, 'Accept': 'application/vnd.github.v3+json' }
              }).then(r => r.json());
              defaultBranch = repoInfo.default_branch || 'main';
            } catch(_) {}
            const setupInputs = {
              branch: branchName,
              application_id: buildPkg,
              app_name: listingCopy.title,
              title: listingCopy.title,
              short_description: listingCopy.shortDescription || (shortDesc || 'Discover Latest Movie & Series Trailers').substring(0, 80),
              full_description: listingCopy.fullDescription || fullDesc || `${name} lets you explore movie and TV show trailers powered by TMDB. Simple, fast, and easy to use.`,
              primary_color: ghPrimary,
              primary_dark: ghDark,
              icon_bg_color: ghIconBg,
              base_branch: baseBranch
            };
            const setupOk = await triggerAndWait(ghToken, ghRepo, 'setup-variant.yml', defaultBranch, setupInputs, `Setup ${name}`, log);
            if (setupOk) {
              log(`  ✅ Variant setup done for "${name}". Syncing workflows...`, 'success');
              // Push workflow files (build.yml) to variant branch so build triggers
              await pushWorkflowsToBranch(ghToken, ghRepo, branchName, log);
              // Push custom logo if uploaded
              await pushLogoToBranch(ghToken, ghRepo, branchName, log);
              // Build is auto-triggered by push to the new branch (branches: ['**'])
              // Just wait for it to appear and track it
              await new Promise(r => setTimeout(r, 8000));
              log(`  🔄 Waiting for build on ${branchName}...`, 'info');
              let buildRunId = null;
              let buildAlreadyDone = false;
              for (let w = 0; w < 15; w++) {
                const runsRes = await fetch(`https://api.github.com/repos/${ghRepo}/actions/runs?branch=${encodeURIComponent(branchName)}&per_page=5`, {
                  headers: { 'Authorization': `token ${ghToken}`, 'Accept': 'application/vnd.github.v3+json' }
                }).then(r => r.json());
                const runs = runsRes.workflow_runs || [];
                // Find any run that hasn't completed (covers in_progress, queued, waiting, pending, requested)
                const activeRun = runs.find(r => r.status !== 'completed');
                if (activeRun) { buildRunId = activeRun.id; break; }
                // If all runs completed, the build may have finished already
                if (runs.length > 0 && runs.every(r => r.status === 'completed')) {
                  buildRunId = runs[0].id; buildAlreadyDone = true; break;
                }
                await new Promise(r => setTimeout(r, 5000));
              }
              if (buildRunId) {
                if (buildAlreadyDone) {
                  const runRes = await fetch(`https://api.github.com/repos/${ghRepo}/actions/runs/${buildRunId}`, {
                    headers: { 'Authorization': `token ${ghToken}`, 'Accept': 'application/vnd.github.v3+json' }
                  }).then(r => r.json());
                  if (runRes.conclusion === 'success') {
                    log(`  🎉 "${name}" build succeeded!`, 'success');
                  } else {
                    log(`  ⚠️ Build finished: ${runRes.conclusion}. Check GitHub Actions.`, 'error');
                  }
                } else {
                  log(`  🏗️ Build #${buildRunId} running...`, 'info');
                  for (let p = 0; p < 60; p++) {
                    const runRes = await fetch(`https://api.github.com/repos/${ghRepo}/actions/runs/${buildRunId}`, {
                      headers: { 'Authorization': `token ${ghToken}`, 'Accept': 'application/vnd.github.v3+json' }
                    }).then(r => r.json());
                    if (runRes.status === 'completed') {
                      if (runRes.conclusion === 'success') {
                        log(`  🎉 "${name}" build succeeded!`, 'success');
                      } else {
                        log(`  ⚠️ Build finished: ${runRes.conclusion}. Check GitHub Actions.`, 'error');
                      }
                      break;
                    }
                    await new Promise(r => setTimeout(r, 15000));
                  }
                }
              } else {
                log(`  ⚠️ Could not find build run. Check GitHub Actions manually.`, 'error');
              }
            } else {
              log(`  ❌ Variant setup failed for "${name}".`, 'error');
            }
          }
        }
      } else {
        log(`❌ "${name}" — ${result}`, 'error');
      }

      // Wait before next app
      await sleep(delay * 1000);

    } catch (err) {
      log(`❌ "${name}" error: ${err.message}`, 'error');
    }
  }

  log('Done!', 'success');
  reset();
});

document.getElementById('stopBtn').addEventListener('click', () => {
  isRunning = false;
  consoleFetchRunning = false;
  log('Stopping...', 'info');
});

function reset() {
  isRunning = false;
  document.getElementById('startBtn').disabled = false;
  document.getElementById('configBtn').disabled = false;
  document.getElementById('stopBtn').style.display = 'none';
}

function log(msg, type = '') {
  const div = document.getElementById('status');
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.textContent = msg;
  div.prepend(entry);
  _saveState();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Timeout after 20s
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 20000);
  });
}

// ==================== APP CONFIGURATION ====================

document.getElementById('configBtn').addEventListener('click', async () => {
  const lines = document.getElementById('appNames').value.split('\n').map(n => n.trim()).filter(n => n);
  const apps = lines.map(line => {
    const parts = line.split('|');
    return { name: parts[0].trim(), pkg: (parts[1] || '').trim() };
  });
  if (apps.length === 0) { log('Enter at least one app', 'error'); return; }

  const config = getConfig();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url.includes('play.google.com/console')) {
    log('Navigate to Play Console first!', 'error'); return;
  }
  const devMatch = tab.url.match(/developers\/(\d+)/);
  if (!devMatch) { log('Cannot find developer ID', 'error'); return; }
  const devId = devMatch[1];
  const delay = parseInt(document.getElementById('delay').value) || 8;

  isRunning = true;
  document.getElementById('configBtn').disabled = true;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').style.display = 'block';
  document.getElementById('status').innerHTML = '';
  log(`Starting configuration of ${apps.length} app(s)...`, 'info');
  log(`Config: privacy=${config.privacyUrl ? 'yes' : 'no'}, email=${config.contactEmail || 'none'}`, 'info');

  try {

  // Step 1: Go to app list and extract all app IDs
  log('Loading app list...', 'info');
  const listUrl = `https://play.google.com/console/u/0/developers/${devId}/app-list`;
  await chrome.tabs.update(tab.id, { url: listUrl });
  await waitForTabLoad(tab.id);
  await sleep(5000);

  const mapResult = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractAppList
  });
  const appMap = mapResult[0].result;
  const appCount = Object.keys(appMap).length;
  log(`Found ${appCount} app(s) in console`, 'info');

  for (const [key, val] of Object.entries(appMap)) {
    log(`  📱 "${key}" → id=${val.id}, pkg=${val.pkg || 'n/a'}`, 'info');
  }

  if (appCount === 0) {
    log('No apps found! The app list page may not have loaded.', 'error');
    reset(); return;
  }

  for (let i = 0; i < apps.length; i++) {
    if (!isRunning) { log('Stopped by user', 'info'); break; }
    const { name, pkg } = apps[i];
    const progress = ((i + 1) / apps.length * 100).toFixed(0);
    document.getElementById('progressBar').style.width = progress + '%';
    log(`[${i + 1}/${apps.length}] Configuring "${name}"${pkg ? ' (' + pkg + ')' : ''}...`, 'info');

    // Auto-generate privacy policy per app if checkbox is enabled
    if (document.getElementById('autoPrivacyPolicy').checked) {
      let ghToken = document.getElementById('ghToken').value.trim();
      let ghRepo = document.getElementById('ghRepo').value.trim();
      if (!ghToken || !ghRepo) {
        const stored = await new Promise(r => chrome.storage.local.get(['ghToken', 'ghRepo'], r));
        if (!ghToken && stored.ghToken) ghToken = stored.ghToken;
        if (!ghRepo && stored.ghRepo) ghRepo = stored.ghRepo;
      }
      if (ghToken && !ghRepo) {
        try {
          const u = await fetch('https://api.github.com/user', { headers: { Authorization: `token ${ghToken}` } });
          if (u.ok) { const j = await u.json(); ghRepo = j.login + '/privacy-policies'; }
        } catch(_) {}
      }
      if (ghToken && ghRepo) {
        let privPkg = pkg;
        if (!privPkg) {
          privPkg = generateDefaultPackageName();
        }
        const contactEmail = config.contactEmail || 'dev@example.com';
        const policyUrl = await pushPrivacyPolicyToBranch(ghToken, ghRepo, privPkg, name, privPkg, contactEmail, log);
        if (policyUrl) {
          config.privacyUrl = policyUrl;
          log(`  📜 Privacy URL: ${policyUrl}`, 'info');
        }
      } else {
        log('  ⚠️ GitHub token/repo needed for auto privacy policy', 'error');
      }
    }

    // Find app ID by name or package
    let appId = null;
    for (const [key, val] of Object.entries(appMap)) {
      if (key.toLowerCase().trim() === name.toLowerCase().trim()) { appId = val.id; break; }
    }
    if (!appId) {
      for (const [key, val] of Object.entries(appMap)) {
        if (key.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(key.toLowerCase())) { appId = val.id; break; }
      }
    }
    if (!appId && pkg) {
      for (const [key, val] of Object.entries(appMap)) {
        if (val.pkg && (val.pkg.includes(pkg) || pkg.includes(val.pkg))) { appId = val.id; break; }
      }
    }
    if (!appId) {
      log(`  ❌ "${name}" not found in app list.`, 'error');
      continue;
    }

    await configureApp(tab, devId, appId, name, config, delay);
  }

  log('All apps configured!', 'success');

  } catch (err) {
    log(`❌ FATAL ERROR: ${err.message}`, 'error');
    log(err.stack || '', 'error');
  }

  reset();
});

// Map task label to page type
function identifyPageType(label) {
  // Normalize: replace &nbsp; / non-breaking spaces with regular spaces
  const l = label.toLowerCase().replace(/\u00a0/g, ' ');
  if (l.includes('confidentialit') || l.includes('privacy') || l.includes('règles de conf')) return 'privacy-policy';
  if (l.includes('accès aux app') || l.includes('app access')) return 'app-access';
  if (l.includes('sign in details')) return 'app-access';
  if (l.includes('annonces') || l.includes('ads')) return 'ads';
  if (l.includes('classification') || l.includes('content rating') || l.includes('rating')) return 'content-rating';
  if (l.includes('cible') || l.includes('target')) return 'target-audience';
  if (l.includes('sécurité des données') || l.includes('data safety')) return 'data-safety';
  if (l.includes('gouvernement') || l.includes('government') || l.includes('applis gouv')) return 'gov-apps';
  if (l.includes('financ')) return 'financial';
  if (l.includes('santé') || l.includes('health')) return 'health';
  if (l.includes('catégorie') || l.includes('category')) return 'category';
  if (l.includes('coordonnées') || l.includes('contact detail') || l.includes('coordonnées sur la fiche')) return 'contact-details';
  if (l.includes('fiche') || l.includes('store listing') || l.includes('play store')) return 'store-listing';
  if (l.includes('nouvelles') || l.includes('news')) return 'news';
  if (l.includes('contenu de votre app') || l.includes('content desc') || l.includes('décrire le contenu')) return 'content-desc';
  // Publishing tasks — skip silently
  if (l.includes('publier') || l.includes('publish') || l.includes('release') || l.includes('app bundle') ||
      l.includes('apk') || l.includes('examen') || l.includes('review') || l.includes('testeur') ||
      l.includes('tester') || l.includes('pays') || l.includes('countr') || l.includes('région') ||
      l.includes('préinscription') || l.includes('pre-registration') || l.includes('récompense') ||
      l.includes('prévisualiser') || l.includes('preview') || l.includes('confirmer') ||
      l.includes('sélectionner les test') || l.includes('créer une release') || l.includes('importer')) return 'skip';
  return null;
}

// ===== INJECTED: Extract app list from app-list page =====
function extractAppList() {
  return new Promise(async (resolve) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (let w = 0; w < 30; w++) {
      const splash = document.getElementById('console-splash-021280');
      if (!splash || splash.classList.contains('hide') || splash.style.opacity === '0' || splash.style.display === 'none') break;
      await sleep(1000);
    }
    await sleep(3000);

    const result = {};

    // Strategy 1: Find links with /app/ in href
    const links = document.querySelectorAll('a[href*="/app/"]');
    for (const a of links) {
      const match = a.href.match(/\/app\/(\d+)/);
      if (!match) continue;
      const id = match[1];
      let name = '';
      // Try spans/divs inside the link
      const spans = a.querySelectorAll('span, div');
      for (const s of spans) {
        const t = s.textContent.trim();
        if (t.length > 1 && t.length < 80 && !t.match(/^\d+$/) && !t.includes('/') && !t.match(/^(Draft|Brouillon|Active|Published)$/i)) {
          name = t; break;
        }
      }
      if (!name) {
        // Take first line of link text
        name = a.textContent.trim().split('\n')[0].trim();
      }
      if (name.length > 80) name = name.substring(0, 80);

      // Find package name in the row
      const row = a.closest('tr, [role="row"], [role="listitem"], [class*="row"]') || a.parentElement?.parentElement || a.parentElement;
      let pkg = '';
      if (row) {
        const pkgMatch = row.textContent.match(/([a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,})/i);
        if (pkgMatch) pkg = pkgMatch[0];
      }

      if (name && id && !result[name]) {
        result[name] = { id, pkg };
      }
    }

    // Strategy 2: If no apps found, try looking at the full page for app patterns
    if (Object.keys(result).length === 0) {
      // Look for any clickable element that leads to an app
      const allElements = document.querySelectorAll('[href*="/app/"], [data-app-id]');
      for (const el of allElements) {
        const href = el.getAttribute('href') || '';
        const match = href.match(/\/app\/(\d+)/);
        const dataId = el.getAttribute('data-app-id');
        const id = match ? match[1] : dataId;
        if (!id) continue;
        const name = el.textContent.trim().split('\n')[0].trim().substring(0, 80);
        if (name && !result[name]) {
          result[name] = { id, pkg: '' };
        }
      }
    }

    resolve(result);
  });
}

// ===== INJECTED: Get dashboard setup checklist tasks =====
function getDashboardTasks() {
  return new Promise(async (resolve) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const dbg = [];

    // Wait for splash screen
    for (let w = 0; w < 30; w++) {
      const splash = document.getElementById('console-splash-021280');
      if (!splash || splash.classList.contains('hide') || splash.style.opacity === '0' || splash.style.display === 'none') {
        dbg.push(`Splash gone after ${w}s`);
        break;
      }
      await sleep(1000);
    }
    await sleep(4000);

    dbg.push(`Page title: ${document.title}`);
    dbg.push(`URL: ${location.href.substring(location.href.indexOf('/app/'))}`);

    // Step 1: Click "Afficher les tâches" / "Show tasks" button to expand the task list
    const allButtons = document.querySelectorAll('button');
    let expandClicked = false;
    for (const btn of allButtons) {
      const t = btn.textContent.trim().toLowerCase();
      if (t.includes('afficher les tâches') || t.includes('show tasks') || t.includes('afficher les') || t.includes('view tasks')) {
        btn.click();
        expandClicked = true;
        dbg.push(`Clicked expand: "${t.substring(0, 40)}"`);
        await sleep(2000);
        break;
      }
    }
    // Also try clicking all expand buttons (there may be multiple sections)
    if (!expandClicked) {
      const expansionBtns = document.querySelectorAll('.expansion-button, button[aria-expanded="false"]');
      for (const btn of expansionBtns) {
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('tâches') || label.includes('tasks') || label.includes('objectif')) {
          btn.click();
          dbg.push(`Clicked expand by aria-label: "${label.substring(0, 50)}"`);
          await sleep(1500);
        }
      }
    }
    await sleep(1000);

    // Step 2: Find tasks via debug-id="task-text" spans (primary) or role="button" with aria-label (fallback)
    const tasks = [];

    // Strategy 1: span[debug-id="task-text"] inside task components
    const taskSpans = document.querySelectorAll('span[debug-id="task-text"]');
    dbg.push(`Found ${taskSpans.length} task-text spans`);
    for (const span of taskSpans) {
      const label = span.textContent.trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
      if (label.length < 2) continue;

      // Check if task is done: look for check_circle icon or completed class in parent <task>
      const taskEl = span.closest('task') || span.closest('.pc-flex');
      let done = false;
      if (taskEl) {
        // Look for completed task icon (check_circle or done icon)
        const icons = taskEl.querySelectorAll('material-icon i, .material-icon-i');
        for (const icon of icons) {
          const txt = icon.textContent.trim().toLowerCase();
          if (txt === 'check_circle' || txt === 'task_alt' || txt === 'done') {
            done = true; break;
          }
        }
        // Check for debug-id="completed-task-icon" or "done-task-icon"
        if (taskEl.querySelector('[debug-id*="completed"], [debug-id*="done"]')) {
          done = true;
        }
      }

      // Find the clickable button for this task
      const button = span.closest('[role="button"]') || span.closest('div[buttondecorator]');
      const ariaLabel = button ? (button.getAttribute('aria-label') || '') : '';

      tasks.push({ label, done, ariaLabel: ariaLabel || label });
    }

    // Strategy 2 fallback: div[role="button"] with aria-label inside task containers
    if (tasks.length === 0) {
      dbg.push('Fallback: searching role=button with aria-label');
      const buttons = document.querySelectorAll('task div[role="button"], div[buttondecorator][role="button"]');
      for (const btn of buttons) {
        const label = (btn.getAttribute('aria-label') || btn.textContent.trim()).replace(/\s+/g, ' ');
        if (label.length < 3 || label.length > 150) continue;
        // Clean out icon text
        const clean = label.replace(/chevron_right|arrow_forward|check_circle|task_alt/gi, '').trim();
        if (clean.length < 3) continue;
        tasks.push({ label: clean, done: false, ariaLabel: btn.getAttribute('aria-label') || clean });
      }
      dbg.push(`Fallback found: ${tasks.length}`);
    }

    // Deduplicate by label
    const seen = new Set();
    const unique = tasks.filter(t => {
      const key = t.label.toLowerCase().substring(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    dbg.push(`Total unique tasks: ${unique.length}`);
    resolve({ tasks: unique, debug: dbg });
  });
}

// ===== INJECTED: Click a specific task button on the dashboard by its aria-label =====
function clickDashboardTask(ariaLabel) {
  return new Promise(async (resolve) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // Normalize: replace non-breaking spaces with regular spaces
    const normalize = s => s.replace(/\u00a0/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const target = normalize(ariaLabel).toLowerCase();

    // Wait for page content to render after navigation
    await sleep(2000);

    // Re-expand task sections (they collapse after navigation)
    for (let expAttempt = 0; expAttempt < 3; expAttempt++) {
      // Try "Afficher les tâches" button
      const allBtns = document.querySelectorAll('button');
      for (const b of allBtns) {
        const t = b.textContent.trim().toLowerCase();
        if (t.includes('afficher les tâches') || t.includes('show tasks') || t.includes('view tasks')) {
          b.click();
          await sleep(1500);
          break;
        }
      }
      // Try aria-expanded expansion buttons
      const expansionBtns = document.querySelectorAll('.expansion-button, button[aria-expanded="false"]');
      for (const b of expansionBtns) {
        const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
        if (label.includes('tâches') || label.includes('tasks') || label.includes('objectif') || label.includes('afficher')) {
          b.click();
          await sleep(1000);
        }
      }
      // Check if task spans are visible now
      const spans = document.querySelectorAll('span[debug-id="task-text"]');
      if (spans.length > 0) break;
      await sleep(2000);
    }
    await sleep(500);

    // Strategy 1: Find by span[debug-id="task-text"] content (most reliable)
    let btn = null;
    const spans = document.querySelectorAll('span[debug-id="task-text"]');
    for (const span of spans) {
      const spanText = normalize(span.textContent).toLowerCase();
      if (spanText === target || spanText.includes(target) || target.includes(spanText)) {
        btn = span.closest('[role="button"]') || span.closest('div[buttondecorator]') || span.closest('a');
        // If no role=button ancestor, walk up to find any clickable parent
        if (!btn) {
          let el = span.parentElement;
          for (let i = 0; i < 8 && el; i++) {
            if (el.getAttribute('role') === 'button' || el.tagName === 'BUTTON' ||
                el.tagName === 'A' || el.hasAttribute('buttondecorator') ||
                el.style.cursor === 'pointer' || el.onclick) {
              btn = el; break;
            }
            el = el.parentElement;
          }
        }
        // Last resort: just click the span itself (SPA navigation may still fire)
        if (!btn) btn = span;
        break;
      }
    }

    // Strategy 2: Match aria-label on div[role="button"] or a[role="button"]
    if (!btn) {
      const candidates = document.querySelectorAll('[role="button"][aria-label]');
      for (const c of candidates) {
        const al = normalize(c.getAttribute('aria-label')).toLowerCase();
        if (al === target || al.includes(target) || target.includes(al)) {
          btn = c; break;
        }
      }
    }

    // Strategy 3: TreeWalker - find text node with matching text, walk up to clickable ancestor
    if (!btn) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while (node = walker.nextNode()) {
        const text = normalize(node.textContent).toLowerCase();
        if (text.length < 5) continue;
        if (text === target || (target.includes(text) && text.length > target.length * 0.5) ||
            (text.includes(target) && target.length > 5)) {
          let el = node.parentElement;
          for (let i = 0; i < 8 && el; i++) {
            if (el.getAttribute('role') === 'button' || el.tagName === 'BUTTON' ||
                el.tagName === 'A' || el.hasAttribute('buttondecorator') ||
                el.style.cursor === 'pointer') {
              btn = el; break;
            }
            el = el.parentElement;
          }
          if (btn) break;
          // Fallback: click the text's parent element directly
          if (node.parentElement) { btn = node.parentElement; break; }
        }
      }
    }

    if (btn) {
      btn.click();
      resolve(true);
    } else {
      // Debug: log what task spans ARE on the page
      const debugSpans = Array.from(document.querySelectorAll('span[debug-id="task-text"]'))
        .map(s => s.textContent.trim().substring(0, 60)).join(' | ');
      resolve('Task button not found: ' + ariaLabel + ' [available: ' + (debugSpans || 'NONE') + ']');
    }
  });
}

// ===== INJECTED: Configure a specific page =====
function configPage(pageType, config) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  return new Promise(async (resolve) => {
    try {
      const dbg = [];

      // Wait for splash
      for (let w = 0; w < 30; w++) {
        const splash = document.getElementById('console-splash-021280');
        if (!splash || splash.classList.contains('hide') || splash.style.opacity === '0' || splash.style.display === 'none') break;
        if (w === 29) { resolve('Splash timeout'); return; }
        await sleep(1000);
      }
      await sleep(2000);

      // Helpers
      const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;

      const setInput = (inp, val) => {
        inp.focus(); inp.click();
        nativeInputSetter.call(inp, val);
        inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        inp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      };

      const setTextarea = (ta, val) => {
        ta.focus(); ta.click();
        nativeTextareaSetter.call(ta, val);
        ta.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      };

      // Convert Google Drive sharing URL to direct download URL
      const convertDriveUrl = (url) => {
        if (!url) return null;
        // Handle: https://drive.google.com/file/d/FILE_ID/view?...
        let match = url.match(/\/file\/d\/([^\/]+)/);
        if (match) return `https://drive.google.com/uc?export=download&id=${match[1]}`;
        // Handle: https://drive.google.com/open?id=FILE_ID
        match = url.match(/[?&]id=([^&]+)/);
        if (match) return `https://drive.google.com/uc?export=download&id=${match[1]}`;
        return url; // Return as-is if not recognized
      };

      // Fetch image from URL and inject it into a file input on the page
      const uploadImageFromUrl = async (imageUrl, type, dbg) => {
        try {
          // Fetch the image
          const response = await fetch(imageUrl);
          if (!response.ok) {
            dbg.push(`${type}: fetch failed (${response.status})`);
            return false;
          }
          const blob = await response.blob();
          const fileName = type === 'icon' ? 'icon.png' : 'screenshot.png';
          const file = new File([blob], fileName, { type: blob.type || 'image/png' });

          // Find the right file input — look for nearby labels/text
          const fileInputs = document.querySelectorAll('input[type="file"]');
          dbg.push(`${type}: found ${fileInputs.length} file inputs`);

          let targetInput = null;
          for (const fi of fileInputs) {
            // Check accept attribute
            const accept = (fi.getAttribute('accept') || '').toLowerCase();
            // Walk parent to find label text
            let parentText = '';
            let el = fi.parentElement;
            for (let i = 0; i < 8 && el; i++) {
              parentText = el.textContent.toLowerCase();
              if (parentText.length > 5 && parentText.length < 500) break;
              el = el.parentElement;
            }

            if (type === 'icon') {
              if (parentText.includes('icône') || parentText.includes('icon') ||
                  parentText.includes('512') || parentText.includes('app icon')) {
                targetInput = fi;
                dbg.push(`${type}: matched input by label "${parentText.substring(0, 50)}"`);
                break;
              }
            } else if (type === 'screenshot') {
              if (parentText.includes('capture') || parentText.includes('screenshot') ||
                  parentText.includes('écran') || parentText.includes('screen')) {
                targetInput = fi;
                dbg.push(`${type}: matched input by label "${parentText.substring(0, 50)}"`);
                break;
              }
            }
          }

          // Fallback: if we didn't find a specific input, try clicking upload buttons
          if (!targetInput) {
            // Look for an upload/import button near the right section
            const allBtns = document.querySelectorAll('button, [role="button"], a');
            for (const btn of allBtns) {
              const t = btn.textContent.toLowerCase().trim();
              const parentText = (btn.closest('[class]')?.textContent || '').toLowerCase();
              if (type === 'icon' &&
                  (parentText.includes('icône') || parentText.includes('icon') || parentText.includes('512')) &&
                  (t.includes('import') || t.includes('télécharger') || t.includes('upload') || t.includes('ajouter') || t.includes('add'))) {
                btn.click();
                dbg.push(`${type}: clicked upload button "${t.substring(0, 40)}"`);
                await sleep(2000);
                // Re-check for file inputs
                const newInputs = document.querySelectorAll('input[type="file"]');
                if (newInputs.length > fileInputs.length) {
                  targetInput = newInputs[newInputs.length - 1];
                  dbg.push(`${type}: new file input appeared after button click`);
                }
                break;
              }
              if (type === 'screenshot' &&
                  (parentText.includes('capture') || parentText.includes('screenshot') || parentText.includes('écran')) &&
                  (t.includes('import') || t.includes('télécharger') || t.includes('upload') || t.includes('ajouter') || t.includes('add'))) {
                btn.click();
                dbg.push(`${type}: clicked upload button "${t.substring(0, 40)}"`);
                await sleep(2000);
                const newInputs = document.querySelectorAll('input[type="file"]');
                if (newInputs.length > fileInputs.length) {
                  targetInput = newInputs[newInputs.length - 1];
                  dbg.push(`${type}: new file input appeared after button click`);
                }
                break;
              }
            }
          }

          // If still no target, use first/last file input as fallback
          if (!targetInput && fileInputs.length > 0) {
            if (type === 'icon') {
              targetInput = fileInputs[0];
              dbg.push(`${type}: using first file input (fallback)`);
            } else {
              targetInput = fileInputs[fileInputs.length - 1];
              dbg.push(`${type}: using last file input (fallback)`);
            }
          }

          if (targetInput) {
            // Create a DataTransfer to set files on the input
            const dt = new DataTransfer();
            dt.items.add(file);
            targetInput.files = dt.files;
            targetInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            targetInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            dbg.push(`${type}: file injected (${(blob.size / 1024).toFixed(1)}KB)`);
            await sleep(3000); // Wait for upload processing
            return true;
          }

          dbg.push(`${type}: no file input found`);
          return false;
        } catch (err) {
          dbg.push(`${type}: error - ${err.message}`);
          return false;
        }
      };

      // Click a radio whose label matches any of the given texts
      const clickRadio = async (matchTexts) => {
        // Helper: match text with word boundary for short words to avoid false positives
        const textMatches = (text, match) => {
          const m = match.toLowerCase();
          if (m.length <= 4) {
            // For short words like 'non','no','oui','yes' use word boundary
            return new RegExp('\\b' + m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(text);
          }
          return text.includes(m);
        };
        // Strategy 1: Native radios
        const radios = document.querySelectorAll('input[type="radio"]');
        for (const radio of radios) {
          let text = '';
          // Walk up to find label text
          const lbl = radio.closest('label') || (radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`) : null);
          if (lbl) text = lbl.textContent.trim().toLowerCase();
          if (!text) {
            let el = radio.parentElement;
            for (let i = 0; i < 5 && el; i++) {
              const t = el.textContent.trim().toLowerCase();
              if (t.length > 0 && t.length < 120) { text = t; break; }
              el = el.parentElement;
            }
          }
          for (const match of matchTexts) {
            if (textMatches(text, match)) {
              radio.click();
              radio.dispatchEvent(new Event('change', { bubbles: true }));
              dbg.push(`Radio native: "${text.substring(0, 40)}" ← ${match}`);
              await sleep(300);
              return true;
            }
          }
        }
        // Strategy 2: Angular Material radio buttons (mat-radio-button / [role="radio"])
        const matRadios = document.querySelectorAll('mat-radio-button, [role="radio"], .mat-mdc-radio-button');
        for (const mr of matRadios) {
          const text = mr.textContent.trim().toLowerCase();
          for (const match of matchTexts) {
            if (textMatches(text, match)) {
              // Click the inner label or the component itself
              const inner = mr.querySelector('label, .mdc-label, .mdc-radio') || mr;
              inner.click();
              mr.dispatchEvent(new Event('change', { bubbles: true }));
              dbg.push(`Radio mat: "${text.substring(0, 40)}" ← ${match}`);
              await sleep(300);
              return true;
            }
          }
        }
        // Strategy 3: div/span acting as radio with aria-label
        const ariaRadios = document.querySelectorAll('[role="radio"][aria-label]');
        for (const ar of ariaRadios) {
          const text = (ar.getAttribute('aria-label') || '').toLowerCase();
          for (const match of matchTexts) {
            if (textMatches(text, match)) {
              ar.click();
              dbg.push(`Radio aria: "${text.substring(0, 40)}" ← ${match}`);
              await sleep(300);
              return true;
            }
          }
        }
        dbg.push(`No radio for: ${matchTexts.join(', ')}`);
        return false;
      };

      // Click all radios matching "no" / "non"
      const clickAllNo = async () => {
        let clicked = 0;
        // Native radios
        const radios = document.querySelectorAll('input[type="radio"]');
        for (const radio of radios) {
          let text = '';
          const lbl = radio.closest('label') || (radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`) : null);
          if (lbl) text = lbl.textContent.trim().toLowerCase();
          if (!text) {
            let el = radio.parentElement;
            for (let i = 0; i < 4 && el; i++) {
              const t = el.textContent.trim().toLowerCase();
              if (t.length > 0 && t.length < 80) { text = t; break; }
              el = el.parentElement;
            }
          }
          // Use word boundary matching to avoid false positives (e.g. "non" in "annonces")
          if (/\bnon\b/.test(text) || /\bno\b/.test(text)) {
            radio.click();
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            clicked++;
            await sleep(200);
          }
        }
        // Angular Material radios
        const matRadios = document.querySelectorAll('mat-radio-button, [role="radio"], .mat-mdc-radio-button');
        for (const mr of matRadios) {
          const text = mr.textContent.trim().toLowerCase();
          if (/\bnon\b/.test(text) || /\bno\b/.test(text)) {
            const inner = mr.querySelector('label, .mdc-label, .mdc-radio') || mr;
            inner.click();
            mr.dispatchEvent(new Event('change', { bubbles: true }));
            clicked++;
            await sleep(200);
          }
        }
        if (clicked > 0) dbg.push(`clickAllNo: ${clicked} clicked`);
      };

      // Find and click save/submit button
      const clickSave = async () => {
        await sleep(500);
        let disabledMatch = '';
        for (let attempt = 0; attempt < 8; attempt++) {
          // Re-query fresh buttons each attempt, including Play Console custom main buttons
          const buttons = Array.from(document.querySelectorAll(
            'button, [debug-id="main-button"], material-button[debug-id="main-button"]'
          )).filter((btn, index, all) => all.indexOf(btn) === index);
          let bestBtn = null;
          let bestLen = 9999;
          for (const btn of buttons) {
            if (btn.getClientRects().length === 0) continue;
            const t = btn.textContent.toLowerCase().trim();
            const accessible = [btn.getAttribute('aria-label'), btn.getAttribute('title'), btn.getAttribute('debug-id')]
              .filter(Boolean).join(' ').toLowerCase();
            const buttonText = `${t} ${accessible}`;
            const isDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
            if (isDisabled && (buttonText.includes('save') || buttonText.includes('enregistrer') || accessible.includes('main-button'))) {
              disabledMatch = buttonText.substring(0, 80);
            }
            if ((buttonText.includes('enregistrer') || buttonText.includes('save') || buttonText.includes('soumettre') ||
                 buttonText.includes('submit') || buttonText.includes('envoyer') || buttonText.includes('confirmer') || buttonText.includes('confirm') ||
                 buttonText.includes('mettre à jour') || buttonText.includes('update') ||
                 buttonText.includes('terminer') || buttonText.includes('finish') || buttonText.includes('done') ||
                 accessible.includes('main-button')) &&
                !buttonText.includes('annuler') && !buttonText.includes('cancel') && !buttonText.includes('publier') &&
                !buttonText.includes('répondre') && !buttonText.includes('commencer') && !buttonText.includes('suivant') &&
                !buttonText.includes('next') &&
                !buttonText.includes('brouillon') && !buttonText.includes('draft') &&
                !isDisabled) {
              // Prefer the shortest matching button (e.g. "Enregistrer" over "Enregistrer comme brouillon")
              if (t.length < bestLen) {
                bestBtn = btn;
                bestLen = t.length;
              }
            }
          }
          if (bestBtn) {
            const t = bestBtn.textContent.toLowerCase().trim();
            bestBtn.click();
            dbg.push(`Save: "${t.substring(0, 30)}" (attempt ${attempt})`);
            await sleep(3000);
            return true;
          }
          await sleep(1500);
        }
        dbg.push(disabledMatch ? `Save button disabled: ${disabledMatch}` : 'No save button found after 8 attempts');
        return false;
      };

      // Click "Commencer" / "Start" / "Répondre" etc. if present
      const clickStart = async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
          const elems = document.querySelectorAll('button, a, [role="button"]');
          for (const el of elems) {
            const t = el.textContent.toLowerCase().trim();
            // Only match actual action button text, avoid matching headers/links
            if ((t === 'commencer' || t === 'start' || t === 'démarrer' || t === 'begin' ||
                 t === 'répondre' || t === 'remplir' ||
                 t.startsWith('commencer ') || t.startsWith('start ') ||
                 t.startsWith('répondre ') || t.startsWith('remplir ') ||
                 t.startsWith('démarrer ')) &&
                !el.disabled &&
                t.length < 80) {
              el.click();
              dbg.push(`Start: "${t.substring(0, 50)}" (attempt ${attempt})`);
              await sleep(2000);
              return true;
            }
          }
          await sleep(1000);
        }
        dbg.push('No start button found');
        return false;
      };

      // Wait for radios, checkboxes or textareas to appear (polls up to 10s)
      const waitForForm = async () => {
        for (let w = 0; w < 20; w++) {
          const radios = document.querySelectorAll('input[type="radio"], [role="radio"], mat-radio-button');
          const cbs = document.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
          const tas = document.querySelectorAll('textarea');
          const inputs = document.querySelectorAll('input[type="text"], input[type="email"]');
          if (radios.length > 0 || cbs.length > 0 || tas.length > 0 || inputs.length > 0) {
            dbg.push(`Form appeared after ${w * 0.5}s (r=${radios.length} c=${cbs.length} t=${tas.length} i=${inputs.length})`);
            return true;
          }
          await sleep(500);
        }
        dbg.push('No form elements found after 10s');
        return false;
      };

      // Click "Next" / "Suivant"
      const clickNext = async () => {
        const buttons = [...new Set([
          ...document.querySelectorAll('.bottom-bar-container button[debug-id="next-button"]'),
          ...document.querySelectorAll('button[debug-id="next-button"]'),
          ...document.querySelectorAll('button')
        ])];
        for (const btn of buttons) {
          const t = `${btn.textContent} ${btn.getAttribute('aria-label') || ''}`.toLowerCase().trim();
          if ((t.includes('suivant') || t.includes('next') || btn.getAttribute('debug-id') === 'next-button') &&
              !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && btn.getClientRects().length > 0) {
            btn.click();
            dbg.push(`Next: "${t.substring(0, 20)}"`);
            await sleep(1000);
            return true;
          }
        }
        return false;
      };

      // ===== PAGE-SPECIFIC LOGIC =====
      switch (pageType) {

        case 'privacy-policy': {
          await clickStart();
          await waitForForm();
          const inputs = document.querySelectorAll('input[type="text"], input[type="url"], input:not([type])');
          let filled = false;
          for (const inp of inputs) {
            if (inp.disabled || inp.readOnly) continue;
            const aria = (inp.getAttribute('aria-label') || '').toLowerCase();
            if (aria.includes('url') || aria.includes('confid') || aria.includes('privacy') || aria.includes('http')) {
              setInput(inp, config.privacyUrl);
              filled = true; break;
            }
          }
          if (!filled) {
            for (const inp of inputs) {
              if (!inp.disabled && !inp.readOnly && inp.type !== 'hidden') {
                setInput(inp, config.privacyUrl);
                filled = true; break;
              }
            }
          }
          await sleep(1000);
          await clickSave();
          resolve(filled ? 'OK: ' + dbg.join(' | ') : 'No URL input. ' + dbg.join(' | '));
          break;
        }

        case 'app-access': {
          await clickStart();
          await waitForForm();
          if (config.appAccess === 'all') {
            const selected = await clickRadio(['toutes les fonctionnalités', 'all functionality', 'sans restriction',
              'without restriction', 'disponible sans', 'available without']);
            if (!selected) await clickRadio(['non', 'no']);
          } else {
            const selected = await clickRadio(['restreint', 'restricted', 'certaines fonctionnalités',
              'special access', 'accès spécial']);
            if (!selected) await clickRadio(['oui', 'yes']);
          }
          await sleep(500);
          await clickSave();
          resolve('OK: ' + dbg.join(' | '));
          break;
        }

        case 'ads': {
          await clickStart();
          await waitForForm();
          if (config.containsAds === 'yes') {
            await clickRadio(['oui', 'yes', 'contient des annonces', 'contains ads']);
          } else {
            await clickRadio(['non', 'no', 'ne contient pas', 'does not contain']);
          }
          await sleep(500);
          await clickSave();
          resolve('OK: ' + dbg.join(' | '));
          break;
        }

        case 'gov-apps':
        case 'news': {
          await clickStart();
          await waitForForm();
          await clickStart();
          await waitForForm();

          const answer = pageType === 'gov-apps' ? config.govApp : 'no';
          if (answer === 'yes') {
            await clickRadio(['oui', 'yes']);
          } else {
            await clickRadio(['non', 'no']);
          }
          await sleep(500);
          await clickSave();
          resolve('OK: ' + dbg.join(' | '));
          break;
        }

        case 'financial':
        case 'health': {
          await sleep(2000);
          await waitForForm();

          // Click start/begin if present
          const startResult = await clickStart();
          if (startResult) {
            await sleep(2000);
            await waitForForm();
          }

          let clicked = false;
          const answer = pageType === 'financial' ? config.financialFeatures : config.healthApp;
          const targetPhrases = answer === 'yes'
            ? (pageType === 'financial'
              ? ['provides financial', 'financial products', 'financial features', 'services financiers', 'fonctionnalités financières']
              : ['is a health', 'health app', 'health features', 'application de santé', 'fonctionnalités de santé'])
            : [
              'ne fournit aucune', 'ne propose aucune', 'does not provide any',
              "doesn't provide any financial features", "doesn't provide any health features",
              "n'est pas une appli", 'is not a health', 'is not a',
              'ne contient aucune', 'pas une application de santé', 'not a health app',
              'aucune fonctionnalité', 'mon appli ne', 'no financial features',
              'no financial products', 'not a financial app', 'does not provide financial',
              'no health features', 'does not provide health', 'no health functionality'
            ];

          if (answer === 'yes') {
            clicked = await clickRadio(['oui', 'yes', 'provides financial', 'provides health']);
          } else {
            // These pages use checkboxes for the no-features option.
            const noneChoiceIds = pageType === 'financial'
              ? ['POLICY_RESPONSE_CHOICE_ID_FINANCE_NONE']
              : [
                'POLICY_RESPONSE_CHOICE_ID_NOT_HEALTH_APP',
                'POLICY_RESPONSE_CHOICE_ID_HEALTH_NONE',
                'POLICY_RESPONSE_CHOICE_ID_HEALTH_NO'
              ];
            for (const choiceId of noneChoiceIds) {
              const choice = document.querySelector(`material-checkbox[debug-id="${choiceId}"], [debug-id="${choiceId}"]`);
              if (choice && choice.getAttribute('aria-disabled') !== 'true') {
                const checkbox = choice.querySelector('input[type="checkbox"], [role="checkbox"]');
                const isChecked = () => checkbox && (checkbox.checked || checkbox.getAttribute('aria-checked') === 'true');
                if (!isChecked()) {
                  if (checkbox) {
                    checkbox.click();
                    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                  } else {
                    choice.click();
                  }
                  await sleep(500);
                }
                if (!isChecked() && checkbox) {
                  choice.click();
                  await sleep(500);
                }
                clicked = Boolean(isChecked());
                dbg.push(`${clicked ? 'Selected' : 'Could not select'} no-features option: ${choiceId}`);
                break;
              }
            }

            // Try radios/text labels when the stable ID is unavailable.
            if (!clicked) clicked = await clickRadio(['ne fournit aucune', 'does not provide any', 'aucune']);
            if (!clicked) clicked = await clickRadio(['non', 'no']);
          }

          // Find the selected answer by visible text when no stable ID exists.
          if (!clicked) {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
            let node;
            while ((node = walker.nextNode())) {
              const t = node.textContent.trim().toLowerCase();
              if (t.length < 5 || t.length > 200) continue;
              const matched = targetPhrases.some(phrase => t.includes(phrase));
              if (matched) {
                // Found the text — now find the clickable ancestor
                let el = node.parentElement;
                for (let i = 0; i < 8 && el; i++) {
                  const role = el.getAttribute('role') || '';
                  const tag = el.tagName.toLowerCase();
                  // Is this element itself a checkbox/option/list-item?
                  if (role === 'checkbox' || role === 'option' || tag === 'mat-list-option' || tag === 'mat-checkbox' || tag === 'label') {
                    el.click();
                    dbg.push(`Clicked option: "${t.substring(0, 70)}"`);
                    clicked = true;
                    await sleep(500);
                    break;
                  }
                  // Does this element contain a checkbox we can click?
                  const innerCb = el.querySelector('[role="checkbox"], input[type="checkbox"], mat-pseudo-checkbox');
                  if (innerCb) {
                    innerCb.click();
                    innerCb.dispatchEvent(new Event('input', { bubbles: true }));
                    innerCb.dispatchEvent(new Event('change', { bubbles: true }));
                    clicked = innerCb.checked || innerCb.getAttribute('aria-checked') === 'true';
                    dbg.push(`${clicked ? 'Clicked' : 'Could not click'} option (inner): "${t.substring(0, 70)}"`);
                    await sleep(500);
                    break;
                  }
                  el = el.parentElement;
                }
                if (clicked) break;
              }
            }
          }

          // Fallback: check all checkbox-like controls by walking up for no-features text.
          if (answer !== 'yes' && !clicked) {
            const checkboxes = document.querySelectorAll('[role="checkbox"], [role="option"], mat-list-option, mat-checkbox, input[type="checkbox"]');
            for (const cb of checkboxes) {
              const container = cb.closest('mat-list-option, mat-checkbox, [class*="list-item"], [class*="option"], label') || cb;
              const text = container.textContent.trim().toLowerCase();
              if (text.length < 200 && (
                  text.includes('ne fournit aucune') || text.includes('ne propose aucune') ||
                  text.includes('does not provide') || text.includes("doesn't provide") ||
                  text.includes("n'est pas une appli") || text.includes('is not a health') ||
                  text.includes('aucune fonctionnalité') || text.includes('ne contient aucune') ||
                  text.includes('mon appli ne'))) {
                const input = container.querySelector('input[type="checkbox"], [role="checkbox"]') || cb;
                input.click();
                input.dispatchEvent(new Event('change', { bubbles: true }));
                clicked = input.checked || input.getAttribute('aria-checked') === 'true';
                dbg.push(`${clicked ? 'Checkbox fallback' : 'Checkbox fallback failed'}: "${text.substring(0, 70)}"`);
                await sleep(500);
                break;
              }
            }
          }

          // Log checkbox text when the expected no-features option was not found.
          if (!clicked) {
            const allCbs = document.querySelectorAll('[role="checkbox"], input[type="checkbox"], mat-list-option, mat-checkbox');
            const cbTexts = [];
            allCbs.forEach((cb, i) => {
              if (i < 5) {
                const ct = cb.closest('mat-list-option, mat-checkbox, label') || cb.parentElement;
                cbTexts.push((ct?.textContent?.trim() || '').substring(0, 60));
              }
            });
            dbg.push(`CB debug [${allCbs.length}]: ${cbTexts.join(' | ')}`);
          }

          dbg.push(`Radio/CB clicked: ${clicked}`);
          await sleep(1000);

          // Flow: checkbox → Suivant → wait for new page → Enregistrer
          const nextClicked = await clickNext();
          if (nextClicked) {
            await sleep(3000);
            await waitForForm();
            await sleep(1000);
          }
          let saved = await clickSave();
          if (!saved) {
            window.scrollTo(0, document.body.scrollHeight);
            await sleep(2000);
            saved = await clickSave();
          }
          dbg.push(`Save: ${saved}`);
          resolve(saved ? 'OK: ' + dbg.join(' | ') : 'FAIL: ' + dbg.join(' | '));
          break;
        }

        case 'content-desc': {
          await clickStart();
          await sleep(1000);
          await clickSave();
          resolve('OK: ' + dbg.join(' | '));
          break;
        }

        case 'target-audience': {
          await clickStart();
          await waitForForm();

          // Target audience usually has checkboxes for age ranges
          // We want to check ages >= target
          const targetNum = parseInt(config.targetAge) || 13;
          const cbs = document.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
          for (const cb of cbs) {
            let text = '';
            let el = cb.parentElement;
            for (let i = 0; i < 5 && el; i++) {
              const t = el.textContent.trim();
              if (t.length > 0 && t.length < 100) { text = t.toLowerCase(); break; }
              el = el.parentElement;
            }
            // Check if this age group should be selected
            const ageMatch = text.match(/(\d+)/);
            if (ageMatch) {
              const age = parseInt(ageMatch[1]);
              if (age >= targetNum) {
                const isChecked = cb.checked || cb.getAttribute('aria-checked') === 'true';
                if (!isChecked) {
                  const label = cb.closest('label') || cb;
                  label.click();
                  cb.dispatchEvent(new Event('change', { bubbles: true }));
                  dbg.push(`Checked age: ${age} in "${text.substring(0, 30)}"`);
                  await sleep(300);
                }
              }
            }
          }
          await sleep(1000);

          // Click Next if present, then Save
          let hasNext = true;
          while (hasNext) {
            hasNext = await clickNext();
            if (hasNext) {
              await sleep(1000);
              // On subsequent pages, answer No to appeal questions
              await clickAllNo();
              await sleep(500);
            }
          }
          await clickSave();
          resolve('OK: ' + dbg.join(' | '));
          break;
        }

        case 'content-rating': {
          // IARC questionnaire — 3-step wizard: ① Catégorie → ② Questionnaire → ③ Résumé
          await clickStart();
          await waitForForm();
          await clickStart(); // "Répondre au questionnaire"
          await sleep(3000);
          await waitForForm();

          // Helper: detect current IARC step by looking at page content
          const getIARCStep = () => {
            const text = document.body.innerText.toLowerCase();
            // Step indicators or headings
            if (text.includes('résumé') && (text.includes('classification') || text.includes('rating'))) {
              // Could be step 3 (Résumé) — but check if we see questionnaire content
              const hasQuestionnaire = text.includes('questionnaire');
              const stepIndicators = document.querySelectorAll('[class*="step"], [class*="wizard"], [class*="stepper"]');
              // Look for active step number
              const activeStep = document.querySelector('[class*="active"], [aria-selected="true"], [class*="current"]');
              if (activeStep) {
                const at = activeStep.textContent.trim();
                if (at.includes('3') || at.includes('résumé')) return 3;
                if (at.includes('2') || at.includes('questionnaire')) return 2;
              }
            }
            // Check for "Adresse e-mail" field = step 1
            const emailInputs = document.querySelectorAll('input[type="text"], input[type="email"], input:not([type])');
            for (const inp of emailInputs) {
              const aria = (inp.getAttribute('aria-label') || '').toLowerCase();
              if (aria.includes('mail') || aria.includes('courriel')) return 1;
            }
            // Check for accordion panels = step 2
            const accordions = document.querySelectorAll('mat-expansion-panel, [class*="expansion"], [role="button"][aria-expanded]');
            if (accordions.length > 0) return 2;
            return 0; // unknown
          };

          // === STEP 1: Catégorie ===
          dbg.push('IARC Step 1');

          // Fill email from config
          if (config.contactEmail) {
            const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input:not([type])');
            for (const inp of inputs) {
              if (inp.disabled || inp.readOnly || inp.type === 'hidden') continue;
              if (!inp.value) {
                setInput(inp, config.contactEmail);
                dbg.push('Filled email');
                break;
              }
            }
          }

          // Select "Tous les autres types d'applications" (3rd radio)
          let catClicked = await clickRadio([
            'tous les autres', 'all other', 'toute application'
          ]);
          if (!catClicked) {
            // Fallback: click the LAST radio
            const catRadios = document.querySelectorAll('input[type="radio"], [role="radio"], mat-radio-button');
            if (catRadios.length >= 3) {
              const last = catRadios[catRadios.length - 1];
              const inner = last.querySelector('label, .mdc-label') || last;
              inner.click();
              last.dispatchEvent?.(new Event('change', { bubbles: true }));
              dbg.push('IARC cat: last radio');
            }
          }
          await sleep(500);

          // Accept IARC terms checkbox — multiple strategies with verification
          let termsAccepted = false;

          // Helper: check if ANY checkbox on page is now checked
          const isAnyCheckboxChecked = () => {
            for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
              if (cb.checked) return true;
            }
            for (const cb of document.querySelectorAll('[role="checkbox"]')) {
              if (cb.getAttribute('aria-checked') === 'true') return true;
            }
            return false;
          };

          // Strategy 1: Find the label/text "J'accepte" and click the closest checkbox ancestor/sibling
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
          let textNode;
          while ((textNode = walker.nextNode())) {
            const t = textNode.textContent.trim().toLowerCase();
            if (t.includes("j'accepte") || t.includes('i accept')) {
              let el = textNode.parentElement;
              for (let i = 0; i < 8 && el; i++) {
                // Look for Dart material-checkbox, gm-checkbox, mat-checkbox, role=checkbox, or label
                const tag = el.tagName.toLowerCase();
                const role = el.getAttribute('role') || '';
                if (tag === 'material-checkbox' || tag === 'gm-checkbox' || tag === 'mat-checkbox' ||
                    role === 'checkbox' || tag === 'label') {
                  // Click the element itself
                  el.click();
                  dbg.push(`IARC terms: text-walk clicked ${tag}/${role}`);
                  await sleep(500);
                  if (isAnyCheckboxChecked()) { termsAccepted = true; break; }
                  // Try clicking inner elements
                  const inner = el.querySelector('label, .mdc-checkbox, div, span');
                  if (inner) { inner.click(); await sleep(300); }
                  if (isAnyCheckboxChecked()) { termsAccepted = true; break; }
                }
                // Also check if el contains a checkbox input
                const innerCb = el.querySelector('input[type="checkbox"]');
                if (innerCb) {
                  // Click the label first (more reliable for Angular)
                  const label = el.querySelector('label') || el;
                  label.click();
                  await sleep(300);
                  if (!innerCb.checked) {
                    innerCb.checked = true;
                    innerCb.dispatchEvent(new Event('change', { bubbles: true }));
                    innerCb.dispatchEvent(new Event('input', { bubbles: true }));
                  }
                  dbg.push('IARC terms: via label near j\'accepte');
                  await sleep(300);
                  termsAccepted = true;
                  break;
                }
                el = el.parentElement;
              }
              if (termsAccepted) break;
            }
          }

          // Strategy 2: Find [role="checkbox"] elements and click unchecked ones
          if (!termsAccepted) {
            const roleCbs = document.querySelectorAll('[role="checkbox"]');
            for (const cb of roleCbs) {
              if (cb.getAttribute('aria-checked') !== 'true') {
                cb.click();
                dbg.push('IARC terms: role=checkbox click');
                await sleep(500);
                // Verify
                if (cb.getAttribute('aria-checked') === 'true' || isAnyCheckboxChecked()) {
                  termsAccepted = true; break;
                }
                // Try dispatching mousedown+mouseup
                cb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                cb.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                cb.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await sleep(300);
                if (isAnyCheckboxChecked()) { termsAccepted = true; break; }
              }
            }
          }

          // Strategy 3: native checkbox input — click + force check + dispatch events
          if (!termsAccepted) {
            const nativeCbs = document.querySelectorAll('input[type="checkbox"]');
            for (const cb of nativeCbs) {
              if (!cb.checked && !cb.disabled) {
                // Try clicking the label associated with this checkbox
                const id = cb.id;
                if (id) {
                  const label = document.querySelector(`label[for="${id}"]`);
                  if (label) { label.click(); await sleep(300); }
                }
                // If still not checked, click the checkbox wrapper
                const wrapper = cb.closest('material-checkbox, gm-checkbox, mat-checkbox, label, [role="checkbox"]');
                if (wrapper) { wrapper.click(); await sleep(300); }
                // If STILL not checked, force it
                if (!cb.checked) {
                  cb.checked = true;
                  cb.dispatchEvent(new Event('change', { bubbles: true }));
                  cb.dispatchEvent(new Event('input', { bubbles: true }));
                  cb.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                }
                dbg.push('IARC terms: native checkbox forced');
                termsAccepted = true;
                await sleep(300);
              }
            }
          }

          // Strategy 4: Dart material-checkbox or gm-checkbox elements
          if (!termsAccepted) {
            const dartCbs = document.querySelectorAll('material-checkbox, gm-checkbox');
            for (const cb of dartCbs) {
              cb.click();
              dbg.push('IARC terms: dart checkbox click');
              await sleep(500);
              if (isAnyCheckboxChecked()) { termsAccepted = true; break; }
            }
          }

          if (!termsAccepted) dbg.push('IARC terms: NOT FOUND');
          await sleep(1000); // extra wait for Angular change detection

          // Click Suivant → Step 2
          await clickNext();
          await sleep(4000);

          // === STEP 2: Questionnaire ===
          dbg.push('IARC Step 2');

          // The questionnaire may have multiple sub-pages.
          // Each sub-page has accordion sections that need expanding,
          // then radios to answer "Non" inside each section.
          for (let qPage = 0; qPage < 10; qPage++) {
            await sleep(1000);

            // Expand ALL accordion/expansion panels
            let expanded = 0;
            const expHeaders = document.querySelectorAll(
              'mat-expansion-panel-header, [role="button"][aria-expanded="false"], button[aria-expanded="false"], .mat-expansion-panel-header'
            );
            for (const hdr of expHeaders) {
              const txt = hdr.textContent.trim();
              if (txt.length > 2 && txt.length < 300) {
                hdr.click();
                expanded++;
                await sleep(800);
              }
            }
            if (expanded > 0) {
              dbg.push(`Q${qPage}: expanded ${expanded}`);
              await sleep(1000);
            }

            // Answer "Non"/"No" to ALL radio groups
            await clickAllNo();
            await sleep(500);

            // For any unchecked radio group, select "Non"/"No"/"Aucun" or first option
            const groups = {};
            document.querySelectorAll('input[type="radio"]').forEach(r => {
              const name = r.getAttribute('name') || r.closest('[role="radiogroup"]')?.id || 'default';
              if (!groups[name]) groups[name] = [];
              groups[name].push(r);
            });
            for (const [name, radios] of Object.entries(groups)) {
              if (radios.some(r => r.checked)) continue;
              // Try to find "Non"/"No"/"Aucun" option
              let picked = false;
              for (const r of radios) {
                const lbl = (r.closest('label') || r.parentElement)?.textContent?.trim().toLowerCase() || '';
                if (/\b(non|no|aucun|none|jamais|never)\b/.test(lbl)) {
                  r.click();
                  r.dispatchEvent(new Event('change', { bubbles: true }));
                  dbg.push(`Q${qPage}: "${lbl.substring(0, 20)}"`);
                  picked = true;
                  await sleep(200);
                  break;
                }
              }
              if (!picked && radios.length > 0) {
                radios[0].click();
                radios[0].dispatchEvent(new Event('change', { bubbles: true }));
                await sleep(200);
              }
            }

            // Same for mat-radio groups
            const matGroups = {};
            document.querySelectorAll('mat-radio-button, [role="radio"]').forEach(mr => {
              const g = mr.closest('mat-radio-group, [role="radiogroup"]');
              const gid = g?.getAttribute('name') || g?.id || 'mat_def';
              if (!matGroups[gid]) matGroups[gid] = [];
              matGroups[gid].push(mr);
            });
            for (const [gid, radios] of Object.entries(matGroups)) {
              const hasChecked = radios.some(r =>
                r.classList?.contains('mat-mdc-radio-checked') ||
                r.getAttribute('aria-checked') === 'true'
              );
              if (!hasChecked && radios.length > 0) {
                // Try "Non" first
                let picked = false;
                for (const r of radios) {
                  const txt = r.textContent.trim().toLowerCase();
                  if (/\b(non|no|aucun|none)\b/.test(txt)) {
                    (r.querySelector('label, .mdc-label') || r).click();
                    dbg.push(`Q${qPage} mat: "${txt.substring(0, 20)}"`);
                    picked = true;
                    await sleep(200);
                    break;
                  }
                }
                if (!picked) {
                  (radios[0].querySelector('label, .mdc-label') || radios[0]).click();
                  await sleep(200);
                }
              }
            }

            await sleep(500);

            // Try "Soumettre"/"Submit"/"Enregistrer"/"Save" button first
            const btns = document.querySelectorAll('button');
            let clickedSaveOrSubmit = false;
            for (const btn of btns) {
              const t = btn.textContent.toLowerCase().trim();
              if ((t.includes('soumettre') || t.includes('submit') || t.includes('enregistrer') || t.includes('save')) &&
                  !t.includes('annuler') && !t.includes('brouillon') && !t.includes('suivant') && !btn.disabled && btn.offsetHeight > 0) {
                btn.click();
                dbg.push(`Submit: "${t.substring(0, 25)}"`);
                clickedSaveOrSubmit = true;
                await sleep(3000);
                break;
              }
            }

            // After Enregistrer, check if there's a Suivant button → click it → then Enregistrer again
            if (clickedSaveOrSubmit) {
              const nextAfterSave = await clickNext();
              if (nextAfterSave) {
                await sleep(3000);
                // Final save on the last page
                await clickSave();
              }
              break;
            }

            // Otherwise click "Suivant"/"Next" to advance
            const nextOk = await clickNext();
            if (nextOk) {
              await sleep(4000); // wait for page transition
              continue;
            }

            // If nothing worked, try generic save
            const saved = await clickSave();
            if (saved) { dbg.push('Saved'); break; }
          }

          resolve('OK: content-rating ' + dbg.join(' | '));
          break;
        }

        case 'data-safety': {
          // If CSV content is provided, use the import feature instead of wizard
          if (config.dataSafetyCsv) {
            await sleep(1000);

            // Find and click "Importer depuis le fichier CSV" / "Import from CSV file"
            let importBtn = null;
            const allLinks = document.querySelectorAll('a, button, [role="link"], [role="button"]');
            for (const el of allLinks) {
              const txt = el.textContent.trim().toLowerCase();
              if (txt.includes('importer') && txt.includes('csv') ||
                  txt.includes('import') && txt.includes('csv')) {
                importBtn = el;
                break;
              }
            }

            if (!importBtn) {
              // Try finding by partial text
              for (const el of allLinks) {
                const txt = el.textContent.trim().toLowerCase();
                if (txt.includes('importer depuis') || txt.includes('import from')) {
                  importBtn = el;
                  break;
                }
              }
            }

            if (importBtn) {
              dbg.push('Found import button');

              // Check if there's already a file input on the page
              let fileInput = document.querySelector('input[type="file"][accept*="csv"], input[type="file"]');

              if (!fileInput) {
                // Intercept: the import button likely creates a temp <input type="file"> and calls .click()
                // which opens the native file dialog. We intercept .click() to capture it without opening the dialog.
                let interceptedInput = null;
                const origClick = HTMLInputElement.prototype.click;
                HTMLInputElement.prototype.click = function() {
                  if (this.type === 'file') {
                    interceptedInput = this;
                    dbg.push('Intercepted file input click');
                    return; // Don't open native dialog
                  }
                  return origClick.call(this);
                };
                importBtn.click();
                await sleep(1000);
                HTMLInputElement.prototype.click = origClick; // Restore immediately

                if (interceptedInput) {
                  fileInput = interceptedInput;
                  dbg.push('Using intercepted file input');
                } else {
                  // Fallback: search DOM after click
                  fileInput = document.querySelector('input[type="file"][accept*="csv"], input[type="file"]');
                }
              }

              if (!fileInput) {
                // Poll for dynamically created file inputs
                for (let poll = 0; poll < 6; poll++) {
                  await sleep(500);
                  const allInputs = document.querySelectorAll('input[type="file"]');
                  if (allInputs.length > 0) {
                    fileInput = allInputs[allInputs.length - 1];
                    dbg.push('Found file input after polling');
                    break;
                  }
                }
              }

              if (fileInput) {
                // Create a File object from the CSV content and inject it
                const csvFile = new File([config.dataSafetyCsv], 'data_safety_export.csv', { type: 'text/csv' });
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(csvFile);
                fileInput.files = dataTransfer.files;
                fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                fileInput.dispatchEvent(new Event('input', { bubbles: true }));
                dbg.push('CSV file injected into file input');

                // Wait for import processing
                await sleep(3000);

                // Click blue "Importer" button at bottom of dialog
                // Use only <button> elements to avoid [role="button"] parent divs whose textContent includes dialog heading
                let importClicked = false;
                for (let attempt = 0; attempt < 8; attempt++) {
                  const confirmBtns = document.querySelectorAll('button');
                  let bestImportBtn = null;
                  let bestLen = 9999;
                  for (const btn of confirmBtns) {
                    const txt = btn.textContent.trim().toLowerCase();
                    if ((txt.includes('importer') || txt.includes('import') || txt.includes('appliquer') || txt.includes('apply')) &&
                        !btn.disabled && btn.offsetHeight > 0 && txt.length < 60) {
                      // Prefer shortest match (just "Importer" over "Importer depuis le fichier CSV")
                      if (txt.length < bestLen) {
                        bestImportBtn = btn;
                        bestLen = txt.length;
                      }
                    }
                  }
                  if (bestImportBtn) {
                    bestImportBtn.click();
                    dbg.push('Clicked Importer (1st): ' + bestImportBtn.textContent.trim().substring(0, 40));
                    importClicked = true;
                    await sleep(2000);
                  }
                  if (importClicked) break;
                  await sleep(1000);
                }

                // Confirmation dialog: "Importer depuis le fichier CSV ?" → click "Importer" again
                if (importClicked) {
                  await sleep(2000);
                  // Primary: use debug-id="yes-button" which is the confirmation dialog's action button
                  let bestBtn2 = document.querySelector('material-dialog[debug-id="console-dialog-popup"] button[debug-id="yes-button"]');
                  if (!bestBtn2) {
                    // Fallback: find the topmost modal's Importer button
                    const dialogs = document.querySelectorAll('material-dialog, .modal, [role="dialog"]');
                    for (let d = dialogs.length - 1; d >= 0; d--) {
                      const btns = dialogs[d].querySelectorAll('button');
                      for (const btn of btns) {
                        const txt = btn.textContent.trim().toLowerCase();
                        if ((txt.includes('importer') || txt.includes('import')) &&
                            !btn.disabled && btn.offsetHeight > 0 && txt.length < 30) {
                          bestBtn2 = btn;
                          break;
                        }
                      }
                      if (bestBtn2) break;
                    }
                  }
                  if (bestBtn2) {
                    bestBtn2.click();
                    dbg.push('Clicked Importer (confirm dialog): ' + bestBtn2.textContent.trim().substring(0, 30));
                    await sleep(3000);
                  } else {
                    dbg.push('Confirm dialog Importer button not found');
                  }

                  // After confirmation, the upload dialog may still be open — click its "Importer" button to close it
                  for (let closeAttempt = 0; closeAttempt < 5; closeAttempt++) {
                    // Check if any dialog/overlay is still visible
                    const openDialog = document.querySelector('.modal.visible material-dialog, material-dialog');
                    if (!openDialog || openDialog.offsetHeight === 0) {
                      dbg.push('Upload dialog closed');
                      break;
                    }
                    // Find "Importer" button inside the remaining dialog
                    const dialogBtns = openDialog.querySelectorAll('button');
                    let closeBtn = null;
                    for (const btn of dialogBtns) {
                      const txt = btn.textContent.trim().toLowerCase();
                      if ((txt.includes('importer') || txt.includes('import')) &&
                          !btn.disabled && btn.offsetHeight > 0) {
                        closeBtn = btn;
                        break;
                      }
                    }
                    if (closeBtn) {
                      closeBtn.click();
                      dbg.push('Clicked Importer (close upload dialog): ' + closeBtn.textContent.trim().substring(0, 30));
                      await sleep(3000);
                      break;
                    }
                    await sleep(1000);
                  }
                }

                // Wait for dialog to fully close and wizard to load
                await sleep(3000);

                // Now click through remaining steps (Review/Submit)
                let csvSaved = false;
                for (let step = 0; step < 10; step++) {
                  await sleep(1000);
                  const clickedNext = await clickNext();
                  if (!clickedNext) {
                    // Try standard save first
                    let saved = await clickSave();
                    if (saved) {
                      dbg.push(`Saved after CSV import at step ${step}`);
                      csvSaved = true;
                      break;
                    }
                    // Data safety may have "Publier les modifications" or "Envoyer" as the final action
                    const pubBtns = document.querySelectorAll('button');
                    for (const btn of pubBtns) {
                      const t = btn.textContent.toLowerCase().trim();
                      if ((t.includes('publier') || t.includes('publish') || t.includes('valider') || t.includes('validate') ||
                           t.includes('envoyer') || t.includes('soumettre') || t.includes('submit')) &&
                          !t.includes('annuler') && !t.includes('cancel') && !btn.disabled && btn.offsetHeight > 0) {
                        btn.click();
                        dbg.push(`Data-safety publish: "${t.substring(0, 40)}"`);
                        csvSaved = true;
                        await sleep(3000);
                        break;
                      }
                    }
                    if (csvSaved) break;
                  }
                }
                if (!csvSaved) dbg.push('WARNING: CSV import flow did not find a final save/publish button');
              } else {
                dbg.push('No file input found after clicking import');
                // Fallback to wizard navigation
              }
            } else {
              dbg.push('Import button not found, falling back to wizard');
            }

            resolve('OK: data-safety (CSV) ' + dbg.join(' | '));
            break;
          }

          // Fallback: wizard navigation if no CSV
          await clickStart();
          await waitForForm();
          await clickStart();
          await sleep(2000);
          await waitForForm();

          // Data safety is a multi-step wizard
          for (let step = 0; step < 15; step++) {
            await waitForForm();

            // Answer "No" to all data collection/sharing questions
            await clickAllNo();
            await sleep(300);

            // Also try specific radio texts for data safety pages
            await clickRadio(['ne collecte ni ne partage', 'does not collect or share',
              'ne collecte', 'does not collect', 'ne partage', 'does not share',
              'non, mon application ne collecte', 'non', 'no']);
            await sleep(500);

            // Check ALL checkboxes (not just confirmation ones — Play Console requires all)
            const cbs = document.querySelectorAll('input[type="checkbox"]');
            for (const cb of cbs) {
              if (!cb.checked) {
                const lbl = cb.closest('label') || cb;
                lbl.click();
                dbg.push(`Checked native cb at step ${step}`);
                await sleep(200);
              }
            }
            // Angular material checkboxes — check ALL unchecked ones
            const matCbs = document.querySelectorAll('[role="checkbox"]');
            for (const cb of matCbs) {
              if (cb.getAttribute('aria-checked') !== 'true') {
                cb.click();
                dbg.push(`Checked mat cb at step ${step}`);
                await sleep(200);
              }
            }

            await sleep(500);
            const clickedNext = await clickNext();
            if (!clickedNext) {
              const saved = await clickSave();
              if (saved) {
                dbg.push(`Data safety saved at step ${step}`);
                break;
              }
            }
          }
          resolve('OK: data-safety ' + dbg.join(' | '));
          break;
        }

        case 'category': {
          // Page "Paramètres de la fiche Play Store" — no "Commencer" button here
          // Wait for page to load and Modifier buttons to appear
          await sleep(3000);

          // Wait for category section to be visible
          for (let w = 0; w < 10; w++) {
            const catSection = document.querySelector('[debug-id="edit-app-category-section-button"]') ||
                               document.querySelector('material-button[debug-id="edit-app-category-section-button"]');
            if (catSection) { dbg.push(`Category section found after ${w}s`); break; }
            await sleep(1000);
          }

          // === Click "Modifier" on category section ===
          const catEditBtn = document.querySelector('material-button[debug-id="edit-app-category-section-button"] button') ||
                             document.querySelector('[debug-id="edit-app-category-section-button"] button');
          if (catEditBtn && !catEditBtn.disabled) {
            catEditBtn.click();
            dbg.push('Clicked Modifier (category)');
          } else {
            // Fallback: first Modifier button on page
            const allBtns = document.querySelectorAll('button');
            for (const b of allBtns) {
              if (b.textContent.trim().toLowerCase() === 'modifier' && b.offsetHeight > 0 && !b.disabled) {
                b.click();
                dbg.push('Clicked Modifier (fallback)');
                break;
              }
            }
          }

          // Wait for overlay to open
          for (let ow = 0; ow < 10; ow++) {
            const overlay = document.querySelector('console-mega-overlay[debug-id="edit-app-category-overlay"] .popup[role="dialog"]') ||
                            document.querySelector('.popup[role="dialog"]');
            if (overlay && overlay.offsetHeight > 0) { dbg.push(`Category overlay open after ${ow}s`); break; }
            await sleep(1000);
          }
          await sleep(2000);

          // === Select category from dropdown ===
          const target = (config.appCategory || 'tools').toLowerCase();
          const categoryMap = {
            'tools': ['outils', 'tools'],
            'entertainment': ['divertissement', 'entertainment'],
            'productivity': ['productivité', 'productivity'],
            'lifestyle': ['art de vivre', 'lifestyle', 'style de vie'],
            'education': ['enseignement', 'education', 'éducation'],
            'communication': ['communication'],
            'personalization': ['personnalisation', 'personalization'],
            'game_casual': ['casual', 'jeux détendus', 'détendus'],
            'game_puzzle': ['puzzle', 'casse-tête', 'réflexion'],
            'game_action': ['action'],
            'finance': ['finance'],
            'art_and_design': ['art et design', 'art and design'],
            'auto_and_vehicles': ['auto et véhicules', 'auto and vehicles'],
            'beauty': ['beauté', 'beauty'],
            'books_and_reference': ['livres et références', 'books and reference', 'bibliothèques et démos'],
            'business': ['professionnel', 'business'],
            'comics': ['bandes dessinées', 'comics'],
            'dating': ['rencontres', 'dating'],
            'events': ['événements', 'events'],
            'food_and_drink': ['alimentation et boissons', 'food and drink'],
            'health_and_fitness': ['santé et remise en forme', 'health and fitness'],
            'house_and_home': ['maison', 'house and home'],
            'maps_and_navigation': ['cartes et navigation', 'maps and navigation'],
            'medical': ['médecine', 'medical'],
            'music_and_audio': ['musique et audio', 'music and audio'],
            'news_and_magazines': ['actualités et magazines', 'news and magazines'],
            'parenting': ['vie familiale', 'parenting'],
            'photography': ['photographie', 'photography'],
            'shopping': ['shopping', 'achats'],
            'social': ['réseaux sociaux', 'social'],
            'sports': ['sports'],
            'travel_and_local': ['voyages et infos locales', 'travel and local'],
            'video_players': ['lecteurs et éditeurs vidéo', 'video players'],
            'weather': ['météo', 'weather'],
          };
          const searchTerms = categoryMap[target] || [target];

          let ddClicked = false;
          const catDropdown = document.querySelector('material-dropdown-select[debug-id="category-dropdown"]');
          if (catDropdown) {
            const trigger = catDropdown.querySelector('dropdown-button [role="button"]') ||
                            catDropdown.querySelector('dropdown-button') || catDropdown;
            trigger.click();
            dbg.push('Opened category dropdown');
            await sleep(2000);

            for (let optAttempt = 0; optAttempt < 5; optAttempt++) {
              const options = Array.from(document.querySelectorAll(
                'material-select-item, material-select-dropdown-item, [role="option"]'
              )).filter(o => o.offsetHeight > 0);
              if (options.length > 3) {
                for (const opt of options) {
                  const t = opt.textContent.trim().toLowerCase();
                  if (searchTerms.some(term => t.includes(term)) || t.includes(target)) {
                    opt.click();
                    dbg.push(`Selected: "${t.substring(0, 40)}"`);
                    ddClicked = true;
                    await sleep(1000);
                    break;
                  }
                }
                break;
              }
              await sleep(1000);
            }
          }
          if (!ddClicked) dbg.push('Category not selected');
          await sleep(1000);

          // === Save category ===
          const mainBtn = document.querySelector('button[debug-id="main-button"]');
          if (mainBtn) {
            for (let w = 0; w < 5; w++) {
              if (!mainBtn.disabled) break;
              await sleep(1000);
            }
            if (!mainBtn.disabled) {
              mainBtn.click();
              dbg.push('Saved category');
              await sleep(3000);
            } else {
              await clickSave();
            }
          } else {
            await clickSave();
          }

          // === Also handle Coordonnées (same page) ===
          if (config.contactEmail) {
            await sleep(5000);

            // Find Modifier for Coordonnées
            let ctBtn = document.querySelector('material-button[debug-id="edit-store-listing-section-button"] button') ||
                        document.querySelector('[debug-id="edit-store-listing-section-button"] button');

            if (!ctBtn) {
              // Fallback: find Modifier inside the contact console-section
              const secs = document.querySelectorAll('console-section');
              for (const sec of secs) {
                const secText = sec.textContent.toLowerCase();
                if (secText.includes('coordonnées') || secText.includes('adresse e-mail')) {
                  const btns = sec.querySelectorAll('material-button button, button');
                  for (const b of btns) {
                    if (b.textContent.trim().toLowerCase() === 'modifier' && !b.disabled) {
                      ctBtn = b;
                      dbg.push('Found Modifier in Coordonnées section');
                      break;
                    }
                  }
                  if (ctBtn) break;
                }
              }
            }

            if (!ctBtn) {
              // Fallback: 2nd Modifier on page
              const mods = Array.from(document.querySelectorAll('button')).filter(
                b => b.textContent.trim().toLowerCase() === 'modifier' && !b.disabled && b.offsetHeight > 0
              );
              if (mods.length >= 2) { ctBtn = mods[1]; dbg.push('Using 2nd Modifier'); }
              else if (mods.length === 1) { ctBtn = mods[0]; dbg.push('Using 1st Modifier'); }
            }

            if (ctBtn) {
              ctBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
              await sleep(500);
              ctBtn.click();
              dbg.push('Clicked Modifier (contact)');

              // Wait for overlay
              let contactOverlay = null;
              for (let ow2 = 0; ow2 < 15; ow2++) {
                contactOverlay = document.querySelector('console-mega-overlay[debug-id="edit-store-listing-overlay"] .popup[role="dialog"]') ||
                           document.querySelector('.popup[role="dialog"][style*="visible"], [aria-modal="true"]');
                if (!contactOverlay) {
                  contactOverlay = document.querySelector('.popup[role="dialog"]');
                }
                if (contactOverlay && contactOverlay.offsetHeight > 0) { dbg.push(`Contact overlay open after ${ow2}s`); break; }
                contactOverlay = null;
                await sleep(1000);
              }
              await sleep(2000);

              // Fill email
              let emailFilled = false;
              // Search within overlay first, then globally
              const eMat = (contactOverlay && contactOverlay.querySelector('material-input[debug-id="email-input"]')) ||
                           document.querySelector('material-input[debug-id="email-input"]');
              if (eMat) {
                const eInp = eMat.querySelector('input');
                if (eInp) {
                  eInp.focus();
                  eInp.select();
                  nativeInputSetter.call(eInp, config.contactEmail);
                  eInp.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: config.contactEmail }));
                  eInp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                  eInp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                  await sleep(500);
                  eInp.dispatchEvent(new Event('blur', { bubbles: true }));
                  dbg.push('Filled email (debug-id)');
                  emailFilled = true;
                }
              }
              if (!emailFilled) {
                // Fallback: first text input in overlay
                const searchRoot = contactOverlay || document;
                const overlayInputs = searchRoot.querySelectorAll('input[type="text"], input[type="email"], input:not([type])');
                for (const inp of overlayInputs) {
                  if (!inp.disabled && !inp.readOnly && inp.offsetHeight > 0 && inp.type !== 'hidden' && inp.type !== 'file') {
                    inp.focus();
                    inp.select();
                    nativeInputSetter.call(inp, config.contactEmail);
                    inp.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: config.contactEmail }));
                    inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    await sleep(300);
                    inp.dispatchEvent(new Event('blur', { bubbles: true }));
                    dbg.push('Filled email (overlay fallback)');
                    emailFilled = true;
                    break;
                  }
                }
              }
              await sleep(2000);

              // Save contact — scope to the open overlay to avoid clicking a hidden button
              const overlayForSave = document.querySelector('console-mega-overlay[debug-id="edit-store-listing-overlay"]') || contactOverlay;
              let cSave = overlayForSave ? overlayForSave.querySelector('button[debug-id="main-button"]') : null;
              if (!cSave) {
                // Fallback: find the LAST visible main-button on page (overlay buttons come after page buttons)
                const allMainBtns = document.querySelectorAll('button[debug-id="main-button"]');
                for (let i = allMainBtns.length - 1; i >= 0; i--) {
                  if (allMainBtns[i].offsetHeight > 0 && !allMainBtns[i].disabled) {
                    cSave = allMainBtns[i];
                    break;
                  }
                }
              }
              if (cSave) {
                for (let w = 0; w < 8; w++) { if (!cSave.disabled) break; await sleep(1000); }
                if (!cSave.disabled) { cSave.click(); dbg.push('Saved contact'); await sleep(3000); }
                else { await clickSave(); }
              } else { await clickSave(); }
            } else {
              dbg.push('Contact Modifier NOT FOUND');
            }
          }

          resolve('OK: category ' + dbg.join(' | '));
          break;
        }

        case 'contact-details': {
          // Coordonnées — separate page or standalone task
          await sleep(3000);

          if (!config.contactEmail) {
            resolve('OK: contact-details (no email configured) ' + dbg.join(' | '));
            break;
          }

          // Wait for contact section to appear
          for (let w = 0; w < 10; w++) {
            const sec = document.querySelector('[debug-id="edit-store-listing-section-button"]');
            if (sec) { dbg.push(`Contact section found after ${w}s`); break; }
            await sleep(1000);
          }

          // Click "Modifier" on Coordonnées section
          let ctEditBtn = document.querySelector('material-button[debug-id="edit-store-listing-section-button"] button') ||
                          document.querySelector('[debug-id="edit-store-listing-section-button"] button');

          if (!ctEditBtn) {
            const sections = document.querySelectorAll('console-section');
            for (const sec of sections) {
              const secText = sec.textContent.toLowerCase();
              if (secText.includes('coordonnées') || secText.includes('contact')) {
                const btn = sec.querySelector('material-button button, button');
                if (btn && btn.textContent.trim().toLowerCase() === 'modifier' && !btn.disabled) {
                  ctEditBtn = btn;
                  dbg.push('Found Modifier via console-section');
                  break;
                }
              }
            }
          }

          if (!ctEditBtn) {
            const modBtns = Array.from(document.querySelectorAll('button')).filter(
              b => b.textContent.trim().toLowerCase() === 'modifier' && !b.disabled && b.offsetHeight > 0
            );
            if (modBtns.length >= 2) ctEditBtn = modBtns[1];
            else if (modBtns.length === 1) ctEditBtn = modBtns[0];
          }

          if (!ctEditBtn) {
            resolve('FAIL: contact-details Modifier not found ' + dbg.join(' | '));
            break;
          }

          ctEditBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          await sleep(500);
          ctEditBtn.click();
          dbg.push('Clicked Modifier (contact)');

          // Wait for overlay
          let ctOverlay = null;
          for (let ow = 0; ow < 10; ow++) {
            ctOverlay = document.querySelector('console-mega-overlay[debug-id="edit-store-listing-overlay"] .popup[role="dialog"]') ||
                            document.querySelector('.popup[role="dialog"]');
            if (ctOverlay && ctOverlay.offsetHeight > 0) { dbg.push(`Overlay open after ${ow}s`); break; }
            ctOverlay = null;
            await sleep(1000);
          }
          await sleep(2000);

          // Fill email
          const ctSearchRoot = ctOverlay || document;
          const contactEmailMat = ctSearchRoot.querySelector('material-input[debug-id="email-input"]') ||
                                  document.querySelector('material-input[debug-id="email-input"]');
          if (contactEmailMat) {
            const contactEmailInp = contactEmailMat.querySelector('input');
            if (contactEmailInp) {
              contactEmailInp.focus();
              contactEmailInp.select();
              nativeInputSetter.call(contactEmailInp, config.contactEmail);
              contactEmailInp.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: config.contactEmail }));
              contactEmailInp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              contactEmailInp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
              await sleep(500);
              contactEmailInp.dispatchEvent(new Event('blur', { bubbles: true }));
              dbg.push('Filled email');
            }
          } else {
            const overlayInputs = ctSearchRoot.querySelectorAll('input[type="text"], input[type="email"], input:not([type])');
            for (const inp of overlayInputs) {
              if (!inp.disabled && !inp.readOnly && inp.offsetHeight > 0) {
                inp.focus();
                inp.select();
                nativeInputSetter.call(inp, config.contactEmail);
                inp.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: config.contactEmail }));
                inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                await sleep(300);
                inp.dispatchEvent(new Event('blur', { bubbles: true }));
                dbg.push('Filled email (fallback)');
                break;
              }
            }
          }
          await sleep(2000);

          // Save — scope to overlay
          const ctOverlayForSave = document.querySelector('console-mega-overlay[debug-id="edit-store-listing-overlay"]') || ctOverlay;
          let contactSaveBtn = ctOverlayForSave ? ctOverlayForSave.querySelector('button[debug-id="main-button"]') : null;
          if (!contactSaveBtn) {
            const allBtns = document.querySelectorAll('button[debug-id="main-button"]');
            for (let i = allBtns.length - 1; i >= 0; i--) {
              if (allBtns[i].offsetHeight > 0 && !allBtns[i].disabled) { contactSaveBtn = allBtns[i]; break; }
            }
          }
          if (contactSaveBtn) {
            for (let w = 0; w < 8; w++) { if (!contactSaveBtn.disabled) break; await sleep(1000); }
            if (!contactSaveBtn.disabled) {
              contactSaveBtn.click();
              dbg.push('Saved contact');
              await sleep(3000);
            } else {
              await clickSave();
            }
          } else {
            await clickSave();
          }

          resolve('OK: contact-details ' + dbg.join(' | '));
          break;
        }

        case 'store-listing': {
          // Step 1: Click "Créer fiche Play" / "Create store listing" button
          let clickedCreate = false;
          for (let attempt = 0; attempt < 5; attempt++) {
            const elems = document.querySelectorAll('button, a, [role="button"]');
            for (const el of elems) {
              const t = el.textContent.toLowerCase().trim();
              if ((t.includes('créer') && t.includes('fiche')) ||
                  (t.includes('create') && t.includes('store listing')) ||
                  (t.includes('create') && t.includes('listing')) ||
                  t === 'créer fiche play' || t === 'create store listing') {
                el.click();
                dbg.push(`Clicked create listing: "${t.substring(0, 50)}" (attempt ${attempt})`);
                clickedCreate = true;
                await sleep(3000);
                break;
              }
            }
            if (clickedCreate) break;
            await sleep(1000);
          }
          if (!clickedCreate) {
            // Maybe the listing form is already open — try clickStart as fallback
            await clickStart();
          }
          await waitForForm();
          await sleep(1000);

          // Current Play Console listing form exposes stable debug IDs for text assets.
          const appNameInput = document.querySelector('[debug-id="app-name-input"] input');
          if (appNameInput && !appNameInput.value) {
            setInput(appNameInput, config.appName || 'Watch Movies');
            dbg.push('App name filled (debug-id)');
          }
          const shortInput = document.querySelector('[debug-id="short-description-input"] input');
          if (shortInput) {
            setInput(shortInput, (config.shortDesc || 'A great app for everyone.').substring(0, 80));
            dbg.push('Short desc filled (debug-id)');
          }
          const fullInput = document.querySelector('[debug-id="full-description-input"] textarea');
          if (fullInput) {
            setTextarea(fullInput, config.fullDesc || 'Download now and enjoy this amazing app.');
            dbg.push('Full desc filled (debug-id)');
          }

          // Step 2: Fill short description
          let textareas = document.querySelectorAll('textarea');
          let inputs = document.querySelectorAll('input[type="text"], input:not([type])');
          dbg.push(`Textareas: ${textareas.length}, Inputs: ${inputs.length}`);

          const shortDesc = config.shortDesc || 'A great app for everyone.';
          let filledShort = false;
          for (const ta of textareas) {
            const aria = (ta.getAttribute('aria-label') || '').toLowerCase();
            const maxLen = parseInt(ta.getAttribute('maxlength') || '0');
            if (aria.includes('brève') || aria.includes('short') || aria.includes('courte') ||
                (maxLen > 10 && maxLen <= 80)) {
              setTextarea(ta, shortDesc.substring(0, maxLen || 80));
              dbg.push(`Short desc filled (aria="${aria.substring(0, 30)}", max=${maxLen})`);
              filledShort = true;
              break;
            }
          }

          await sleep(500);

          // Step 3: Fill full description
          const fullDesc = config.fullDesc || 'Download now and enjoy this amazing app. Features include a beautiful interface and smooth performance.';
          let filledFull = false;
          textareas = document.querySelectorAll('textarea');
          for (const ta of textareas) {
            const aria = (ta.getAttribute('aria-label') || '').toLowerCase();
            const maxLen = parseInt(ta.getAttribute('maxlength') || '0');
            if (aria.includes('complète') || aria.includes('full') || aria.includes('détaillée') ||
                (aria.includes('description') && !aria.includes('brève') && !aria.includes('short') && !aria.includes('courte')) ||
                maxLen > 80 || maxLen === 0) {
              if (filledShort && (maxLen > 10 && maxLen <= 80)) continue;
              setTextarea(ta, fullDesc);
              dbg.push(`Full desc filled (aria="${aria.substring(0, 30)}", max=${maxLen})`);
              filledFull = true;
              break;
            }
          }

          // Fallback: fill textareas by position
          if (!filledShort || !filledFull) {
            textareas = document.querySelectorAll('textarea');
            const tArr = Array.from(textareas).filter(t => !t.disabled && !t.readOnly);
            if (!filledShort && tArr.length >= 1) {
              setTextarea(tArr[0], shortDesc.substring(0, 80));
              dbg.push('Short desc filled (positional)');
            }
            if (!filledFull && tArr.length >= 2) {
              setTextarea(tArr[1], fullDesc);
              dbg.push('Full desc filled (positional)');
            }
          }

          await sleep(1000);

          // Step 4: Import icon from Google Drive
          if (config.driveIconUrl) {
            dbg.push('Attempting icon upload from Drive...');
            // Convert Drive sharing URL to direct download URL
            const iconDirectUrl = convertDriveUrl(config.driveIconUrl);
            if (iconDirectUrl) {
              const iconUploaded = await uploadImageFromUrl(iconDirectUrl, 'icon', dbg);
              dbg.push(iconUploaded ? 'Icon uploaded' : 'Icon upload failed');
            }
            await sleep(2000);
          }

          // Step 5: Import screenshot from Google Drive
          if (config.driveScreenshotUrl) {
            dbg.push('Attempting screenshot upload from Drive...');
            const ssDirectUrl = convertDriveUrl(config.driveScreenshotUrl);
            if (ssDirectUrl) {
              const ssUploaded = await uploadImageFromUrl(ssDirectUrl, 'screenshot', dbg);
              dbg.push(ssUploaded ? 'Screenshot uploaded' : 'Screenshot upload failed');
            }
            await sleep(2000);
          }

          await sleep(1000);
          let listingSaved = false;
          const draftButton = document.querySelector('button[debug-id="save-draft-button"]');
          if (draftButton && !draftButton.disabled && draftButton.getAttribute('aria-disabled') !== 'true') {
            draftButton.click();
            dbg.push('Save as draft clicked');
            await sleep(3000);
            listingSaved = true;
          } else {
            const nextButton = document.querySelector('button[debug-id="next-button"]');
            if (nextButton && !nextButton.disabled && nextButton.getAttribute('aria-disabled') !== 'true') {
              nextButton.click();
              dbg.push('Next clicked');
              await sleep(3000);
              listingSaved = true;
            } else {
              listingSaved = await clickSave();
            }
          }
          resolve(listingSaved ? 'OK: store-listing ' + dbg.join(' | ') : 'FAIL: store-listing ' + dbg.join(' | '));
          break;
        }

        default:
          resolve('Unknown page type: ' + pageType);
      }
    } catch (err) {
      resolve('Error: ' + err.message + '\n' + err.stack);
    }
  });
}

// ==================== DRAFT CREATION ====================

// This function runs inside the Play Console page
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
      // The SPA may have loaded the home page instead of the create form.
      // If so, click the "Créer une application" <A> link to navigate.
      let radios = document.querySelectorAll('[role="radio"], mat-radio-button, .mat-mdc-radio-button');
      let cbs = document.querySelectorAll('[role="checkbox"], mat-checkbox, .mat-mdc-checkbox, input[type="checkbox"]');

      if (radios.length === 0 && cbs.length === 0) {
        debugInfo.push('No form elements found — likely on home page. Looking for create link...');

        // Find and click the "Créer une application" <A> link
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
          // Fallback: try clicking any link whose href contains /app/create
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

        // Wait for the create form to appear (poll for radios/checkboxes up to 20s)
        for (let w = 0; w < 20; w++) {
          await sleep(1000);
          radios = document.querySelectorAll('[role="radio"], mat-radio-button, .mat-mdc-radio-button');
          cbs = document.querySelectorAll('[role="checkbox"], mat-checkbox, .mat-mdc-checkbox, input[type="checkbox"]');
          if (radios.length > 0 || cbs.length > 0) {
            debugInfo.push(`Create form appeared after ${w + 1}s (radios=${radios.length}, cbs=${cbs.length})`);
            break;
          }
        }

        // Re-check
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

      await sleep(1000); // let Angular stabilize

      // Step C: Now we're on the create form. Gather all elements again.
      const inputs = document.querySelectorAll('input');
      const buttons = document.querySelectorAll('button, [role="button"]');
      cbs = document.querySelectorAll('[role="checkbox"], mat-checkbox, .mat-mdc-checkbox, input[type="checkbox"]');
      radios = document.querySelectorAll('[role="radio"], mat-radio-button, .mat-mdc-radio-button');

      if (debug) {
        debugInfo.push(`Form: ${inputs.length} inputs, ${buttons.length} buttons, ${cbs.length} cbs, ${radios.length} radios`);
        buttons.forEach((btn, i) => {
          debugInfo.push(`  btn[${i}] "${btn.textContent.trim().substring(0, 60)}" disabled=${btn.disabled} tag=${btn.tagName}`);
        });
        inputs.forEach((inp, i) => {
          debugInfo.push(`  inp[${i}] type=${inp.type} aria="${inp.getAttribute('aria-label') || ''}" `);
        });
        radios.forEach((r, i) => {
          debugInfo.push(`  radio[${i}] "${r.textContent.trim().substring(0, 60)}"`);
        });
        cbs.forEach((c, i) => {
          debugInfo.push(`  cb[${i}] "${c.textContent.trim().substring(0, 60)}" checked=${c.getAttribute('aria-checked')}`);
        });
      }

      // Step D: Fill app name — find the right input (skip search inputs)
      let nameInput = null;
      for (const inp of inputs) {
        if ((inp.type === 'text' || inp.type === '') && !inp.readOnly && !inp.disabled) {
          const ariaLabel = (inp.getAttribute('aria-label') || '').toLowerCase();
          // Skip search inputs
          if (ariaLabel.includes('recherche') || ariaLabel.includes('search') || ariaLabel.includes('filter')) continue;
          nameInput = inp;
          break;
        }
      }

      if (!nameInput) {
        // Fallback: just pick the first text input
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
        // Fallback: second text input (inp[1])
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
      // Native <input type="radio"> elements have empty textContent — find labels via DOM traversal
      const radioInputs = document.querySelectorAll('input[type="radio"]');
      let radioClicked = { type: false, pricing: false };

      for (const radio of radioInputs) {
        // Find associated text by walking up the DOM tree
        let text = '';

        // Method 1: aria-label on the input itself
        text = (radio.getAttribute('aria-label') || '').toLowerCase();

        // Method 2: label[for] association
        if (!text && radio.id) {
          const lbl = document.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
          if (lbl) text = lbl.textContent.trim().toLowerCase();
        }

        // Method 3: closest wrapping <label>
        if (!text) {
          const lbl = radio.closest('label');
          if (lbl) text = lbl.textContent.trim().toLowerCase();
        }

        // Method 4: walk up parents to find one with short meaningful text
        if (!text) {
          let el = radio.parentElement;
          for (let i = 0; i < 4 && el; i++) {
            const t = el.textContent.trim().toLowerCase();
            if (t.length > 0 && t.length < 80) { text = t; break; }
            el = el.parentElement;
          }
        }

        debugInfo.push(`radio: "${text.substring(0, 60)}" name=${radio.name} val=${radio.value}`);

        // Match App type
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

        // Match Pricing
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

      // Fallback: positional approach if text matching didn't find both
      if (!radioClicked.type || !radioClicked.pricing) {
        debugInfo.push(`Radio text match incomplete (type=${radioClicked.type}, pricing=${radioClicked.pricing}). Trying positional...`);
        const radiosArr = Array.from(radioInputs);

        // Group by name attribute
        const groups = {};
        radiosArr.forEach(r => {
          const n = r.name || 'unnamed';
          if (!groups[n]) groups[n] = [];
          groups[n].push(r);
        });
        const groupKeys = Object.keys(groups);

        if (groupKeys.length >= 2) {
          // Two groups: first = type (App/Game), second = pricing (Free/Paid)
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
          // All same name or unnamed: assume [0]=App, [1]=Game, [2]=Free, [3]=Paid
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

      // Step F: Check all checkboxes (policy declarations)
      // Handle both native <input type="checkbox"> and Angular/Material containers
      const cbInputs = document.querySelectorAll('input[type="checkbox"]');
      debugInfo.push(`Checkboxes: ${cbInputs.length} native inputs, ${cbs.length} role/material`);

      // Click native checkbox inputs first
      for (const cb of cbInputs) {
        if (!cb.checked) {
          // Try clicking the parent label (better for Angular change detection)
          const label = cb.closest('label');
          if (label) {
            label.click();
          } else {
            cb.click();
          }
          cb.dispatchEvent(new Event('change', { bubbles: true }));
          debugInfo.push(`  cb native clicked, now checked=${cb.checked}`);
          await sleep(300);
        } else {
          debugInfo.push(`  cb native already checked`);
        }
      }

      // Also try clicking [role="checkbox"] containers (Angular/Material)
      for (const cb of cbs) {
        if (cb.tagName === 'INPUT') continue; // already handled above
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

      // Step G: Find and click Create submit button (must be a BUTTON, not an A link)
      let createBtn = null;

      // Strategy 1: button (not <a>) containing "créer" or "create"
      const realButtons = document.querySelectorAll('button');
      for (const btn of realButtons) {
        const t = btn.textContent.toLowerCase().trim();
        if ((t.includes('créer') || t.includes('create')) &&
            !t.includes('cancel') && !t.includes('annuler')) {
          createBtn = btn;
          break;
        }
      }

      // Strategy 2: "Envoyer" / "Submit" button (it was [40] "Envoyer" disabled=true)
      // After filling form it may become enabled
      if (!createBtn) {
        for (const btn of realButtons) {
          const t = btn.textContent.toLowerCase().trim();
          if (t === 'envoyer' || t === 'submit') {
            createBtn = btn;
            break;
          }
        }
      }

      // Strategy 3: last non-disabled button
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
        // Wait up to 8 seconds for Angular to enable it after radios/checkboxes were clicked
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

// ==================== GITHUB BUILD & PUBLISH ====================

// Fetch repos accessible by the token
async function fetchGitHubRepos(token) {
  const repos = [];
  let page = 1;
  while (page <= 5) {
    const res = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated`, {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) break;
    const data = await res.json();
    if (!data.length) break;
    repos.push(...data);
    page++;
  }
  // Also fetch org repos the token can access
  try {
    const orgRes = await fetch('https://api.github.com/user/orgs', {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (orgRes.ok) {
      const orgs = await orgRes.json();
      for (const org of orgs) {
        let p = 1;
        while (p <= 3) {
          const r = await fetch(`https://api.github.com/orgs/${org.login}/repos?per_page=100&page=${p}`, {
            headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
          });
          if (!r.ok) break;
          const d = await r.json();
          if (!d.length) break;
          d.forEach(repo => { if (!repos.find(r => r.full_name === repo.full_name)) repos.push(repo); });
          p++;
        }
      }
    }
  } catch (_) {}
  return repos.sort((a, b) => a.full_name.localeCompare(b.full_name));
}

// Fetch branches for a repo
async function fetchGitHubBranches(token, repoFullName) {
  const branches = [];
  let page = 1;
  while (page <= 5) {
    const res = await fetch(`https://api.github.com/repos/${repoFullName}/branches?per_page=100&page=${page}`, {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) break;
    const data = await res.json();
    if (!data.length) break;
    branches.push(...data);
    page++;
  }
  return branches.map(b => b.name);
}

// Populate repo dropdown
async function loadRepoSelector(token) {
  const select = document.getElementById('ghRepo');
  const savedRepo = select.value;
  select.innerHTML = '<option value="">⏳ Loading repos...</option>';
  select.disabled = true;
  try {
    const repos = await fetchGitHubRepos(token);
    select.innerHTML = '<option value="">-- Select a repository --</option>';
    repos.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.full_name;
      opt.textContent = `${r.full_name}${r.private ? ' 🔒' : ''}`;
      select.appendChild(opt);
    });
    // Restore saved value if it exists
    if (savedRepo && select.querySelector(`option[value="${savedRepo}"]`)) {
      select.value = savedRepo;
      loadBranchSelector(token, savedRepo);
    }
  } catch (e) {
    select.innerHTML = '<option value="">❌ Failed to load repos</option>';
  }
  select.disabled = false;
}

// Populate branch dropdown
async function loadBranchSelector(token, repoFullName) {
  const select = document.getElementById('ghBaseBranch');
  const savedBranch = select.value;
  select.innerHTML = '<option value="">⏳ Loading branches...</option>';
  select.disabled = true;
  try {
    const branches = await fetchGitHubBranches(token, repoFullName);
    select.innerHTML = '';
    // Put default branch first (main/master)
    const defaults = ['main', 'master'];
    const sorted = [...branches].sort((a, b) => {
      const ai = defaults.indexOf(a), bi = defaults.indexOf(b);
      if (ai >= 0 && bi < 0) return -1;
      if (bi >= 0 && ai < 0) return 1;
      return a.localeCompare(b);
    });
    sorted.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name + (defaults.includes(name) ? ' ⭐' : '');
      select.appendChild(opt);
    });
    // Restore saved value or pick default
    if (savedBranch && select.querySelector(`option[value="${savedBranch}"]`)) {
      select.value = savedBranch;
    } else if (select.querySelector('option[value="main"]')) {
      select.value = 'main';
    } else if (select.querySelector('option[value="master"]')) {
      select.value = 'master';
    }
    chrome.storage.local.set({ ghBaseBranch: select.value });
    if (select.value) loadListingDefaultsForBranch(token, repoFullName, select.value);
  } catch (e) {
    select.innerHTML = '<option value="">❌ Failed to load branches</option>';
  }
  select.disabled = false;
}

// Persist GitHub settings
document.addEventListener('DOMContentLoaded', () => {
  const fields = ['ghToken', 'ghRepo', 'ghBranch', 'ghBaseBranch', 'geminiApiKey', 'whatsAppNumber'];
  chrome.storage.local.get(fields, (d) => {
    fields.forEach(f => { if (d[f]) document.getElementById(f).value = d[f]; });
    // Auto-load repos if token is saved
    if (d.ghToken) {
      loadRepoSelector(d.ghToken);
    }
  });

  // Gemini key persistence
  const geminiEl = document.getElementById('geminiApiKey');
  if (geminiEl) {
    geminiEl.addEventListener('input', () => {
      chrome.storage.local.set({ geminiApiKey: geminiEl.value.trim() });
    });
  }

  // WhatsApp number persistence
  const waEl = document.getElementById('whatsAppNumber');
  if (waEl) {
    waEl.addEventListener('input', () => {
      chrome.storage.local.set({ whatsAppNumber: waEl.value.trim() });
    });
  }

  // Token change: reload repos
  const tokenEl = document.getElementById('ghToken');
  if (tokenEl) {
    let debounce;
    tokenEl.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const val = tokenEl.value.trim();
        chrome.storage.local.set({ ghToken: val });
        if (val.length > 10) loadRepoSelector(val);
      }, 800);
    });
    tokenEl.addEventListener('change', () => {
      const val = tokenEl.value.trim();
      chrome.storage.local.set({ ghToken: val });
      if (val.length > 10) loadRepoSelector(val);
    });
  }

  // Repo change: load branches
  const repoEl = document.getElementById('ghRepo');
  if (repoEl) {
    repoEl.addEventListener('change', () => {
      const val = repoEl.value;
      chrome.storage.local.set({ ghRepo: val });
      const token = document.getElementById('ghToken').value.trim();
      if (val && token) loadBranchSelector(token, val);
    });
  }

  // Manual repo input: override select
  const manualEl = document.getElementById('ghRepoManual');
  if (manualEl) {
    manualEl.addEventListener('change', () => {
      const val = manualEl.value.trim();
      if (val) {
        const select = document.getElementById('ghRepo');
        // Add option if not in list
        if (!select.querySelector(`option[value="${val}"]`)) {
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent = val + ' (manual)';
          select.appendChild(opt);
        }
        select.value = val;
        chrome.storage.local.set({ ghRepo: val });
        const token = document.getElementById('ghToken').value.trim();
        if (token) loadBranchSelector(token, val);
      }
    });
  }

  // Base branch change: persist
  const baseBranchEl = document.getElementById('ghBaseBranch');
  if (baseBranchEl) {
    baseBranchEl.addEventListener('change', () => {
      chrome.storage.local.set({ ghBaseBranch: baseBranchEl.value });
      const token = document.getElementById('ghToken').value.trim();
      const repo = document.getElementById('ghRepo').value.trim();
      if (token && repo && baseBranchEl.value) loadListingDefaultsForBranch(token, repo, baseBranchEl.value);
    });
  }

  // Build toggle
  const buildToggle = document.getElementById('buildToggle');
  if (buildToggle) {
    buildToggle.addEventListener('click', function() {
      const section = document.getElementById('buildSection');
      section.classList.toggle('open');
      this.textContent = section.classList.contains('open') ? '▼ Hide build settings' : '▶ Show build settings';
    });
  }
});

function buildLog(msg, cls = '') {
  const el = document.getElementById('buildStatus');
  el.innerHTML += `<div class="log-entry ${cls}">${msg}</div>`;
  el.scrollTop = el.scrollHeight;
  _saveState();
}

// ---- AI Description Generator (Gemini) ----
async function generateDescriptions(appName, packageName, screenshots, language) {
  const apiKey = document.getElementById('geminiApiKey').value.trim();
  if (!apiKey) {
    throw new Error('Enter your Gemini API key in the config section first');
  }
  if (!appName) {
    throw new Error('Enter at least one app name first');
  }

  const prompt = `You are a Google Play Store listing expert. Create a title, short description, and full description for an Android app.

App name / brand: "${appName}"
Package identifier: "${packageName || 'not provided'}"
Target language: ${language || 'English'}

Use the attached app screenshots to identify only features that are visibly supported. Keep the supplied app name recognizable in the title. If the screenshots do not establish a feature, do not claim it.

STRICT RULES:
- Title: MUST be 30 characters or fewer; use the app name as the brand.
- Short description: MUST be 80 characters or fewer; one clear sentence.
- Full description: MUST be 4000 characters or fewer; describe visible features accurately.
- Do NOT invent functionality, claims, statistics, awards, or compatibility.
- Do NOT include pricing, ratings, badges, or promotional claims.
- Do NOT use excessive caps, emojis, or keyword stuffing.
- Do NOT mention competitor apps.
- Do NOT make health/medical claims unless it's a medical app.
- Use professional, engaging language.
- Use line breaks and bullet points (with -) for readability.

Respond ONLY with valid JSON, no markdown:
{"title": "...", "short_description": "...", "full_description": "..."}`;

  const imageParts = (screenshots || []).map(image => ({
    inline_data: { mime_type: image.mimeType, data: image.base64 }
  }));

  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, ...imageParts] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${err.substring(0, 200)}`);
  }

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  
  // Extract JSON from response (may have markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI response did not contain valid JSON');
  const result = JSON.parse(jsonMatch[0]);
  const title = String(result.title || appName).trim().substring(0, 30);
  const shortDescription = String(result.short_description || '').trim();
  const fullDescription = String(result.full_description || '').trim();
  if (!title || !shortDescription || !fullDescription) throw new Error('AI response is missing listing text');

  return {
    title,
    short_description: shortDescription.substring(0, 80),
    full_description: fullDescription.substring(0, 4000)
  };
}

const projectScreenshotCache = new Map();
const appListingCopyCache = new Map();

async function loadProjectScreenshotAssets(token, repo, ref) {
  const cacheKey = `${repo}@${ref}`;
  if (projectScreenshotCache.has(cacheKey)) return projectScreenshotCache.get(cacheKey);

  const promise = (async () => {
    const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
    const treeResponse = await fetch(`https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { headers });
    if (!treeResponse.ok) throw new Error(`Could not read screenshot list (${treeResponse.status})`);
    const tree = await treeResponse.json();
    const entries = (tree.tree || [])
      .filter(entry => entry.type === 'blob' && entry.path.startsWith('docs/screens/') && entry.size <= 4 * 1024 * 1024)
      .filter(entry => /\.(png|jpe?g|webp)$/i.test(entry.path))
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, 3);

    return Promise.all(entries.map(async entry => {
      const response = await fetch(`https://api.github.com/repos/${repo}/git/blobs/${entry.sha}`, { headers });
      if (!response.ok) throw new Error(`Could not read screenshot ${entry.path} (${response.status})`);
      const blob = await response.json();
      const extension = entry.path.split('.').pop().toLowerCase();
      const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
      return { path: entry.path, mimeType, base64: blob.content.replace(/\s/g, '') };
    }));
  })();

  projectScreenshotCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    projectScreenshotCache.delete(cacheKey);
    throw error;
  }
}

async function prepareAppListingCopy(token, repo, ref, appName, packageName, fallback, logFn = log) {
  const safeFallback = {
    title: (appName || 'App').trim().substring(0, 30),
    shortDescription: fallback.shortDescription || '',
    fullDescription: fallback.fullDescription || ''
  };
  const cacheKey = `${repo}@${ref}:${packageName}:${appName}`;
  if (appListingCopyCache.has(cacheKey)) return appListingCopyCache.get(cacheKey);

  try {
    const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
    const repoResponse = await fetch(`https://api.github.com/repos/${repo}`, { headers });
    const repoInfo = repoResponse.ok ? await repoResponse.json() : {};
    const refs = [...new Set([ref, repoInfo.default_branch || 'main'])];
    for (const sourceRef of refs) {
      const defaults = await readListingDefaults(token, repo, sourceRef);
      const prepared = defaults.content.applications[packageName];
      if (prepared?.title && prepared?.short_description && prepared?.full_description) {
        const listingCopy = {
          title: String(prepared.title).substring(0, 30),
          shortDescription: String(prepared.short_description).substring(0, 80),
          fullDescription: String(prepared.full_description).substring(0, 4000)
        };
        appListingCopyCache.set(cacheKey, listingCopy);
        logFn(`Using prepared JSON listing copy from ${sourceRef} for "${appName}".`, 'info');
        return listingCopy;
      }
    }
  } catch (error) {
    logFn(`Could not read prepared listing JSON for "${appName}": ${error.message}`, 'info');
  }

  if (!document.getElementById('geminiApiKey').value.trim()) {
    logFn(`No Gemini key set; keeping entered listing text for "${appName}".`, 'info');
    return safeFallback;
  }

  try {
    const screenshots = await loadProjectScreenshotAssets(token, repo, ref);
    if (!screenshots.length) {
      logFn(`No usable docs/screens images found for "${appName}"; keeping entered listing text.`, 'info');
      return safeFallback;
    }
    const language = document.getElementById('language')?.selectedOptions?.[0]?.textContent.trim() || 'English';
    const generated = await generateDescriptions(appName, packageName, screenshots, language);
    logFn(`Generated Play title and descriptions from ${screenshots.length} screenshot(s) for "${appName}".`, 'success');
    const listingCopy = {
      title: generated.title,
      shortDescription: generated.short_description,
      fullDescription: generated.full_description
    };
    appListingCopyCache.set(cacheKey, listingCopy);
    return listingCopy;
  } catch (error) {
    logFn(`AI listing generation failed for "${appName}"; keeping entered text (${error.message}).`, 'error');
    return safeFallback;
  }
}

function parseStoreListingSections(source) {
  const sections = {};
  let currentSection = '';
  for (const line of source.split(/\r?\n/)) {
    const header = line.trim().match(/^(App name|Short description|Full description)$/i);
    if (header) {
      currentSection = header[1].toLowerCase();
      sections[currentSection] ||= [];
    } else if (/^(Category|Keywords|Contact|Website)\s*$/i.test(line.trim())) {
      currentSection = '';
    } else if (currentSection) {
      sections[currentSection].push(line);
    }
  }
  return Object.fromEntries(Object.entries(sections).map(([key, lines]) => [key, lines.join('\n').trim()]));
}

async function getRepositoryListingContext(token, repo) {
  const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
  const repoResponse = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  if (!repoResponse.ok) throw new Error(`Could not read repository (${repoResponse.status})`);
  const repoInfo = await repoResponse.json();
  const branch = repoInfo.default_branch || 'main';
  const treeResponse = await fetch(`https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers });
  if (!treeResponse.ok) throw new Error(`Could not read repository tree (${treeResponse.status})`);
  const tree = await treeResponse.json();
  if (tree.truncated) throw new Error('Repository tree is too large to inspect');

  const entries = tree.tree || [];
  const paths = new Set(entries.filter(entry => entry.type === 'blob').map(entry => entry.path));
  const gradlePath = [
    'android/app/build.gradle.kts',
    'android/app/build.gradle',
    'app/build.gradle.kts',
    'app/build.gradle'
  ].find(path => paths.has(path));
  if (!gradlePath) return null;

  const screenshots = entries
    .filter(entry => entry.type === 'blob' && entry.path.startsWith('docs/screens/') && entry.size <= 4 * 1024 * 1024)
    .filter(entry => /\.(png|jpe?g|webp)$/i.test(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, 3);
  if (!screenshots.length) return null;

  const readText = async path => {
    const entry = entries.find(item => item.path === path && item.type === 'blob');
    if (!entry) return '';
    const response = await fetch(`https://api.github.com/repos/${repo}/git/blobs/${entry.sha}`, { headers });
    if (!response.ok) return '';
    const blob = await response.json();
    const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, '')), character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };

  const gradle = await readText(gradlePath);
  const applicationId = gradle.match(/applicationId\s*(?:=\s*)?["']([^"']+)["']/)?.[1];
  if (!applicationId) return null;

  const storeListing = parseStoreListingSections(await readText('docs/store_listing.txt'));
  const fastlaneTitle = (await readText('fastlane/metadata/android/en-US/title.txt')).trim();
  let appName = storeListing['app name'] || fastlaneTitle;
  if (!appName) {
    const strings = await readText('android/app/src/main/res/values/strings.xml') || await readText('app/src/main/res/values/strings.xml');
    appName = strings.match(/<string\s+name=["']app_name["'][^>]*>([^<]+)<\/string>/i)?.[1]?.trim() || '';
  }
  if (!appName) {
    appName = applicationId.split('.').pop().replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  }

  const fastlaneShort = (await readText('fastlane/metadata/android/en-US/short_description.txt')).trim();
  const fastlaneFull = (await readText('fastlane/metadata/android/en-US/full_description.txt')).trim();
  const readme = await readText('README.md');
  const readmeParagraphs = readme
    .replace(/^\s*#.*$/gm, '')
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph.length > 30 && !paragraph.startsWith('!['));
  const fullDescription = storeListing['full description'] || fastlaneFull || readmeParagraphs.slice(0, 3).join('\n\n');
  const shortSource = storeListing['short description'] || fastlaneShort || fullDescription.split(/[.!?]\s/)[0];
  const shortDescription = shortSource.length > 80 ? `${shortSource.substring(0, 77).trimEnd()}...` : shortSource;
  const listingCopy = {
    title: appName.substring(0, 30),
    shortDescription: shortDescription || `${appName} for Android.`,
    fullDescription: (fullDescription || `${appName} is an Android application.`).substring(0, 4000)
  };

  return { branch, applicationId, appName, listingCopy, screenshotPaths: screenshots.map(entry => entry.path) };
}

async function readListingDefaults(token, repo, branch) {
  const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
  const path = 'docs/play_listing_defaults.json';
  const response = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, { headers });
  if (response.status === 404) return { path, sha: null, content: { schema_version: 1, applications: {} } };
  if (!response.ok) throw new Error(`Could not read listing defaults (${response.status})`);
  const file = await response.json();
  const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), character => character.charCodeAt(0));
  const content = JSON.parse(new TextDecoder().decode(bytes));
  if (!content.applications || typeof content.applications !== 'object') content.applications = {};
  return { path, sha: file.sha, content };
}

async function loadListingDefaultsForBranch(token, repo, branch) {
  const status = document.getElementById('listingDefaultsStatus');
  const appNamesInput = document.getElementById('appNames');
  const firstLine = appNamesInput.value.split('\n')[0] || '';
  const separator = firstLine.indexOf('|');
  const currentName = (separator < 0 ? firstLine : firstLine.slice(0, separator)).trim();
  const currentPackage = separator < 0 ? '' : firstLine.slice(separator + 1).trim();

  try {
    const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
    const repoResponse = await fetch(`https://api.github.com/repos/${repo}`, { headers });
    const repoInfo = repoResponse.ok ? await repoResponse.json() : {};
    const refs = [...new Set([branch, repoInfo.default_branch || 'main'])];

    for (const sourceRef of refs) {
      const defaults = await readListingDefaults(token, repo, sourceRef);
      const entries = Object.entries(defaults.content.applications);
      let match = entries.find(([applicationId]) => applicationId === currentPackage || applicationId === branch);
      if (!match && currentName) {
        match = entries.find(([, value]) => String(value.title || '').trim().toLowerCase() === currentName.toLowerCase());
      }
      if (!match && entries.length === 1) match = entries[0];
      if (!match) continue;

      const [applicationId, listing] = match;
      if (!listing.title || !listing.short_description || !listing.full_description) continue;
      const appLines = appNamesInput.value.split('\n');
      appLines[0] = `${listing.title}|${applicationId}`;
      appNamesInput.value = appLines.join('\n');
      appNamesInput.dispatchEvent(new Event('input', { bubbles: true }));

      const shortDescription = document.getElementById('shortDesc');
      const fullDescription = document.getElementById('fullDesc');
      shortDescription.value = String(listing.short_description).substring(0, 80);
      fullDescription.value = String(listing.full_description).substring(0, 4000);
      shortDescription.dispatchEvent(new Event('input', { bubbles: true }));
      fullDescription.dispatchEvent(new Event('input', { bubbles: true }));
      if (status) status.textContent = `Loaded prepared listing defaults for ${applicationId} from ${sourceRef}.`;
      return true;
    }

    if (status) status.textContent = `No prepared listing defaults found for branch ${branch}.`;
  } catch (error) {
    if (status) status.textContent = `Could not load listing defaults: ${error.message}`;
  }
  return false;
}

async function writeListingDefaults(token, repo, branch, defaults, applicationId, listingCopy, screenshotPaths) {
  const application = {
    title: listingCopy.title,
    short_description: listingCopy.shortDescription,
    full_description: listingCopy.fullDescription,
    source_screenshots: screenshotPaths,
    generated_at: new Date().toISOString()
  };
  defaults.content.applications[applicationId] = application;
  const body = {
    message: `Add Play listing defaults for ${applicationId}`,
    branch,
    content: btoa(unescape(encodeURIComponent(`${JSON.stringify(defaults.content, null, 2)}\n`)))
  };
  if (defaults.sha) body.sha = defaults.sha;
  const response = await fetch(`https://api.github.com/repos/${repo}/contents/${defaults.path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Could not write listing defaults (${response.status})`);
  }
}

async function generateListingDefaultsForAllRepos() {
  const button = document.getElementById('generateListingDefaultsBtn');
  const status = document.getElementById('listingDefaultsStatus');
  const token = document.getElementById('ghToken').value.trim();
  if (!token) {
    status.textContent = 'Enter a GitHub token first.';
    return;
  }

  button.disabled = true;
  let saved = 0;
  let skipped = 0;
  let failed = 0;
  try {
    status.textContent = 'Loading accessible repositories...';
    const repos = await fetchGitHubRepos(token);
    for (let index = 0; index < repos.length; index++) {
      const repo = repos[index].full_name;
      status.textContent = `Preparing listing defaults ${index + 1}/${repos.length}: ${repo}`;
      try {
        const context = await getRepositoryListingContext(token, repo);
        if (!context) { skipped++; continue; }

        const defaults = await readListingDefaults(token, repo, context.branch);
        if (defaults.content.applications[context.applicationId]) { skipped++; continue; }
        await writeListingDefaults(token, repo, context.branch, defaults, context.applicationId, context.listingCopy, context.screenshotPaths);
        saved++;
      } catch (error) {
        failed++;
        console.warn(`Listing defaults failed for ${repo}: ${error.message}`);
      }
    }
    status.textContent = `Done: ${saved} JSON file(s) created, ${skipped} skipped, ${failed} failed.`;
  } catch (error) {
    status.textContent = `Could not prepare listing defaults: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

// Wire up generate button and character counters
document.addEventListener('DOMContentLoaded', () => {
  const shortEl = document.getElementById('shortDesc');
  const fullEl = document.getElementById('fullDesc');
  const shortCount = document.getElementById('shortDescCount');
  const fullCount = document.getElementById('fullDescCount');

  function updateCounts() {
    if (shortCount && shortEl) shortCount.textContent = `${shortEl.value.length}/80`;
    if (fullCount && fullEl) fullCount.textContent = `${fullEl.value.length}/4000`;
    // Color red if near/over limit
    if (shortCount) shortCount.style.color = shortEl.value.length > 75 ? '#ff4757' : '#666';
    if (fullCount) fullCount.style.color = fullEl.value.length > 3800 ? '#ff4757' : '#666';
  }
  if (shortEl) shortEl.addEventListener('input', updateCounts);
  if (fullEl) fullEl.addEventListener('input', updateCounts);
  updateCounts();

  const genBtn = document.getElementById('generateDescBtn');
  if (genBtn) {
    genBtn.addEventListener('click', async () => {
      const app = getAppEntries()[0];
      const appName = app?.name || '';
      const token = document.getElementById('ghToken').value.trim();
      const repo = document.getElementById('ghRepo').value.trim();
      const ref = document.getElementById('ghBaseBranch').value.trim() || 'main';
      
      genBtn.disabled = true;
      genBtn.textContent = '⏳ Generating...';
      
      try {
        if (!token || !repo) throw new Error('Select a GitHub repository to use its docs/screens images.');
        if (!document.getElementById('geminiApiKey').value.trim()) throw new Error('Add a Gemini API key first.');
        if (!appName) throw new Error('Enter an app name first.');
        const screenshots = await loadProjectScreenshotAssets(token, repo, ref);
        if (!screenshots.length) throw new Error('No usable screenshots found in docs/screens on the selected branch.');
        const listingCopy = await prepareAppListingCopy(token, repo, ref, appName, app.pkg, {
          shortDescription: shortEl.value.trim(),
          fullDescription: fullEl.value.trim()
        });
        shortEl.value = listingCopy.shortDescription;
        fullEl.value = listingCopy.fullDescription;
        updateCounts();
        genBtn.textContent = `✅ ${listingCopy.title}`;
        genBtn.style.background = '#2ed573';
        setTimeout(() => {
          genBtn.textContent = '✨ Generate Descriptions with AI';
          genBtn.style.background = '#9b59b6';
        }, 2000);
      } catch (e) {
        genBtn.textContent = '❌ ' + e.message;
        genBtn.style.background = '#ff4757';
        setTimeout(() => {
          genBtn.textContent = '✨ Generate Descriptions with AI';
          genBtn.style.background = '#9b59b6';
        }, 3000);
      } finally {
        genBtn.disabled = false;
      }
    });
  }

  const listingDefaultsBtn = document.getElementById('generateListingDefaultsBtn');
  if (listingDefaultsBtn) listingDefaultsBtn.addEventListener('click', generateListingDefaultsForAllRepos);
});

// Push workflow files (build.yml) from default branch to a variant branch via GitHub Contents API
async function pushWorkflowsToBranch(token, repo, branch, logFn) {
  logFn = logFn || buildLog;
  logFn(`  📋 Pushing workflow files to branch "${branch}"...`, 'log-info');
  const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
  try {
    // Get repo default branch
    const repoInfo = await fetch(`https://api.github.com/repos/${repo}`, { headers }).then(r => r.json());
    const defaultBranch = repoInfo.default_branch || 'main';
    // List workflow files on default branch
    const wfList = await fetch(`https://api.github.com/repos/${repo}/contents/.github/workflows?ref=${defaultBranch}`, { headers }).then(r => r.json());
    if (!Array.isArray(wfList)) { logFn('  ⚠️ No workflows found on default branch', 'log-error'); return; }
    for (const wf of wfList) {
      // Get file content from default branch
      const srcFile = await fetch(`https://api.github.com/repos/${repo}/contents/${wf.path}?ref=${defaultBranch}`, { headers }).then(r => r.json());
      // Check if file exists on variant branch
      let sha = null;
      try {
        const existing = await fetch(`https://api.github.com/repos/${repo}/contents/${wf.path}?ref=${branch}`, { headers });
        if (existing.ok) { const data = await existing.json(); sha = data.sha; }
      } catch (_) {}
      const body = { message: `Sync ${wf.name} from ${defaultBranch}`, content: srcFile.content.replace(/\n/g, ''), branch };
      if (sha) body.sha = sha;
      const resp = await fetch(`https://api.github.com/repos/${repo}/contents/${wf.path}`, {
        method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (resp.ok) logFn(`  ✅ ${wf.name} synced`, 'log-success');
      else logFn(`  ⚠️ Failed to sync ${wf.name}: ${resp.status}`, 'log-error');
    }
  } catch (e) {
    logFn(`  ⚠️ Workflow sync error: ${e.message}`, 'log-error');
  }
}

// Push custom app logo to a branch via GitHub Contents API (icon.png + mipmap sizes)
async function pushLogoToBranch(token, repo, branch, logFn) {
  if (!appLogoBase64) return; // No custom logo uploaded
  logFn = logFn || buildLog;
  logFn(`  🎨 Pushing custom logo to branch "${branch}"...`, 'log-info');

  const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };

  // Helper: push a file (create or update)
  async function pushFile(path, contentBase64, msg) {
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;
    // Get existing file SHA if it exists
    let sha = null;
    try {
      const existing = await fetch(`${url}?ref=${branch}`, { headers });
      if (existing.ok) {
        const data = await existing.json();
        sha = data.sha;
      }
    } catch (e) {}
    const body = { message: msg, content: contentBase64, branch };
    if (sha) body.sha = sha;
    const resp = await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return resp.ok;
  }

  async function deleteFile(path) {
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;
    try {
      const existing = await fetch(`${url}?ref=${branch}`, { headers });
      if (!existing.ok) return; // file doesn't exist
      const data = await existing.json();
      await fetch(url, { method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Remove ${path.split('/').pop()}`, sha: data.sha, branch }) });
    } catch (e) {}
  }

  // Helper: resize logo to given size using canvas, return base64
  function resizeToBase64(size, format = 'image/png') {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        canvas.getContext('2d').drawImage(img, 0, 0, size, size);
        const dataUrl = canvas.toDataURL(format);
        resolve(dataUrl.replace(/^data:[^;]+;base64,/, ''));
      };
      img.src = 'data:image/png;base64,' + appLogoBase64;
    });
  }

  try {
    // 1. Push 512x512 icon.png for store listing
    const ok = await pushFile('fastlane/metadata/android/en-US/images/icon.png', appLogoBase64, 'Add custom app icon');
    if (ok) logFn('  ✅ Store icon (512x512) pushed', 'log-success');
    else logFn('  ⚠️ Failed to push store icon', 'log-error');

    // 2. Push mipmap sizes for launcher icon (PNG to avoid duplicate resource conflicts)
    const mipmaps = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
    for (const [density, px] of Object.entries(mipmaps)) {
      const resized = await resizeToBase64(px, 'image/png');
      const folder = `app/src/main/res/mipmap-${density}`;
      await pushFile(`${folder}/ic_launcher.png`, resized, `Update ${density} icon`);
      await pushFile(`${folder}/ic_launcher_round.png`, resized, `Update ${density} round icon`);
      // Delete old webp files to avoid duplicate resources
      for (const old of ['ic_launcher.webp', 'ic_launcher_foreground.webp', 'ic_launcher_round.webp']) {
        await deleteFile(`${folder}/${old}`);
      }
    }
    // Delete adaptive icon XML that references foreground (no longer needed)
    await deleteFile('app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml');
    await deleteFile('app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml');
    logFn('  ✅ All mipmap icons pushed', 'log-success');
  } catch (e) {
    logFn(`  ⚠️ Logo push error: ${e.message}`, 'log-error');
  }
}

// Push auto-generated privacy policy HTML to a dedicated public privacy-policies repo
async function pushPrivacyPolicyToBranch(token, repo, branch, appName, packageName, contactEmail, logFn) {
  logFn = logFn || buildLog;
  logFn(`  📜 Generating privacy policy for "${appName}"...`, 'log-info');

  const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
  const today = new Date().toISOString().split('T')[0];
  // Always use the authenticated user's privacy-policies repo (not the build repo owner)
  let owner;
  try {
    const userRes = await fetch('https://api.github.com/user', { headers });
    if (userRes.ok) { const u = await userRes.json(); owner = u.login; }
  } catch(_) {}
  if (!owner) owner = repo.split('/')[0];
  const policyRepo = `${owner}/privacy-policies`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Privacy Policy - ${appName}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.6;color:#333}
h1{color:#1a73e8}h2{color:#444;margin-top:24px}p{margin:8px 0}
</style>
</head>
<body>
<h1>Privacy Policy</h1>
<p><strong>App:</strong> ${appName}</p>
<p><strong>Last updated:</strong> ${today}</p>

<h2>Introduction</h2>
<p>${appName} ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use our mobile application.</p>

<h2>Information We Collect</h2>
<p>Our app does not collect, store, or share any personal information. We do not require user registration or login.</p>

<h2>Third-Party Services</h2>
<p>Our app may use third-party services (such as Google AdMob for advertisements) that may collect information used to identify you. Please refer to the privacy policies of these third-party service providers for more details.</p>

<h2>Log Data</h2>
<p>In case of an error in the app, we may collect data and information (through third-party products) called Log Data. This Log Data may include information such as your device name, operating system version, the configuration of the app, the time and date of your use of the app, and other statistics. This data is used solely for improving app performance.</p>

<h2>Security</h2>
<p>We value your trust and strive to use commercially acceptable means of protecting any information. However, no method of transmission over the internet or electronic storage is 100% secure.</p>

<h2>Children's Privacy</h2>
<p>Our app does not address anyone under the age of 13. We do not knowingly collect personally identifiable information from children under 13.</p>

<h2>Changes to This Privacy Policy</h2>
<p>We may update our Privacy Policy from time to time. You are advised to review this page periodically for any changes.</p>

<h2>Contact Us</h2>
<p>If you have any questions about this Privacy Policy, please contact us at: <a href="mailto:${contactEmail}">${contactEmail}</a></p>
</body>
</html>`;

  const contentBase64 = btoa(unescape(encodeURIComponent(html)));
  const filePath = `${packageName}/index.html`;

  try {
    // Check if privacy-policies repo exists, create if not
    const repoCheck = await fetch(`https://api.github.com/repos/${policyRepo}`, { headers });
    if (!repoCheck.ok) {
      logFn(`  📄 Creating public privacy-policies repo...`, 'log-info');
      // Try org repo creation first, then user
      let createUrl = `https://api.github.com/orgs/${owner}/repos`;
      let createRes = await fetch(createUrl, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'privacy-policies', description: 'Public privacy policies for all apps', private: false, auto_init: true })
      });
      if (!createRes.ok) {
        // Fallback: user repo
        createRes = await fetch('https://api.github.com/user/repos', {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'privacy-policies', description: 'Public privacy policies for all apps', private: false, auto_init: true })
        });
      }
      if (createRes.ok) {
        logFn(`  ✅ Repo ${policyRepo} created`, 'log-success');
        // Wait for repo to be ready
        await new Promise(r => setTimeout(r, 3000));
        // Enable GitHub Pages
        try {
          await fetch(`https://api.github.com/repos/${policyRepo}/pages`, {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: { branch: 'main', path: '/' } })
          });
        } catch (_) {}
      } else {
        logFn(`  ⚠️ Could not create privacy-policies repo`, 'log-error');
        return null;
      }
    }

    // Push/update the privacy policy file
    let sha = null;
    try {
      const existing = await fetch(`https://api.github.com/repos/${policyRepo}/contents/${filePath}?ref=main`, { headers });
      if (existing.ok) { const data = await existing.json(); sha = data.sha; }
    } catch (_) {}

    const body = { message: `Add privacy policy for ${appName}`, content: contentBase64, branch: 'main' };
    if (sha) body.sha = sha;

    const resp = await fetch(`https://api.github.com/repos/${policyRepo}/contents/${filePath}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });

    if (resp.ok) {
      const pagesUrl = `https://${owner}.github.io/privacy-policies/${packageName}/`;
      logFn(`  ✅ Privacy policy published → ${pagesUrl}`, 'log-success');
      return pagesUrl;
    } else {
      const err = await resp.json().catch(() => ({}));
      logFn(`  ⚠️ Failed to push privacy policy: ${resp.status} ${err.message || ''}`, 'log-error');
      return null;
    }
  } catch (e) {
    logFn(`  ⚠️ Privacy policy push error: ${e.message}`, 'log-error');
    return null;
  }
}

let buildHistoryEntries = [];
let buildHistoryWrite = Promise.resolve();

function mergeBuildHistory(entries, update) {
  const previous = entries.find(entry => entry.key === update.key);
  const entry = { ...previous, ...update, startedAt: previous?.startedAt || Date.now(), updatedAt: Date.now() };
  return [entry, ...entries.filter(existing => existing.key !== entry.key)].slice(0, 100);
}

function renderBuildHistory() {
  const list = document.getElementById('historyList');
  if (!list) return;
  list.replaceChildren();
  if (!buildHistoryEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'update-detail';
    empty.textContent = 'No builds recorded yet.';
    list.appendChild(empty);
  }
  for (const entry of buildHistoryEntries) {
    const row = document.createElement('div');
    row.className = 'history-entry';
    const title = document.createElement('strong');
    title.textContent = entry.label;
    const status = document.createElement('div');
    status.className = `update-detail ${entry.status === 'failed' ? 'log-error' : entry.status === 'completed' ? 'log-success' : 'log-info'}`;
    status.textContent = entry.status === 'completed' ? (entry.publishToPlay ? 'Imported as a draft' : 'Build completed')
      : entry.status === 'failed' ? `Failed: ${entry.error || entry.conclusion || 'Check GitHub Actions'}`
      : entry.status === 'running' ? 'Running' : entry.status === 'queued' ? 'Queued' : 'Status unconfirmed';
    const metadata = document.createElement('div');
    metadata.className = 'update-detail';
    metadata.textContent = `${entry.repo} / ${entry.branch}${entry.track ? ` | ${entry.track}` : ''}\n${new Date(entry.startedAt).toLocaleString()}`;
    const link = document.createElement('a');
    link.href = `https://github.com/${entry.repo}/actions${entry.runId ? `/runs/${entry.runId}` : ''}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'View on GitHub';
    row.append(title, status, metadata, link);
    list.appendChild(row);
  }
}

function recordBuildHistory(update) {
  buildHistoryWrite = buildHistoryWrite.then(async () => {
    const saved = await chrome.storage.local.get(['buildHistory']);
    buildHistoryEntries = mergeBuildHistory(Array.isArray(saved.buildHistory) ? saved.buildHistory : buildHistoryEntries, update);
    await chrome.storage.local.set({ buildHistory: buildHistoryEntries });
    renderBuildHistory();
  }).catch(error => { console.warn('Could not save build history:', error.message); });
  return buildHistoryWrite;
}

async function refreshBuildHistory() {
  const button = document.getElementById('refreshHistoryBtn');
  const status = document.getElementById('historyStatus');
  const token = document.getElementById('ghToken').value.trim();
  if (!token) { status.textContent = 'Configure GitHub in Settings before refreshing.'; return; }
  button.disabled = true;
  status.textContent = 'Refreshing build status...';
  try {
    const saved = await chrome.storage.local.get(['buildHistory']);
    if (Array.isArray(saved.buildHistory)) buildHistoryEntries = saved.buildHistory;
    for (const entry of [...buildHistoryEntries]) {
      if (!['queued', 'running', 'unknown'].includes(entry.status)) continue;
      let runId = entry.runId;
      if (!runId && entry.requestId) {
        const runs = await updateGitHubRequest(token, entry.repo, `actions/workflows/${encodeURIComponent(entry.workflow)}/runs?branch=${encodeURIComponent(entry.branch)}&event=workflow_dispatch&per_page=100`);
        runId = (runs.workflow_runs || []).find(run => run.display_title === `Flutter AAB ${entry.requestId}`)?.id;
      }
      if (!runId) continue;
      const run = await updateGitHubRequest(token, entry.repo, `actions/runs/${runId}`);
      await recordBuildHistory({ key: entry.key, runId, conclusion: run.conclusion,
        status: run.status === 'completed' ? (run.conclusion === 'success' ? 'completed' : 'failed') : 'running' });
    }
    renderBuildHistory();
    status.textContent = 'Build status updated.';
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
}

async function initializeBuildHistory() {
  document.getElementById('refreshHistoryBtn').addEventListener('click', refreshBuildHistory);
  try {
    const saved = await chrome.storage.local.get(['buildHistory']);
    buildHistoryEntries = Array.isArray(saved.buildHistory) ? saved.buildHistory.slice(0, 100) : [];
  } catch (error) { document.getElementById('historyStatus').textContent = error.message; }
  renderBuildHistory();
}

// Global helper: trigger a GitHub Actions workflow and poll until completion
async function triggerAndWait(token, repo, wfFile, ref, inputs, label, logFn) {
  logFn = logFn || buildLog;
  logFn(`[${label}] Triggering ${wfFile}...`, 'log-info');

  const body = { ref };
  if (inputs) body.inputs = inputs;
  const historyKey = inputs?.request_id || crypto.randomUUID();
  const history = { key: historyKey, label, repo, branch: ref, workflow: wfFile,
    requestId: inputs?.request_id, publishToPlay: inputs?.publish_to_play === 'true', track: inputs?.track };

  const triggerRes = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${wfFile}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  if (triggerRes.status !== 204) {
    const err = await triggerRes.json().catch(() => ({}));
    await recordBuildHistory({ ...history, status: 'failed', error: err.message || String(triggerRes.status) });
    logFn(`[${label}] Trigger failed: ${err.message || triggerRes.status}`, 'log-error');
    return false;
  }
  logFn(`[${label}] Triggered!`, 'log-success');
  await recordBuildHistory({ ...history, status: 'queued' });

  // Wait for run to appear
  await new Promise(r => setTimeout(r, 5000));
  let runId = null;
  for (let i = 0; i < 10; i++) {
    const runsUrl = inputs?.request_id
      ? `https://api.github.com/repos/${repo}/actions/workflows/${wfFile}/runs?branch=${encodeURIComponent(ref)}&event=workflow_dispatch&per_page=20`
      : `https://api.github.com/repos/${repo}/actions/runs?per_page=5`;
    const runsRes = await fetch(
      runsUrl,
      { headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
    );
    const runs = await runsRes.json();
    const run = (runs.workflow_runs || []).find(r =>
      (inputs?.request_id ? r.display_title === `Flutter AAB ${inputs.request_id}` : (r.status === 'in_progress' || r.status === 'queued')) &&
      r.path && r.path.includes(wfFile) && r.head_branch === ref
    );
    if (run) { runId = run.id; break; }
    await new Promise(r => setTimeout(r, 3000));
  }

  if (!runId) {
    await recordBuildHistory({ key: historyKey, status: 'unknown' });
    logFn(`[${label}] Could not find running workflow.`, 'log-error');
    return false;
  }
  logFn(`[${label}] Run #${runId} started`, 'log-success');
  await recordBuildHistory({ key: historyKey, runId, status: 'running' });

  // Poll until done
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 30000));
    const runRes = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs/${runId}`,
      { headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
    );
    const run = await runRes.json();
    if (run.status === 'completed') {
      await recordBuildHistory({ key: historyKey, conclusion: run.conclusion, status: run.conclusion === 'success' ? 'completed' : 'failed' });
      if (run.conclusion === 'success') {
        logFn(`[${label}] Completed successfully!`, 'log-success');
        return true;
      } else {
        logFn(`[${label}] Failed: ${run.conclusion}`, 'log-error');
        return false;
      }
    }
    logFn(`[${label}] Running... (${Math.floor((i + 1) * 0.5)}min)`, 'log-info');
  }
  await recordBuildHistory({ key: historyKey, status: 'unknown' });
  logFn(`[${label}] Timed out`, 'log-error');
  return false;
}

function parseAndroidLauncherManifest(content) {
  const document = new DOMParser().parseFromString(content, 'application/xml');
  if (document.getElementsByTagName('parsererror').length || document.documentElement.tagName !== 'manifest') throw new Error('Invalid Android manifest XML.');
  const androidNamespace = 'http://schemas.android.com/apk/res/android';
  const activities = [...document.getElementsByTagName('activity')];
  const hasLauncherIntent = component => [...component.getElementsByTagName('intent-filter')].some(filter =>
    [...filter.getElementsByTagName('action')].some(action => action.getAttributeNS(androidNamespace, 'name') === 'android.intent.action.MAIN') &&
    [...filter.getElementsByTagName('category')].some(category => category.getAttributeNS(androidNamespace, 'name') === 'android.intent.category.LAUNCHER'));
  const launchers = activities.filter(hasLauncherIntent);
  const launcherAliases = [...document.getElementsByTagName('activity-alias')].filter(hasLauncherIntent);
  if (launcherAliases.length) throw new Error('Launcher activity aliases require manual inspection.');
  if (launchers.length !== 1) throw new Error('Expected exactly one Android launcher activity.');
  const name = launchers[0].getAttributeNodeNS(androidNamespace, 'name');
  if (!name) throw new Error('The launcher activity has no android:name.');
  return { content, activityName: name.value, attributeName: name.name, manifestPackage: document.documentElement.getAttribute('package') };
}

function validateAndroidLauncherOverlay(content, path) {
  const document = new DOMParser().parseFromString(content, 'application/xml');
  if (document.getElementsByTagName('parsererror').length || document.documentElement.tagName !== 'manifest') throw new Error(`Invalid Android manifest XML in ${path}.`);
  const androidNamespace = 'http://schemas.android.com/apk/res/android';
  const components = [...document.getElementsByTagName('activity'), ...document.getElementsByTagName('activity-alias')];
  const overridesLauncher = components.some(component => [...component.getElementsByTagName('intent-filter')].some(filter =>
    [...filter.getElementsByTagName('action')].some(action => action.getAttributeNS(androidNamespace, 'name') === 'android.intent.action.MAIN') &&
    [...filter.getElementsByTagName('category')].some(category => category.getAttributeNS(androidNamespace, 'name') === 'android.intent.category.LAUNCHER')));
  if (overridesLauncher) throw new Error(`Build-specific launcher override in ${path} requires manual inspection.`);
}

function getAndroidMainSourcePaths(paths) {
  return [...paths].filter(path => /^android\/app\/src\/main\/(?:kotlin|java)\/.*\.(?:kt|java)$/.test(path));
}

function planFlutterPackageAlignment(applicationId, gradlePath, gradle, androidSources, manifest, paths) {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(applicationId)) throw new Error('Invalid Android applicationId.');
  if (/\b(?:productFlavors|sourceSets|applicationIdSuffix)\b/.test(gradle)) throw new Error('Custom source sets or flavors require manual inspection.');
  const activities = androidSources.filter(source => /\/MainActivity\.(kt|java)$/.test(source.path));
  if (activities.length !== 1) throw new Error('MainActivity is missing or ambiguous; manual inspection is required.');
  const activity = activities[0];
  const stripped = activity.content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '').trim();
  const packageDeclaration = /^\s*package\s+([\w.]+)\s*;?\s*$/m.exec(stripped);
  const activityDeclaration = /^\s*(?:(?:public|open|final|internal)\s+)*class\s+MainActivity\b/m.exec(stripped);
  if (!packageDeclaration || !activityDeclaration) throw new Error('Could not safely identify the MainActivity package and class.');
  const activityPackage = packageDeclaration[1];
  const readGradleProperty = (property) => {
    const pattern = new RegExp(`^[ \\t]*${property}[ \\t]*(?:=[ \\t]*|[ \\t]+|\\([ \\t]*)?(["'])([^"'\\r\\n]+)\\1`, 'gm');
    const matches = [...gradle.matchAll(pattern)];
    if (matches.length !== 1) throw new Error(`Could not uniquely read ${property} in ${gradlePath}; use one literal Gradle value.`);
    return matches[0][2];
  };
  const namespace = readGradleProperty('namespace');
  if (namespace !== activityPackage) throw new Error(`Gradle namespace ${namespace} does not match MainActivity package ${activityPackage}; manual inspection is required.`);
  const language = activity.path.endsWith('.kt') ? 'kotlin' : 'java';
  const expectedActivityPath = `android/app/src/main/${language}/${namespace.replace(/\./g, '/')}/MainActivity.${language === 'kotlin' ? 'kt' : 'java'}`;
  if (activity.path !== expectedActivityPath) throw new Error(`MainActivity path does not match the preserved namespace ${namespace}; manual inspection is required.`);
  const resolvedActivity = manifest.activityName.startsWith('.') ? `${namespace}${manifest.activityName}`
    : manifest.activityName.includes('.') ? manifest.activityName : `${namespace}.${manifest.activityName}`;
  if (resolvedActivity !== `${activityPackage}.MainActivity`) throw new Error('The manifest launcher does not resolve to the existing MainActivity; manual inspection is required.');
  if (manifest.manifestPackage && manifest.manifestPackage !== namespace) throw new Error('A legacy manifest package requires manual inspection.');
  const applicationIdPattern = new RegExp(`^([ \\t]*applicationId[ \\t]*(?:=[ \\t]*|[ \\t]+|\\([ \\t]*))(["'])([^\\r\\n]*?)\\2([ \\t]*\\)?[ \\t]*(?://.*)?$)`, 'gm');
  let applicationIdCount = 0;
  const updatedGradle = gradle.replace(applicationIdPattern, (_match, prefix, quote, _value, suffix) => {
    applicationIdCount++;
    return `${prefix}${quote}${applicationId}${quote}${suffix}`;
  });
  if (applicationIdCount !== 1) throw new Error(`Could not uniquely update applicationId (${applicationIdCount} matches) in ${gradlePath}; use one literal Gradle value.`);
  const updates = new Map();
  if (updatedGradle !== gradle) updates.set(gradlePath, updatedGradle);
  return { updates, targetPath: activity.path, oldPackage: activityPackage, namespace, applicationId, qualifiedName: `${activityPackage}.MainActivity`, needsFix: updates.size > 0 };
}

function parseUpdatePackages(text) {
  const packages = [...new Set(text.split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
  if (!packages.length) throw new Error('Enter at least one Android package.');
  if (packages.length > 20) throw new Error('Select at most 20 packages per update batch.');
  for (const packageName of packages) {
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageName)) {
      throw new Error(`Invalid Android package: ${packageName}`);
    }
  }
  return packages;
}

function resolveUpdateLauncher(namespace, activityName, sources) {
  if (!namespace || !activityName) throw new Error('A literal namespace and a launcher activity are required.');
  const candidates = sources.map(source => {
    const packageName = source.content.match(/^\s*package\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[ \t]*;?[ \t]*$/m)?.[1];
    if (!packageName || !/^[ \t]*(?:(?:public|open|final|internal)\s+)*class\s+MainActivity\b/m.test(source.content)) {
      throw new Error(`Could not identify MainActivity in ${source.path}.`);
    }
    return { ...source, qualifiedName: `${packageName}.MainActivity` };
  });
  const resolvedName = activityName.startsWith('.') ? namespace + activityName
    : activityName.includes('.') ? activityName : `${namespace}.${activityName}`;
  const matches = candidates.filter(candidate => candidate.qualifiedName === resolvedName);
  if (matches.length === 1) return { activityName, qualifiedName: resolvedName, needsFix: false };
  if (matches.length > 1 || candidates.length !== 1) throw new Error('MainActivity is missing or ambiguous; automatic repair is blocked.');
  if (!/^(?:[A-Za-z_]\w*\.)*MainActivity$/.test(activityName.replace(/^\./, ''))) {
    throw new Error(`Unsupported launcher activity: ${activityName}`);
  }
  return { activityName, qualifiedName: candidates[0].qualifiedName, needsFix: true };
}

async function updateGitHubRequest(token, repo, path, method = 'GET', payload) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    method,
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || `GitHub request failed (${response.status}): ${repo}/${path}`), { status: response.status });
  return data;
}

async function inspectExistingFlutterUpdate(token, repo, packageName) {
  const branch = packageName;
  const ref = await updateGitHubRequest(token, repo, `git/ref/heads/${encodeURIComponent(branch)}`);
  const headSha = ref.object.sha;
  const tree = await updateGitHubRequest(token, repo, `git/trees/${headSha}?recursive=1`);
  if (tree.truncated) throw new Error('The repository tree is truncated; inspection is blocked.');
  const blobs = (tree.tree || []).filter(entry => entry.type === 'blob');
  const paths = new Set(blobs.map(entry => entry.path));
  const read = async (path) => {
    const entry = blobs.find(blob => blob.path === path);
    if (!entry) throw new Error(`Missing file: ${path}`);
    const blob = await updateGitHubRequest(token, repo, `git/blobs/${entry.sha}`);
    return new TextDecoder().decode(Uint8Array.from(atob(blob.content.replace(/\s/g, '')), char => char.charCodeAt(0)));
  };
  const gradlePath = ['android/app/build.gradle.kts', 'android/app/build.gradle'].find(path => paths.has(path));
  if (!paths.has('pubspec.yaml') || !gradlePath) throw new Error('Only existing Flutter Android branches are supported.');
  const gradle = await read(gradlePath);
  if (/\b(?:productFlavors|sourceSets|applicationIdSuffix)\b/.test(gradle)) throw new Error('Custom source sets or flavors require manual inspection.');
  const property = (name) => {
    const matches = [...gradle.matchAll(new RegExp(`^[ \\t]*${name}[ \\t]*(?:=[ \\t]*|\\([ \\t]*)?["']([^"'\\r\\n]+)["']`, 'gm'))];
    if (matches.length !== 1) throw new Error(`Expected exactly one literal ${name} in ${gradlePath}.`);
    return matches[0][1];
  };
  const applicationId = property('applicationId');
  if (applicationId !== packageName) throw new Error(`Package mismatch: Gradle declares ${applicationId}.`);
  const namespace = property('namespace');
  const manifestPath = 'android/app/src/main/AndroidManifest.xml';
  const manifest = await read(manifestPath);
  const manifestInfo = parseAndroidLauncherManifest(manifest);
  const sourcePaths = getAndroidMainSourcePaths(paths);
  const sources = await Promise.all(sourcePaths.map(async path => ({ path, content: await read(path) })));
  const alignment = planFlutterPackageAlignment(packageName, gradlePath, gradle, sources, manifestInfo, paths);
  const launcher = { activityName: manifestInfo.activityName, qualifiedName: alignment.qualifiedName, needsFix: alignment.needsFix };
  for (const path of paths) {
    if (!/^android\/app\/src\/.*\/AndroidManifest\.xml$/.test(path) || path === manifestPath) continue;
    validateAndroidLauncherOverlay(await read(path), path);
  }
  const secrets = await updateGitHubRequest(token, repo, 'actions/secrets?per_page=100');
  const available = new Set((secrets.secrets || []).map(secret => secret.name));
  const missing = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'ANDROID_STORE_PASSWORD', 'PLAY_STORE_JSON_KEY'].filter(name => !available.has(name));
  if (missing.length) throw new Error(`Missing Actions secrets: ${missing.join(', ')}`);
  return { repo, packageName, branch, headSha, launcher, alignment, namespace };
}

async function findExistingFlutterUpdates(token, packages, logFn) {
  const repos = [];
  for (let page = 1; ; page++) {
    const response = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=full_name&affiliation=owner,collaborator,organization_member`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
    });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data)) throw new Error(data.message || 'Could not list accessible repositories.');
    repos.push(...data);
    if (data.length < 100) break;
    if (page >= 20) throw new Error('Repository discovery is incomplete; narrow GitHub token access before retrying.');
  }
  const matches = new Map(packages.map(packageName => [packageName, []]));
  for (let index = 0; index < repos.length; index += 4) {
    await Promise.all(repos.slice(index, index + 4).map(async repo => {
      for (const packageName of packages) {
        try {
          await updateGitHubRequest(token, repo.full_name, `git/ref/heads/${encodeURIComponent(packageName)}`);
          matches.get(packageName).push(repo);
        } catch (error) {
          if (error.status === 409 && /^Git Repository is empty\.?$/i.test(error.message.trim())) {
            logFn(`Skipping empty repository: ${repo.full_name}`, 'log-info');
            break;
          }
          if (error.status !== 404) throw error;
        }
      }
    }));
    logFn(`Repositories checked: ${Math.min(index + 4, repos.length)}/${repos.length}`, 'log-info');
  }
  const rows = [];
  for (const packageName of packages) {
    const candidates = matches.get(packageName);
    const row = { packageName, selected: false, ready: false, status: 'Blocked' };
    try {
      if (!candidates.length) throw new Error('No accessible branch with this package name was found.');
      if (candidates.length !== 1) throw new Error(`Ambiguous repositories: ${candidates.map(repo => repo.full_name).join(', ')}`);
      row.repo = candidates[0].full_name;
      row.defaultBranch = candidates[0].default_branch;
      if (candidates[0].archived || !candidates[0].permissions?.push) throw new Error('Write access to an active repository is required.');
      Object.assign(row, await inspectExistingFlutterUpdate(token, row.repo, packageName));
      row.ready = true;
      row.selected = true;
      row.status = row.launcher.needsFix ? 'MainActivity correction required' : 'Ready';
    } catch (error) { row.error = error.message; }
    rows.push(row);
  }
  return rows;
}

async function commitFlutterPackageAlignment(token, item) {
  const base = await updateGitHubRequest(token, item.repo, `git/commits/${item.headSha}`);
  const changes = [];
  for (const [path, content] of item.alignment.updates) {
    const sha = content === null ? null : (await updateGitHubRequest(token, item.repo, 'git/blobs', 'POST', {
      content: btoa(unescape(encodeURIComponent(content))), encoding: 'base64'
    })).sha;
    changes.push({ path, mode: '100644', type: 'blob', sha });
  }
  const tree = await updateGitHubRequest(token, item.repo, 'git/trees', 'POST', { base_tree: base.tree.sha, tree: changes });
  const commit = await updateGitHubRequest(token, item.repo, 'git/commits', 'POST', {
    message: 'Align Flutter Android launcher package', tree: tree.sha, parents: [item.headSha]
  });
  const refPath = `git/refs/heads/${encodeURIComponent(item.branch)}`;
  const current = await updateGitHubRequest(token, item.repo, refPath);
  if (current.object.sha !== item.headSha) throw new Error('The branch changed during package alignment; no branch files were replaced.');
  await updateGitHubRequest(token, item.repo, refPath, 'PATCH', { sha: commit.sha, force: false });
  return commit.sha;
}

async function prepareExistingFlutterUpdate(token, item, logFn) {
  const current = await inspectExistingFlutterUpdate(token, item.repo, item.packageName);
  if (current.headSha !== item.headSha) throw new Error('The branch changed after inspection. Analyze the packages again.');
  if (current.launcher.needsFix) {
    logFn(`Aligning namespace, source package and launcher: ${current.launcher.qualifiedName}`, 'log-info');
    await commitFlutterPackageAlignment(token, { ...current, repo: item.repo, branch: item.branch });
  }
  const defaultBranch = await ensureFlutterBuildWorkflow(token, item.repo, true);
  if (item.branch !== defaultBranch) await ensureFlutterBuildWorkflow(token, item.repo, true, item.branch);
  const verified = await inspectExistingFlutterUpdate(token, item.repo, item.packageName);
  if (verified.launcher.needsFix) throw new Error('Launcher verification failed; no build was started.');
  return verified;
}

function initializeExistingAppUpdates() {
  const input = document.getElementById('updatePackages');
  const analyzeButton = document.getElementById('analyzeUpdatesBtn');
  const launchButton = document.getElementById('launchUpdatesBtn');
  const stopButton = document.getElementById('stopUpdatesBtn');
  const approval = document.getElementById('approveUpdates');
  const results = document.getElementById('updateResults');
  const tokenInput = document.getElementById('ghToken');
  let rows = [];
  let busy = false;
  let stopRequested = false;
  let inspectedToken = '';
  let phase = 'select';
  const log = (message, className = 'log-info') => {
    const entry = document.createElement('div');
    entry.className = `log-entry ${className}`;
    entry.textContent = message;
    const container = document.getElementById('updatesLog');
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
    const notice = document.getElementById('updatesNotice');
    notice.textContent = message;
    notice.className = className;
  };
  const controls = () => {
    input.disabled = busy;
    analyzeButton.disabled = busy;
    approval.disabled = busy || !rows.some(row => row.ready && row.selected);
    launchButton.disabled = busy || !approval.checked || !rows.some(row => row.ready && row.selected);
    stopButton.hidden = !busy || !rows.length;
    document.getElementById('updateConfirmation').hidden = !rows.some(row => row.ready) && !(busy && phase === 'launch');
    for (const [name, id] of [['select', 'updateSelectStep'], ['verify', 'updateVerifyStep'], ['launch', 'updateLaunchStep']]) {
      const step = document.getElementById(id);
      if (phase === name) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    }
    const selectedCount = rows.filter(row => row.ready && row.selected).length;
    const blockedCount = rows.filter(row => row.error).length;
    document.getElementById('updateReviewSummary').textContent = rows.length
      ? `${selectedCount} selected / ${rows.length} app${rows.length === 1 ? '' : 's'}${blockedCount ? ` | ${blockedCount} blocked` : ''}` : '';
  };
  const render = () => {
    results.replaceChildren();
    for (const row of rows) {
      const container = document.createElement('div');
      container.className = 'update-result';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = row.selected;
      checkbox.disabled = busy || !row.ready;
      checkbox.setAttribute('aria-label', `Select ${row.packageName}`);
      checkbox.addEventListener('change', () => { row.selected = checkbox.checked; approval.checked = false; controls(); });
      const content = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = row.packageName;
      content.appendChild(title);
      if (row.repo) {
        const link = document.createElement('a');
        link.href = `https://github.com/${row.repo}/tree/${encodeURIComponent(row.packageName)}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = `${row.repo} / ${row.packageName}`;
        content.appendChild(link);
      }
      const detail = document.createElement('div');
      detail.className = `update-detail ${row.error ? 'log-error' : ''}`;
      detail.textContent = row.error || (row.launcher?.needsFix
        ? `Android namespace preserved: ${row.alignment.namespace}\nPlay applicationId: ${row.alignment.applicationId}\nChanges: ${[...row.alignment.updates.keys()].join(', ')}`
        : row.launcher ? `MainActivity: ${row.launcher.qualifiedName}` : '');
      if (!row.error && row.defaultBranch) detail.textContent += `\nWorkflow branches: ${[...new Set([row.defaultBranch, row.branch])].join(', ')}`;
      const status = document.createElement('div');
      status.className = `update-detail ${row.error ? 'log-error' : busy || row.launcher?.needsFix ? 'log-info' : 'log-success'}`;
      status.textContent = `${row.status}${row.ready ? ' | beta draft | versionCode +1' : ''}`;
      content.appendChild(status);
      if (row.error) content.appendChild(detail);
      else {
        const technical = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Technical details';
        technical.append(summary, detail);
        content.appendChild(technical);
      }
      container.append(checkbox, content);
      results.appendChild(container);
    }
    controls();
  };
  const invalidate = () => {
    if (busy) return;
    rows = [];
    inspectedToken = '';
    phase = 'select';
    approval.checked = false;
    document.getElementById('updatesNotice').textContent = '';
    render();
  };
  input.addEventListener('input', invalidate);
  tokenInput.addEventListener('input', invalidate);
  approval.addEventListener('change', controls);
  chrome.storage.local.get(['updatePackages'], saved => { if (!input.value && saved.updatePackages) input.value = saved.updatePackages; });
  stopButton.addEventListener('click', () => { stopRequested = true; stopButton.disabled = true; log('Queue stop requested; the current GitHub run is not cancelled.'); });
  analyzeButton.addEventListener('click', async () => {
    document.getElementById('updatesLog').replaceChildren();
    rows = [];
    approval.checked = false;
    busy = true;
    phase = 'verify';
    render();
    try {
      const token = tokenInput.value.trim();
      if (!token) throw new Error('Enter a GitHub token in the build settings.');
      const packages = parseUpdatePackages(input.value);
      chrome.storage.local.set({ updatePackages: input.value });
      log('Searching accessible repositories.');
      rows = await findExistingFlutterUpdates(token, packages, log);
      inspectedToken = token;
      log(`Analysis complete: ${rows.filter(row => row.ready).length}/${rows.length} eligible apps.`);
    } catch (error) { log(error.message, 'log-error'); }
    finally { busy = false; if (!rows.length) phase = 'select'; render(); }
  });
  launchButton.addEventListener('click', async () => {
    if (busy || !approval.checked) return;
    const token = tokenInput.value.trim();
    if (token !== inspectedToken) { invalidate(); log('GitHub credentials changed. Analyze packages again.', 'log-error'); return; }
    const selected = rows.filter(row => row.ready && row.selected);
    if (!selected.length) return;
    busy = true;
    phase = 'launch';
    stopRequested = false;
    stopButton.disabled = false;
    render();
    try {
      for (const item of selected) {
        if (stopRequested) break;
        item.status = 'Verifying and preparing branch';
        render();
        try {
          const verified = await prepareExistingFlutterUpdate(token, item, message => log(`[${item.packageName}] ${message}`));
          item.launcher = verified.launcher;
          item.alignment = verified.alignment;
          if (stopRequested) { item.ready = false; item.selected = false; item.status = 'Prepared; build not started'; render(); break; }
          item.status = 'Build and beta draft upload running';
          render();
          const success = await triggerAndWait(token, item.repo, 'flutter-build.yml', item.branch, {
            publish_to_play: 'true', upload_listing: 'false', track: 'beta', request_id: `update-${crypto.randomUUID()}`, source_commit: verified.headSha
          }, item.packageName, log);
          item.status = success ? 'AAB uploaded to open testing as a draft' : 'Workflow failed or could not be confirmed; check GitHub Actions';
          if (!success) item.error = item.status;
        } catch (error) { item.error = error.message; item.status = 'Blocked'; log(`[${item.packageName}] ${error.message}`, 'log-error'); }
        item.ready = false;
        item.selected = false;
        render();
      }
      log(stopRequested ? 'Queue stopped.' : 'Update batch finished.');
    } finally { busy = false; approval.checked = false; render(); }
  });
  controls();
}

async function inspectProjectForVariant(token, repo, ref) {
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json'
  };
  const treeResponse = await fetch(
    `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { headers }
  );
  if (!treeResponse.ok) throw new Error(`Could not read project tree (${treeResponse.status})`);
  const treeData = await treeResponse.json();
  const paths = (treeData.tree || []).filter(item => item.type === 'blob').map(item => item.path);
  const pathSet = new Set(paths);
  const readFile = async (path) => {
    const fileUrl = `https://api.github.com/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`;
    const response = await fetch(fileUrl, { headers });
    if (!response.ok) return '';
    const file = await response.json();
    if (!file.content) return '';
    const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };

  const pubspecPath = pathSet.has('pubspec.yaml') ? 'pubspec.yaml' : null;
  const gradlePath = ['app/build.gradle.kts', 'app/build.gradle'].find(path => pathSet.has(path));
  const dartPaths = paths.filter(path => /^lib\/.*\.dart$/i.test(path));
  const themeCandidates = dartPaths.filter(path => /(theme|color|style|app)/i.test(path));
  const iconCandidates = paths.filter(path => /\.(png|jpe?g|webp)$/i.test(path) && /(icon|logo|launcher|assets\/images)/i.test(path));
  const androidIconCandidates = paths.filter(path => /^android\/app\/src\/main\/res\/mipmap[^/]*\/ic_launcher\.(png|webp)$/i.test(path));
  const colorFile = 'app/src/main/java/com/bingetvapp/bingetvtrailers/ui/theme/Color.kt';
  const report = [];
  let projectType = 'unknown';
  let safeForVariantWorkflow = false;

  if (pubspecPath && paths.some(path => path.startsWith('lib/')) && paths.some(path => path.startsWith('android/'))) {
    projectType = 'flutter';
    const pubspec = await readFile(pubspecPath);
    const packageName = pubspec.match(/^name:\s*['"]?([^\s'"]+)/m)?.[1] || 'not found';
    const iconConfigLines = pubspec.split(/\r?\n/).filter(line => /flutter_launcher_icons|image_path|adaptive_icon|android:|ios:/.test(line));
    const dartFiles = [...themeCandidates, ...dartPaths.filter(path => !themeCandidates.includes(path))].slice(0, 40);
    const dartContents = await Promise.all(dartFiles.map(async path => ({ path, text: await readFile(path) })));
    const themeDetails = dartContents.map(({ path, text }) => {
      const markers = [...new Set((text.match(/ThemeData|ColorScheme(?:\.fromSeed)?|primarySwatch|primaryColor|colorScheme/g) || []))];
      const colors = [...new Set((text.match(/#[0-9a-fA-F]{6,8}|0x[0-9a-fA-F]{6,8}/g) || []))].slice(0, 6);
      return markers.length || colors.length ? `${path}: ${[...markers, ...colors].join(', ')}` : null;
    }).filter(Boolean);
    const detectedThemeFiles = dartContents
      .filter(({ text }) => /ThemeData|ColorScheme|primarySwatch|primaryColor|colorScheme/.test(text))
      .map(({ path }) => path);
    const androidGradlePath = ['android/app/build.gradle', 'android/app/build.gradle.kts'].find(path => pathSet.has(path));
    const androidGradle = androidGradlePath ? await readFile(androidGradlePath) : '';
    const applicationId = androidGradle.match(/applicationId\s*(?:=\s*)?["']([^"']+)["']/)?.[1] || 'not found';
    report.push(`Project type: Flutter`);
    report.push(`Dart package name: ${packageName}`);
    report.push(`Android applicationId: ${applicationId}`);
    report.push(`Icon config: ${iconConfigLines.length ? iconConfigLines.join(' | ').trim() : 'no flutter_launcher_icons config found'}`);
    report.push(`Icon assets: ${iconCandidates.slice(0, 12).join(', ') || 'none found by filename'}`);
    report.push(`Android launcher icons: ${androidIconCandidates.slice(0, 8).join(', ') || 'none found'}`);
    report.push(`Theme candidates: ${[...new Set([...themeCandidates, ...detectedThemeFiles])].slice(0, 12).join(', ') || 'none found'}`);
    report.push(`Theme details: ${themeDetails.join(' | ') || 'no ThemeData/ColorScheme values found in sampled files'}`);
    report.push(`Dart files sampled: ${dartFiles.length}/${dartPaths.length}`);
    report.push(`Tree truncated: ${treeData.truncated ? 'yes; inspect may be incomplete' : 'no'}`);
  } else if (gradlePath) {
    projectType = 'android-native';
    const gradle = await readFile(gradlePath);
    const applicationId = gradle.match(/applicationId\s*(?:=\s*)?["']([^"']+)["']/)?.[1] || 'not found';
    safeForVariantWorkflow = pathSet.has(colorFile);
    report.push('Project type: Native Android (Gradle)');
    report.push(`Gradle file: ${gradlePath}`);
    report.push(`Current applicationId: ${applicationId}`);
    report.push(`Variant workflow theme file: ${pathSet.has(colorFile) ? 'found' : `missing (${colorFile})`}`);
    report.push(`Launcher icon files: ${androidIconCandidates.slice(0, 8).join(', ') || 'none found'}`);
    report.push(`Tree truncated: ${treeData.truncated ? 'yes; inspect may be incomplete' : 'no'}`);
  } else {
    report.push('Project type: Unknown / unsupported');
    report.push('Could not find pubspec.yaml or app Gradle file at repository root.');
    report.push(`Tree truncated: ${treeData.truncated ? 'yes; inspect may be incomplete' : 'no'}`);
  }

  return { projectType, safeForVariantWorkflow, report };
}

async function showProjectInspection(token, repo, ref) {
  const output = document.getElementById('projectInspection');
  output.style.display = 'block';
  output.textContent = 'Inspecting repository files...';
  const inspection = await inspectProjectForVariant(token, repo, ref);
  output.textContent = inspection.report.join('\n');
  return inspection;
}

async function ensureFlutterBuildWorkflow(token, repo, publishToPlay = false, targetBranch = null) {
  const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
  const repoResponse = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  const repoInfo = await repoResponse.json().catch(() => ({}));
  if (!repoResponse.ok) throw new Error(repoInfo.message || `Could not read repository settings (${repoResponse.status}).`);
  const defaultBranch = repoInfo.default_branch || 'main';
  const workflowBranch = targetBranch || defaultBranch;
  const secretResponse = await fetch(`https://api.github.com/repos/${repo}/actions/secrets?per_page=100`, { headers });
  const secretData = await secretResponse.json().catch(() => ({}));
  if (!secretResponse.ok) throw new Error(secretData.message || 'Could not verify Actions signing secrets.');
  const requiredSecrets = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'ANDROID_STORE_PASSWORD'];
  if (publishToPlay) requiredSecrets.push('PLAY_STORE_JSON_KEY');
  const availableSecrets = new Set((secretData.secrets || []).map(secret => secret.name));
  const missingSecrets = requiredSecrets.filter(name => !availableSecrets.has(name));
  if (missingSecrets.length) throw new Error(`Add these repository Actions secrets before building: ${missingSecrets.join(', ')}.`);

  const workflowPath = '.github/workflows/flutter-build.yml';
  const workflowUrl = `https://api.github.com/repos/${repo}/contents/${workflowPath}?ref=${encodeURIComponent(workflowBranch)}`;
  const existing = await fetch(workflowUrl, { headers });
  let existingFile = null;
  if (existing.ok) existingFile = await existing.json();
  else if (existing.status !== 404) {
    const error = await existing.json().catch(() => ({}));
    throw new Error(error.message || `Could not verify Flutter workflow (${existing.status}).`);
  }

  const workflow = [
    'name: Build Flutter Android AAB',
    'run-name: Flutter AAB ${{ inputs.request_id || github.ref_name }}',
    '',
    'on:',
    '  workflow_dispatch:',
    '    inputs:',
    '      publish_to_play:',
    "        description: 'Upload listing and AAB to Google Play as a draft'",
    '        required: false',
    '        default: false',
    '        type: boolean',
    '      upload_listing:',
    "        description: 'Update listing text and images together with the AAB'",
    '        required: false',
    '        default: true',
    '        type: boolean',
    '      request_id:',
    "        description: 'Optional identifier for tracking this build'",
    '        required: false',
    "        default: ''",
    '        type: string',
    '      source_commit:',
    "        description: 'Optional inspected commit to build'",
    '        required: false',
    "        default: ''",
    '        type: string',
    '      track:',
    "        description: 'Google Play draft track'",
    '        required: false',
    "        default: 'internal'",
    '        type: choice',
    '        options:',
    '          - internal',
    '          - alpha',
    '          - beta',
    '          - production',
    '',
    'permissions:',
    '  contents: write',
    '  actions: read',
    '',
    'concurrency:',
    '  group: android-build-${{ github.repository }}-${{ github.ref }}',
    '  cancel-in-progress: false',
    '',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Checkout source',
    '        uses: actions/checkout@v4',
    '        with:',
    '          ref: ${{ inputs.source_commit || github.ref }}',
    '      - name: Validate Android launcher package',
    '        run: |',
    '          python3 - <<\'PY\'',
    '          import re',
    '          import xml.etree.ElementTree as ET',
    '          from pathlib import Path',
    '          root = Path("android/app")',
    '          gradle = next(path for path in (root / "build.gradle.kts", root / "build.gradle") if path.is_file()).read_text()',
    '          if re.search(r"\\b(productFlavors|sourceSets|applicationIdSuffix)\\b", gradle): raise SystemExit("Custom Android variants require launcher validation adapted to their source sets")',
    '          def literal(name):',
    '              values = re.findall(r\'(?m)^[ \\t]*\' + name + r\'[ \\t]*(?:=[ \\t]*|\\([ \\t]*)?["\\\']([^"\\\'\\r\\n]+)["\\\']\', gradle)',
    '              if len(values) != 1: raise SystemExit(f"Expected one literal {name} in Gradle")',
    '              return values[0]',
    '          package = literal("applicationId")',
    '          namespace = literal("namespace")',
    '          android_name = "{http://schemas.android.com/apk/res/android}name"',
    '          manifest = ET.parse(root / "src/main/AndroidManifest.xml").getroot()',
    '          launchers = [activity for activity in manifest.findall("./application/activity") if any(any(action.get(android_name) == "android.intent.action.MAIN" for action in intent.findall("action")) and any(category.get(android_name) == "android.intent.category.LAUNCHER" for category in intent.findall("category")) for intent in activity.findall("intent-filter"))]',
    '          if len(launchers) != 1 or manifest.findall("./application/activity-alias"): raise SystemExit("A single launcher activity is required")',
    '          name = launchers[0].get(android_name, "")',
    '          resolved = namespace + name if name.startswith(".") else name if "." in name else namespace + "." + name',
    '          if resolved != namespace + ".MainActivity": raise SystemExit("Launcher name does not match the Android namespace")',
    '          candidates = [path for folder in (root / "src/main/kotlin", root / "src/main/java") for path in folder.rglob("MainActivity.*") if path.suffix in {".kt", ".java"}]',
    '          if len(candidates) != 1: raise SystemExit("MainActivity is missing or ambiguous")',
    '          source = candidates[0].read_text()',
    '          declared = re.search(r"(?m)^[ \\t]*package[ \\t]+([\\w.]+)[ \\t]*;?[ \\t]*$", source)',
    '          if not declared or declared.group(1) != namespace: raise SystemExit("MainActivity source package does not match namespace")',
    '          if not re.search(r"(?m)^[ \\t]*(?:(?:public|open|final|internal)\\s+)*class\\s+MainActivity\\b", source): raise SystemExit("MainActivity is not a concrete declared class")',
    '          language = "kotlin" if candidates[0].suffix == ".kt" else "java"',
    '          if candidates[0] != root / "src/main" / language / Path(namespace.replace(".", "/")) / candidates[0].name: raise SystemExit("MainActivity folder does not match its package")',
    '          for overlay in (root / "src").glob("*/AndroidManifest.xml"):',
    '              if overlay.parent.name == "main": continue',
    '              overlay_root = ET.parse(overlay).getroot()',
    '              for tag in ("activity", "activity-alias"): ',
    '                  for component in overlay_root.findall("./application/" + tag):',
    '                      for intent in component.findall("intent-filter"): ',
    '                          actions = {action.get(android_name) for action in intent.findall("action")}',
    '                          categories = {category.get(android_name) for category in intent.findall("category")}',
    '                          if "android.intent.action.MAIN" in actions and "android.intent.category.LAUNCHER" in categories: raise SystemExit(f"Build-specific launcher override requires manual inspection: {overlay}")',
    '          print(f"Verified Android launcher: {resolved}")',
    '          PY',
    '      - name: Validate Android signing secrets',
    '        env:',
    '          ANDROID_KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}',
    '          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}',
    '          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}',
    '          ANDROID_STORE_PASSWORD: ${{ secrets.ANDROID_STORE_PASSWORD }}',
    '        run: |',
    '          set -euo pipefail',
    '          for name in ANDROID_KEYSTORE_BASE64 ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD ANDROID_STORE_PASSWORD; do',
    '            if [ -z "${!name}" ]; then echo "Missing required signing secret: $name"; exit 1; fi',
    '          done',
    '      - name: Set up Java 17',
    '        uses: actions/setup-java@v4',
    '        with:',
    '          distribution: temurin',
    "          java-version: '17'",
    '      - name: Set up Flutter',
    '        uses: subosito/flutter-action@v2',
    '        with:',
    '          channel: stable',
    '          cache: true',
    '      - name: Set up Android SDK',
    '        uses: android-actions/setup-android@v3',
    '        with:',
    '          packages: platform-tools',
    '          accept-android-sdk-licenses: true',
    '      - name: Prepare signing configuration',
    '        env:',
    '          ANDROID_KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}',
    '          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}',
    '          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}',
    '          ANDROID_STORE_PASSWORD: ${{ secrets.ANDROID_STORE_PASSWORD }}',
    '        run: |',
    '          set -euo pipefail',
    '          printf "%s" "$ANDROID_KEYSTORE_BASE64" | base64 --decode > android/upload-keystore.jks',
    '          cp android/upload-keystore.jks android/app/upload-keystore.jks',
    '          cat > android/key.properties <<EOF',
    '          storePassword=$ANDROID_STORE_PASSWORD',
    '          keyPassword=$ANDROID_KEY_PASSWORD',
    '          keyAlias=$ANDROID_KEY_ALIAS',
    '          storeFile=upload-keystore.jks',
    '          EOF',
    '          chmod 600 android/key.properties android/upload-keystore.jks android/app/upload-keystore.jks',
    '      - name: Resolve Flutter dependencies',
    '        run: flutter pub get',
    '      - name: Generate Android launcher icons',
    '        run: dart run flutter_launcher_icons',
    '      - name: Reserve next Android versionCode',
    '        uses: actions/github-script@v7',
    '        with:',
    '          script: |',
    '            if (!context.ref.startsWith("refs/heads/")) throw new Error("Build a branch, not a tag.");',
    '            const branch = context.ref.slice("refs/heads/".length);',
    '            const path = ".github/android-version-code.txt";',
    '            const readFile = async (filePath) => {',
    '              try {',
    '                const response = await github.rest.repos.getContent({ ...context.repo, path: filePath, ref: branch });',
    '                if (Array.isArray(response.data) || response.data.type !== "file") throw new Error(`Expected a file: ${filePath}`);',
    '                return response.data;',
    '              } catch (error) {',
    '                if (error.status === 404) return null;',
    '                throw error;',
    '              }',
    '            };',
    '            const counter = await readFile(path);',
    '            let previous;',
    '            if (counter) {',
    '              const value = Buffer.from(counter.content, "base64").toString("utf8").trim();',
    '              if (!/^\\d+$/.test(value)) throw new Error("Invalid Android version counter.");',
    '              previous = Number(value);',
    '            } else {',
    '              const pubspec = await readFile("pubspec.yaml");',
    '              if (!pubspec) throw new Error("Missing pubspec.yaml.");',
    '              const version = Buffer.from(pubspec.content, "base64").toString("utf8").match(/^version:\\s*\\S+\\+(\\d+)\\s*$/m);',
    '              if (!version) throw new Error("Set a numeric build suffix in pubspec.yaml, for example version: 1.0.0+1.");',
    '              previous = Number(version[1]);',
    '              const runs = await github.paginate(github.rest.actions.listWorkflowRuns, { ...context.repo, workflow_id: "flutter-build.yml", branch, per_page: 100 });',
    '              for (const run of runs) {',
    '                if (run.id !== context.runId) previous = Math.max(previous, run.run_number);',
    '              }',
    '            }',
    '            if (!Number.isSafeInteger(previous) || previous < 0 || previous >= 2100000000) throw new Error("Android versionCode is outside the allowed range.");',
    '            const next = previous + 1;',
    '            await github.rest.repos.createOrUpdateFileContents({',
    '              ...context.repo, path, branch,',
    '              message: `Reserve Android versionCode ${next} [skip ci]`,',
    '              content: Buffer.from(`${next}\\n`).toString("base64"),',
    '              ...(counter ? { sha: counter.sha } : {})',
    '            });',
    '            core.exportVariable("BUILD_NUMBER", String(next));',
    '            core.info(`Reserved Android versionCode ${next}`);',
    '      - name: Build signed Android App Bundle',
    '        run: flutter build appbundle --release --build-number "$BUILD_NUMBER"',
    '      - name: Prepare Play phone screenshots from docs/screens',
    '        if: ${{ inputs.upload_listing != false }}',
    '        env:',
    '          PUBLISH_TO_PLAY: ${{ inputs.publish_to_play }}',
    '        run: |',
    '          set -euo pipefail',
    '          SCREENSHOT_DIR=fastlane/metadata/android/en-US/images/phoneScreenshots',
    '          mkdir -p "$SCREENSHOT_DIR"',
    '          count_images() { find "$1" -maxdepth 1 -type f \\( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" \\) | wc -l; }',
    '          if [ "$(count_images "$SCREENSHOT_DIR")" -lt 2 ]; then',
    '            mapfile -t DOC_SCREENSHOTS < <(find docs/screens -maxdepth 1 -type f \\( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" \\) -print 2>/dev/null | sort | head -n 8)',
    '            if [ "${#DOC_SCREENSHOTS[@]}" -ge 2 ]; then',
    '              find "$SCREENSHOT_DIR" -maxdepth 1 -type f \\( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" \\) -delete',
    '              for index in "${!DOC_SCREENSHOTS[@]}"; do',
    '                extension="${DOC_SCREENSHOTS[$index]##*.}"',
    '                cp "${DOC_SCREENSHOTS[$index]}" "$SCREENSHOT_DIR/docs-$((index + 1)).$extension"',
    '              done',
    '            elif [ "$PUBLISH_TO_PLAY" = "true" ]; then',
    '              echo "Add at least 2 PNG/JPG screenshots to docs/screens or fastlane/metadata/android/en-US/images/phoneScreenshots."',
    '              exit 1',
    '            fi',
    '          fi',
    '      - name: Verify Play phone screenshots',
    '        if: ${{ inputs.publish_to_play && inputs.upload_listing != false }}',
    '        run: |',
    '          python3 -m pip install --quiet pillow',
    '          python3 - <<\'PY\'',
    '          from pathlib import Path',
    '          from PIL import Image, ImageChops, ImageStat',
    '          files = sorted(Path("fastlane/metadata/android/en-US/images/phoneScreenshots").glob("*"))',
    '          files = [path for path in files if path.suffix.lower() in {".png", ".jpg", ".jpeg"}]',
    '          if len(files) < 2: raise SystemExit("At least two phone screenshots are required")',
    '          images = [Image.open(path).convert("RGB") for path in files]',
    '          if any(image.width < 320 or image.height < 320 or image.width > 3840 or image.height > 3840 for image in images):',
    '              raise SystemExit("A phone screenshot is outside the 320-3840 pixel Play range")',
    '          distinct = False',
    '          for index, first in enumerate(images):',
    '              for second in images[index + 1:]:',
    '                  if first.size != second.size: distinct = True; break',
    '                  width, height = first.size',
    '                  crop = (0, min(120, height // 8), width, max(height // 8, height - 120))',
    '                  difference = ImageStat.Stat(ImageChops.difference(first.crop(crop), second.crop(crop))).mean',
    '                  if sum(difference) / 3 > 2: distinct = True; break',
    '              if distinct: break',
    '          if not distinct: raise SystemExit("Phone screenshots are visually identical; provide distinct app screenshots in docs/screens or Play metadata")',
    '          print(f"Verified {len(images)} valid, distinct phone screenshots")',
    '          PY',
    '      - name: Prepare Play feature graphic from docs/featured.png',
    '        if: ${{ inputs.publish_to_play && inputs.upload_listing != false }}',
    '        run: |',
    '          set -euo pipefail',
    '          python3 - <<\'PY\'',
    '          from pathlib import Path',
    '          from PIL import Image',
    '          source = Path("docs/featured.png")',
    '          target = Path("fastlane/metadata/android/en-US/images/featureGraphic.png")',
    '          if not source.is_file(): raise SystemExit("Required feature graphic not found: docs/featured.png")',
    '          if source.stat().st_size > 15 * 1024 * 1024: raise SystemExit("Feature graphic exceeds Google Play 15 MB limit")',
    '          with Image.open(source) as image:',
    '              image_format = image.format',
    '              image_size = image.size',
    '              image.verify()',
    '          if image_format not in {"PNG", "JPEG"}: raise SystemExit("Feature graphic must be PNG or JPEG")',
    '          if image_size != (1024, 500): raise SystemExit(f"Feature graphic must be 1024x500 pixels; got {image_size[0]}x{image_size[1]}")',
    '          target.parent.mkdir(parents=True, exist_ok=True)',
    '          target.write_bytes(source.read_bytes())',
    '          print(f"Prepared feature graphic: {image_size[0]}x{image_size[1]}, {source.stat().st_size} bytes")',
    '          PY',
    '      - name: Upload AAB artifact',
    '        uses: actions/upload-artifact@v4',
    '        with:',
    '          name: flutter-android-aab-${{ github.run_number }}',
    '          path: build/app/outputs/bundle/release/app-release.aab',
    '          if-no-files-found: error',
    '          retention-days: 7',
    '      - name: Upload Play phone screenshots artifact',
    '        if: ${{ inputs.publish_to_play && inputs.upload_listing != false }}',
    '        uses: actions/upload-artifact@v4',
    '        with:',
    '          name: flutter-phone-screenshots-${{ github.run_number }}',
    '          path: fastlane/metadata/android/en-US/images/phoneScreenshots/*',
    '          if-no-files-found: error',
    '          retention-days: 7',
    '      - name: Publish listing and AAB to Play draft',
    '        if: ${{ inputs.publish_to_play }}',
    '        env:',
    '          PLAY_KEY: ${{ secrets.PLAY_STORE_JSON_KEY }}',
    '          PLAY_TRACK: ${{ inputs.track }}',
    '          UPLOAD_LISTING: ${{ inputs.upload_listing }}',
    '        run: |',
    '          set -euo pipefail',
    '          if [ -z "$PLAY_KEY" ]; then echo "Missing PLAY_STORE_JSON_KEY secret"; exit 1; fi',
    '          LISTING_ARGS=()',
    '          if [ "$UPLOAD_LISTING" = "false" ]; then',
    '            LISTING_ARGS=(--skip_upload_metadata true --skip_upload_images true --skip_upload_screenshots true)',
    '          else',
    '            SCREENSHOT_COUNT=$(find fastlane/metadata/android/en-US/images/phoneScreenshots -maxdepth 1 -type f \\( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" \\) 2>/dev/null | wc -l)',
    '            if [ "$SCREENSHOT_COUNT" -lt 2 ]; then echo "At least 2 phone screenshots are required"; exit 1; fi',
    '          fi',
    '          PACKAGE_NAME=$(python3 - <<\'PY\'',
    '          import re',
    '          from pathlib import Path',
    '          path = next(path for path in (Path("android/app/build.gradle.kts"), Path("android/app/build.gradle")) if path.is_file())',
    '          match = re.search(r\'(?m)^\\s*applicationId\\s*(?:=\\s*|\\(\\s*)?["\\\']([^"\\\']+)["\\\']\', path.read_text())',
    '          if not match: raise SystemExit("Could not read applicationId")',
    '          print(match.group(1))',
    '          PY',
    '          )',
    '          if [ -z "$PACKAGE_NAME" ]; then echo "Could not read applicationId"; exit 1; fi',
    '          sudo gem install fastlane --no-document',
    '          fastlane supply --json_key_data "$PLAY_KEY" --package_name "$PACKAGE_NAME" --aab build/app/outputs/bundle/release/app-release.aab --metadata_path fastlane/metadata/android --track "$PLAY_TRACK" --release_status draft --skip_upload_apk true --skip_upload_changelogs true "${LISTING_ARGS[@]}"',
    '      - name: Remove temporary signing files',
    '        if: always()',
    '        run: rm -f android/key.properties android/upload-keystore.jks android/app/upload-keystore.jks',
    ''
  ].join('\n');
  const putBody = {
    message: existingFile ? 'Reserve an incrementing Android versionCode for each build' : 'Add secure Flutter Android AAB workflow',
    content: btoa(unescape(encodeURIComponent(workflow))),
    branch: workflowBranch
  };
  if (existingFile) putBody.sha = existingFile.sha;
  const createResponse = await fetch(`https://api.github.com/repos/${repo}/contents/${workflowPath}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(putBody)
  });
  const createResult = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok) throw new Error(createResult.message || `Could not install Flutter workflow (${createResponse.status}).`);
  return workflowBranch;
}

function generateFlutterAppIcon(appName, primaryColor, accentColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create an app icon canvas.');

  const primary = primaryColor.match(/^#?[0-9a-fA-F]{6}$/) ? `#${primaryColor.replace(/^#/, '')}` : '#00695C';
  const accent = accentColor.match(/^#?[0-9a-fA-F]{6}$/) ? `#${accentColor.replace(/^#/, '')}` : '#FF8F00';
  context.fillStyle = primary;
  context.fillRect(0, 0, 512, 512);
  context.fillStyle = accent;
  context.globalAlpha = 0.2;
  context.beginPath();
  context.arc(512, 0, 330, 0, Math.PI * 2);
  context.fill();

  const initials = (appName || 'App').trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] || '').join('').toUpperCase();
  context.globalAlpha = 1;
  context.fillStyle = '#FFFFFF';
  context.font = '700 176px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(initials || 'A', 256, 256, 360);

  const dataUrl = canvas.toDataURL('image/png');
  appLogoBase64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const preview = document.getElementById('logoPreview');
  const previewImage = document.getElementById('logoPreviewImg');
  if (preview && previewImage) {
    previewImage.src = dataUrl;
    preview.style.display = 'block';
  }
  return appLogoBase64;
}

async function createFlutterVariant(token, repo, baseBranch, branch, options) {
  const androidPackagePattern = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
  if (!androidPackagePattern.test(options.applicationId)) {
    throw new Error('Android package must look like com.example.app and use lowercase letters, numbers or underscores.');
  }
  if (options.publishToPlay && !appLogoBase64) {
    throw new Error('Select a 512x512 app icon before uploading a Play Store listing.');
  }
  if ((options.screenshots || []).length > 8) throw new Error('Play Store accepts at most 8 phone screenshots per listing.');

  const hexToFlutterColor = (value, label) => {
    const match = value.trim().match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) throw new Error(`${label} must be a six-digit hex color, for example #00695C.`);
    return `0xFF${match[1].toUpperCase()}`;
  };
  const colors = {
    primary: hexToFlutterColor(options.primaryColor, 'Primary color'),
    secondary: hexToFlutterColor(options.secondaryColor, 'Dark/secondary color'),
    accent: hexToFlutterColor(options.accentColor, 'Accent color')
  };
  const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
  const api = async (path, method = 'GET', payload) => {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: payload ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: payload ? JSON.stringify(payload) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `${method} ${path} failed (${response.status})`);
    return data;
  };

  const variantRefPath = `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  const variantRefResponse = await fetch(`https://api.github.com${variantRefPath}`, { headers });
  let variantExists = variantRefResponse.ok;
  let variantRef = null;
  if (variantExists) variantRef = await variantRefResponse.json();
  if (!variantExists && variantRefResponse.status !== 404) {
    const error = await variantRefResponse.json().catch(() => ({}));
    throw new Error(error.message || `Could not inspect variant branch (${variantRefResponse.status}).`);
  }
  const sourceBranch = variantExists ? branch : baseBranch;
  const sourceRef = variantRef || await api(`/repos/${repo}/git/ref/heads/${encodeURIComponent(sourceBranch)}`);
  const sourceCommit = await api(`/repos/${repo}/git/commits/${sourceRef.object.sha}`);
  const treeData = await api(`/repos/${repo}/git/trees/${sourceCommit.tree.sha}?recursive=1`);
  if (treeData.truncated) throw new Error('Repository tree is too large to inspect safely.');
  const blobs = (treeData.tree || []).filter(entry => entry.type === 'blob');
  const paths = new Set(blobs.map(entry => entry.path));
  const gradlePath = ['android/app/build.gradle.kts', 'android/app/build.gradle'].find(path => paths.has(path));
  if (!paths.has('pubspec.yaml') || !gradlePath || !paths.has('lib/main.dart')) {
    throw new Error('Flutter project needs pubspec.yaml, lib/main.dart and android/app/build.gradle(.kts).');
  }

  // Standard convention for all Flutter projects: fall back to docs/screens when no screenshot was uploaded manually.
  const docsScreensFolder = 'docs/screens';
  const docsScreensEntries = (options.screenshots || []).length
    ? []
    : blobs
        .filter(entry => entry.path.startsWith(`${docsScreensFolder}/`) && /\.(png|jpe?g)$/i.test(entry.path))
        .sort((a, b) => a.path.localeCompare(b.path))
        .slice(0, 8);
  if (options.publishToPlay && !(options.screenshots || []).length && docsScreensEntries.length < 2) {
    throw new Error(`Add at least 2 PNG/JPG images to ${docsScreensFolder} or upload screenshots manually before uploading a Play Store listing.`);
  }

  const readBlobText = async (path) => {
    const entry = blobs.find(blob => blob.path === path);
    if (!entry) throw new Error(`Required file not found: ${path}`);
    const blob = await api(`/repos/${repo}/git/blobs/${entry.sha}`);
    const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, '')), char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };

  const gradle = await readBlobText(gradlePath);
  const androidSourcePaths = getAndroidMainSourcePaths(paths);
  const androidSources = await Promise.all(androidSourcePaths.map(async path => ({ path, content: await readBlobText(path) })));
  const manifestInfo = parseAndroidLauncherManifest(await readBlobText('android/app/src/main/AndroidManifest.xml'));
  const alignment = planFlutterPackageAlignment(options.applicationId, gradlePath, gradle, androidSources, manifestInfo, paths);
  for (const path of paths) {
    if (!/^android\/app\/src\/.*\/AndroidManifest\.xml$/.test(path) || path === 'android/app/src/main/AndroidManifest.xml') continue;
    validateAndroidLauncherOverlay(await readBlobText(path), path);
  }

  const pubspec = await readBlobText('pubspec.yaml');
  const dartPackageName = pubspec.match(/^name:\s*([a-z][a-z0-9_]*)\s*$/m)?.[1];
  if (!dartPackageName) throw new Error('Could not detect a valid Dart package name in pubspec.yaml.');
  const variantDartName = options.applicationId.split('.').pop().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, 'app_');
  let updatedPubspec = pubspec.replace(/^name:\s*[a-z][a-z0-9_]*\s*$/m, `name: ${variantDartName}`);
  const iconPathMatch = pubspec.match(/^\s*image_path:\s*["']?([^\s"'#]+)["']?\s*(?:#.*)?$/m);
  const iconPath = iconPathMatch?.[1];
  if (!iconPath || iconPath.startsWith('/') || iconPath.split('/').includes('..') || !paths.has(iconPath)) {
    throw new Error('Could not find a safe existing flutter_launcher_icons image_path in pubspec.yaml.');
  }
  const adaptiveBackground = `#${options.accentColor.trim().replace(/^#/, '').toUpperCase()}`;
  const setYamlValue = (source, key, value) => {
    const pattern = new RegExp(`^(\\s*)${key}:.*$`, 'm');
    const replacement = (_match, indentation) => `${indentation}${key}: ${value}`;
    if (pattern.test(source)) return source.replace(pattern, replacement);
    const imagePathLine = new RegExp(`^(\\s*)image_path:.*$`, 'm');
    if (!imagePathLine.test(source)) throw new Error(`Could not add ${key}: image_path was not found in pubspec.yaml.`);
    return source.replace(imagePathLine, (line, indentation) => `${line}\n${indentation}${key}: ${value}`);
  };
  updatedPubspec = setYamlValue(updatedPubspec, 'adaptive_icon_background', `"${adaptiveBackground}"`);
  updatedPubspec = setYamlValue(updatedPubspec, 'adaptive_icon_foreground', iconPath);

  const dartPaths = blobs.map(entry => entry.path).filter(path => /^lib\/.*\.dart$/i.test(path));
  const escapedDartPackageName = dartPackageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const packageImportPattern = new RegExp(`package:${escapedDartPackageName}/`, 'g');
  const dartContents = await Promise.all(dartPaths.map(async path => [
    path,
    (await readBlobText(path)).replace(packageImportPattern, `package:${variantDartName}/`)
  ]));
  const themeFiles = new Map(dartContents);
  const declaration = /((?:const|final)\s+)([A-Za-z_]\w*)\s*=\s*Color\(\s*0x[0-9a-fA-F]{8}\s*\)/g;
  const variables = new Map();
  for (const [path, content] of themeFiles) {
    for (const match of content.matchAll(declaration)) {
      variables.set(match[2], { path, declaration: match[0] });
    }
  }
  const allDart = [...themeFiles.values()].join('\n');
  const findRoleVariable = (patterns) => {
    for (const pattern of patterns) {
      const match = allDart.match(pattern);
      if (match && variables.has(match[1])) return match[1];
    }
    return null;
  };
  const roleVariables = {
    primary: findRoleVariable([/seedColor\s*:\s*([A-Za-z_]\w*)/, /primary\s*:\s*([A-Za-z_]\w*)/, /primaryColor\s*:\s*([A-Za-z_]\w*)/]),
    secondary: findRoleVariable([/secondary\s*:\s*([A-Za-z_]\w*)/, /secondaryColor\s*:\s*([A-Za-z_]\w*)/]),
    accent: findRoleVariable([/tertiary\s*:\s*([A-Za-z_]\w*)/, /accentColor\s*:\s*([A-Za-z_]\w*)/])
  };
  const updates = new Map(alignment.updates);
  updates.set('pubspec.yaml', updatedPubspec);
  const metadataRoot = 'fastlane/metadata/android/en-US';
  const listingTitle = (options.title || options.appName || 'App').trim().substring(0, 30);
  const shortDescription = (options.shortDescription || 'A great app').trim().substring(0, 80);
  const fullDescription = (options.fullDescription || options.appName || 'Download now!').trim().substring(0, 4000);
  updates.set(`${metadataRoot}/title.txt`, listingTitle);
  updates.set(`${metadataRoot}/short_description.txt`, shortDescription);
  updates.set(`${metadataRoot}/full_description.txt`, fullDescription);
  if (appLogoBase64) {
    const iconBlob = await api(`/repos/${repo}/git/blobs`, 'POST', {
      content: appLogoBase64,
      encoding: 'base64'
    });
    updates.set(iconPath, { blobSha: iconBlob.sha });
    updates.set(`${metadataRoot}/images/icon.png`, { blobSha: iconBlob.sha });
  }
  const oldScreenshots = blobs.filter(entry => entry.path.startsWith(`${metadataRoot}/images/phoneScreenshots/`));
  let screenshotsSource = 'none';
  if (options.screenshots?.length) {
    screenshotsSource = 'upload';
    for (const screenshot of oldScreenshots) updates.set(screenshot.path, null);
    for (let index = 0; index < options.screenshots.length; index++) {
      const screenshot = options.screenshots[index];
      const suffix = screenshot.extension === 'png' ? 'png' : 'jpg';
      const filename = `phone-${String(index + 1).padStart(2, '0')}.${suffix}`;
      const image = await api(`/repos/${repo}/git/blobs`, 'POST', { content: screenshot.base64, encoding: 'base64' });
      updates.set(`${metadataRoot}/images/phoneScreenshots/${filename}`, { blobSha: image.sha });
    }
  } else if (docsScreensEntries.length) {
    screenshotsSource = docsScreensFolder;
    for (const screenshot of oldScreenshots) updates.set(screenshot.path, null);
    docsScreensEntries.forEach((entry, index) => {
      const suffix = entry.path.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
      const filename = `phone-${String(index + 1).padStart(2, '0')}.${suffix}`;
      // Reuse the existing docs/screens blob directly; no re-upload needed.
      updates.set(`${metadataRoot}/images/phoneScreenshots/${filename}`, { blobSha: entry.sha });
    });
  }

  const newColorsByVariable = new Map(Object.entries(roleVariables)
    .filter(([, variable]) => variable)
    .map(([role, variable]) => [variable, colors[role]]));
  const themeRolesUpdated = new Set(newColorsByVariable.size ? Object.keys(roleVariables).filter(role => roleVariables[role]) : []);
  for (const [path, content] of themeFiles) {
    let updated = content;
    for (const [variable, color] of newColorsByVariable) {
      const colorDeclaration = new RegExp(`((?:const|final)\\s+${variable}\\s*=\\s*Color\\(\\s*)0x[0-9a-fA-F]{8}(\\s*\\))`);
      updated = updated.replace(colorDeclaration, (_match, prefix, suffix) => `${prefix}${color}${suffix}`);
    }
    const inlineColorRoles = [
      ['primary', /(\b(?:seedColor|primary|primaryColor)\s*:\s*Color\(\s*)0x[0-9a-fA-F]{8}(\s*\))/g],
      ['secondary', /(\bsecondary(?:Color)?\s*:\s*Color\(\s*)0x[0-9a-fA-F]{8}(\s*\))/g],
      ['accent', /(\b(?:tertiary|accentColor)\s*:\s*Color\(\s*)0x[0-9a-fA-F]{8}(\s*\))/g]
    ];
    for (const [role, pattern] of inlineColorRoles) {
      updated = updated.replace(pattern, (_match, prefix, suffix) => {
        themeRolesUpdated.add(role);
        return `${prefix}${colors[role]}${suffix}`;
      });
    }
    if (options.appName) {
      const escapedName = `'${options.appName.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$')}'`;
      updated = updated.replace(/(MaterialApp\s*\([\s\S]*?\btitle\s*:\s*)['"][^'"]*['"]/, (_match, prefix) => `${prefix}${escapedName}`);
    }
    if (updated !== content) updates.set(path, updated);
  }

  if (variantExists) {
    const currentRef = await api(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    if (currentRef.object.sha !== sourceRef.object.sha) throw new Error('The variant branch changed during preparation. Retry before building.');
  }
  const newTree = [];
  for (const [path, value] of updates) {
    if (value === null) {
      newTree.push({ path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const sha = value && value.blobSha ? value.blobSha : (await api(`/repos/${repo}/git/blobs`, 'POST', {
      content: btoa(unescape(encodeURIComponent(value))),
      encoding: 'base64'
    })).sha;
    newTree.push({ path, mode: '100644', type: 'blob', sha });
  }
  const tree = await api(`/repos/${repo}/git/trees`, 'POST', { base_tree: sourceCommit.tree.sha, tree: newTree });
  const commit = await api(`/repos/${repo}/git/commits`, 'POST', {
    message: `Create Flutter variant ${branch}`,
    tree: tree.sha,
    parents: [sourceRef.object.sha]
  });
  if (variantExists) {
    await api(variantRefPath, 'PATCH', { sha: commit.sha, force: false });
  } else {
    await api(`/repos/${repo}/git/refs`, 'POST', { ref: `refs/heads/${branch}`, sha: commit.sha });
  }
  return {
    commit: commit.sha,
    iconPath: appLogoBase64 ? iconPath : null,
    themeRolesUpdated: [...themeRolesUpdated],
    screenshotsSource,
    screenshotsCount: options.screenshots?.length || docsScreensEntries.length,
    changedFiles: newTree.map(item => item.path)
  };
}

async function runFlutterVariantBuild(token, repo, baseBranch, options, logFn = buildLog, workflowReady = false) {
  const applicationId = options.applicationId;
  const primaryColor = document.getElementById('ghPrimaryColor').value.trim() || '#8BC34A';
  const secondaryColor = document.getElementById('ghDarkColor').value.trim() || '#558B2F';
  const accentColor = document.getElementById('ghIconBg').value.trim() || '#1565C0';

  if (!appLogoUploaded) {
    generateFlutterAppIcon(options.appName || applicationId, primaryColor, accentColor);
    logFn('Generated a 512x512 app icon from the app name and color palette.', 'log-info');
  }
  if (!workflowReady) {
    logFn('Checking Flutter workflow and signing configuration...', 'log-info');
    await ensureFlutterBuildWorkflow(token, repo, options.publishToPlay);
  }

  logFn(`Preparing Flutter variant branch ${applicationId}...`, 'log-info');
  const variant = await createFlutterVariant(token, repo, baseBranch, applicationId, {
    applicationId,
    appName: options.appName,
    title: options.title,
    shortDescription: options.shortDescription,
    fullDescription: options.fullDescription,
    screenshots: options.screenshots,
    publishToPlay: options.publishToPlay,
    primaryColor,
    secondaryColor,
    accentColor
  });
  logFn(`Flutter variant committed (${variant.changedFiles.length} files) at ${variant.commit.substring(0, 7)}.`, 'log-success');
  if (variant.iconPath) logFn(`Launcher icon source updated: ${variant.iconPath}`, 'log-success');
  else logFn('No new icon uploaded; the project launcher icon will be reused.', 'log-info');
  if (variant.themeRolesUpdated.length) logFn(`Updated Flutter theme colors: ${variant.themeRolesUpdated.join(', ')}.`, 'log-success');
  else logFn('Flutter theme colors could not be mapped safely; the original theme was preserved.', 'log-info');
  if (variant.screenshotsSource === 'upload') logFn(`Used ${variant.screenshotsCount} uploaded screenshot(s).`, 'log-success');
  else if (variant.screenshotsSource === 'docs/screens') logFn(`Used ${variant.screenshotsCount} screenshot(s) from docs/screens.`, 'log-success');
  else logFn('No screenshots uploaded and none found in docs/screens; the existing Play listing images will be reused.', 'log-info');

  return triggerAndWait(token, repo, 'flutter-build.yml', applicationId, {
    publish_to_play: options.publishToPlay ? 'true' : 'false',
    track: options.track
  }, `Flutter AAB ${applicationId}`, logFn);
}

function initializeWorkspaceNavigation() {
  document.getElementById('updatesHost').appendChild(document.getElementById('existingUpdatesSection'));
  document.getElementById('settingsConnectionHost').appendChild(document.getElementById('connectionSettings'));
  document.getElementById('settingsSigningHost').appendChild(document.getElementById('signingSettings'));
  document.getElementById('historyLogsHost').appendChild(document.getElementById('buildStatus'));
  const tabs = [...document.querySelectorAll('.workspace-tab')];
  const selectView = (view, focus = false) => {
    const selected = tabs.find(tab => tab.dataset.view === view) || tabs[0];
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    }
    if (focus) selected.focus();
    chrome.storage.local.set({ workspaceView: selected.dataset.view });
    if (selected.dataset.view === 'history') renderBuildHistory();
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => selectView(tab.dataset.view));
    tab.addEventListener('keydown', event => {
      const index = tabs.indexOf(tab);
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); selectView(tabs[next].dataset.view, true); }
    });
  }
  document.getElementById('openUpdateSettingsBtn').addEventListener('click', () => selectView('settings', true));
  document.getElementById('buildBtn').addEventListener('click', () => {
    selectView('history');
    document.getElementById('historyLogsDetails').open = true;
  });
  const updateConnection = () => {
    document.getElementById('updatesConnectionStatus').textContent = document.getElementById('ghToken').value.trim() ? 'GitHub token configured' : 'GitHub not connected';
  };
  document.getElementById('ghToken').addEventListener('input', updateConnection);
  chrome.storage.local.get(['workspaceView', 'ghToken'], saved => {
    selectView(saved.workspaceView || 'updates');
    if (saved.ghToken && !document.getElementById('ghToken').value) document.getElementById('ghToken').value = saved.ghToken;
    updateConnection();
  });
}

document.addEventListener('DOMContentLoaded', initializeWorkspaceNavigation);
document.addEventListener('DOMContentLoaded', initializeExistingAppUpdates);
document.addEventListener('DOMContentLoaded', initializeBuildHistory);

document.getElementById('inspectProjectBtn').addEventListener('click', async () => {
  const token = document.getElementById('ghToken').value.trim();
  const repo = document.getElementById('ghRepo').value.trim();
  const ref = document.getElementById('ghBaseBranch').value.trim() || 'main';
  const button = document.getElementById('inspectProjectBtn');
  if (!token || !repo) {
    buildLog('Enter GitHub token and repository before inspection.', 'log-error');
    return;
  }
  button.disabled = true;
  try {
    const inspection = await showProjectInspection(token, repo, ref);
    if (inspection.projectType === 'flutter') {
      document.getElementById('ghWorkflow').value = 'flutter-build.yml';
      buildLog('Flutter project detected. Switched workflow to Build Flutter Android AAB.', 'log-info');
    }
    buildLog(`Project inspection complete: ${inspection.projectType} (${ref}).`, 'log-success');
  } catch (error) {
    document.getElementById('projectInspection').textContent = error.message;
    buildLog(`Project inspection failed: ${error.message}`, 'log-error');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('buildBtn').addEventListener('click', async () => {
  const token = document.getElementById('ghToken').value.trim();
  const repo = document.getElementById('ghRepo').value.trim();
  const workflow = document.getElementById('ghWorkflow').value;
  const appEntries = getAppEntries(true);
  const branch = document.getElementById('ghBranch').value.trim() || appEntries[0]?.pkg || '';
  const track = document.getElementById('ghTrack').value;

  if (!token || !repo || (!branch && workflow !== 'flutter-build.yml')) {
    buildLog('Fill in token and repository; a branch is also required for this workflow.', 'log-error');
    return;
  }

  const buildBtn = document.getElementById('buildBtn');
  buildBtn.disabled = true;
  document.getElementById('buildStatus').innerHTML = '';

  try {
    const appName = appEntries[0]?.name || '';
    const appPkg = appEntries[0]?.pkg || '';
    const shortDesc = document.getElementById('shortDesc').value.trim();
    const fullDesc = document.getElementById('fullDesc').value.trim();
    const listingBaseBranch = document.getElementById('ghBaseBranch').value.trim() || 'main';
    const shouldGenerateListingCopy = ['setup-variant.yml', 'publish-app.yml', 'flutter-build.yml'].includes(workflow);
    const listingCopy = shouldGenerateListingCopy && token && repo && appName
      ? await prepareAppListingCopy(token, repo, listingBaseBranch, appName, appPkg, {
          shortDescription: shortDesc,
          fullDescription: fullDesc
        })
      : {
          title: appName.substring(0, 30),
          shortDescription: shortDesc,
          fullDescription: fullDesc
        };

    if (workflow === 'setup-variant.yml') {
      const baseBranch = listingBaseBranch;
      const inspection = await showProjectInspection(token, repo, baseBranch);
      if (inspection.projectType === 'flutter') {
        document.getElementById('ghWorkflow').value = 'flutter-build.yml';
        buildLog('Flutter project detected. Switched to Build Flutter Android AAB; click the build button again to continue.', 'log-info');
        buildBtn.disabled = false;
        buildBtn.textContent = '🚀 Setup + Build + Publish';
        return;
      }
      if (inspection.projectType !== 'android-native' || !inspection.safeForVariantWorkflow) {
        buildLog('Project does not match the native Android variant workflow. No files were changed.', 'log-error');
        buildBtn.disabled = false;
        buildBtn.textContent = '🚀 Setup + Build + Publish';
        return;
      }

      // STEP 1: Setup Variant
      // Generate default package name if not provided
      let buildPkg = appPkg;
      if (!buildPkg) {
        buildPkg = generateDefaultPackageName();
        buildLog(`No package provided, using default: ${buildPkg}`, 'log-info');
      }

      // Use package name as branch name
      const variantBranch = buildPkg;

      // Get repo default branch (where setup-variant.yml lives)
      let defaultBranch = 'main';
      try {
        const repoInfo = await fetch(`https://api.github.com/repos/${repo}`, {
          headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
        }).then(r => r.json());
        defaultBranch = repoInfo.default_branch || 'main';
      } catch(_) {}
      const setupInputs = {
        branch: variantBranch,
        application_id: buildPkg,
        app_name: listingCopy.title || 'MyApp',
        title: listingCopy.title || 'MyApp',
        short_description: listingCopy.shortDescription || (shortDesc || 'Discover Latest Movie & Series Trailers').substring(0, 80),
        full_description: listingCopy.fullDescription || fullDesc || `${appName} lets you explore movie and TV show trailers powered by TMDB. Simple, fast, and easy to use.`,
        primary_color: document.getElementById('ghPrimaryColor').value.trim() || '#8BC34A',
        primary_dark: document.getElementById('ghDarkColor').value.trim() || '#558B2F',
        icon_bg_color: document.getElementById('ghIconBg').value.trim() || '#1565C0',
        base_branch: baseBranch
      };
      const setupOk = await triggerAndWait(token, repo, 'setup-variant.yml', defaultBranch, setupInputs, 'Setup Variant');
      if (!setupOk) {
        buildLog('Setup failed. Fix errors and retry.', 'log-error');
        buildBtn.disabled = false;
        buildBtn.textContent = '🚀 Setup + Build + Publish';
        return;
      }

      // Push workflow files (build.yml) to variant branch so build triggers
      await pushWorkflowsToBranch(token, repo, variantBranch);

      // Push custom logo if uploaded
      await pushLogoToBranch(token, repo, variantBranch);

      // Auto-generate and push privacy policy if enabled
      if (document.getElementById('autoPrivacyPolicy').checked) {
        const contactEmail = document.getElementById('contactEmail').value.trim() || 'dev@example.com';
        const policyUrl = await pushPrivacyPolicyToBranch(token, repo, variantBranch, appName || 'MyApp', buildPkg, contactEmail);
        if (policyUrl) {
          document.getElementById('privacyUrl').value = policyUrl;
          buildLog(`📜 Privacy URL: ${policyUrl}`, 'log-success');
        }
      }

      // STEP 2: Build is auto-triggered by push to the new branch (branches: ['**'])
      buildLog('Variant setup done! Build auto-triggered by push...', 'log-info');
      await new Promise(r => setTimeout(r, 8000));

      // Find the auto-triggered build run
      let buildRunId = null;
      let buildAlreadyDone = false;
      for (let w = 0; w < 15; w++) {
        const runsRes = await fetch(`https://api.github.com/repos/${repo}/actions/runs?branch=${encodeURIComponent(variantBranch)}&per_page=5`, {
          headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
        }).then(r => r.json());
        const runs = runsRes.workflow_runs || [];
        // Find any run that hasn't completed (covers in_progress, queued, waiting, pending, requested)
        const activeRun = runs.find(r => r.status !== 'completed');
        if (activeRun) { buildRunId = activeRun.id; break; }
        // If all runs completed, the build may have finished already
        if (runs.length > 0 && runs.every(r => r.status === 'completed')) {
          buildRunId = runs[0].id; buildAlreadyDone = true; break;
        }
        await new Promise(r => setTimeout(r, 5000));
      }

      if (buildRunId) {
        if (buildAlreadyDone) {
          const runRes = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${buildRunId}`, {
            headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
          }).then(r => r.json());
          if (runRes.conclusion === 'success') {
            buildLog('Full pipeline completed! Draft uploaded to Play Store.', 'log-success');
            buildBtn.style.background = '#2ed573';
            buildBtn.textContent = '✅ All Done!';
          } else {
            buildLog(`Build finished: ${runRes.conclusion}. Check GitHub Actions.`, 'log-error');
            buildBtn.style.background = '#ff4757';
            buildBtn.textContent = '⚠️ Build Issues';
          }
        } else {
          buildLog(`Build #${buildRunId} running...`, 'log-info');
          let buildResult = 'timeout';
          for (let p = 0; p < 60; p++) {
            const runRes = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${buildRunId}`, {
              headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
            }).then(r => r.json());
            if (runRes.status === 'completed') {
              buildResult = runRes.conclusion;
              break;
            }
            buildLog(`Build still running... (${p + 1}min)`, 'log-info');
            await new Promise(r => setTimeout(r, 15000));
          }
          if (buildResult === 'success') {
            buildLog('Full pipeline completed! Draft uploaded to Play Store.', 'log-success');
            buildBtn.style.background = '#2ed573';
            buildBtn.textContent = '✅ All Done!';
          } else {
            buildLog(`Build finished: ${buildResult}. Check GitHub Actions.`, 'log-error');
            buildBtn.style.background = '#ff4757';
            buildBtn.textContent = '⚠️ Build Issues';
          }
        }
      } else {
        buildLog('Could not find build run. Check GitHub Actions manually.', 'log-error');
        buildBtn.style.background = '#ff4757';
        buildBtn.textContent = '⚠️ Build Issues';
      }

    } else if (workflow === 'publish-app.yml') {
      const inputs = {
        branch: branch,
        title: listingCopy.title || (appName || 'App').substring(0, 30),
        short_description: listingCopy.shortDescription || shortDesc || 'A great app',
        full_description: listingCopy.fullDescription || fullDesc || 'Download now!',
        track: track
      };
      const ok = await triggerAndWait(token, repo, 'publish-app.yml', branch, inputs, 'Publish');
      if (ok) {
        buildBtn.style.background = '#2ed573';
        buildBtn.textContent = '✅ Published!';
      } else {
        buildBtn.style.background = '#ff4757';
        buildBtn.textContent = '❌ Failed';
      }

    } else if (workflow === 'flutter-build.yml') {
      const flutterRef = listingBaseBranch;
      const inspection = await showProjectInspection(token, repo, flutterRef);
      if (inspection.projectType !== 'flutter') {
        buildLog(`Flutter build stopped: selected project is ${inspection.projectType}, not Flutter.`, 'log-error');
        buildBtn.disabled = false;
        buildBtn.textContent = '🚀 Setup + Build + Publish';
        return;
      }
      const buildPkg = appPkg || generateDefaultPackageName();
      const publishToPlay = document.getElementById('publishFlutterPlay').checked;
      const ok = await runFlutterVariantBuild(token, repo, flutterRef, {
        applicationId: buildPkg,
        appName: listingCopy.title || appName,
        title: listingCopy.title || appName,
        shortDescription: listingCopy.shortDescription || shortDesc,
        fullDescription: listingCopy.fullDescription || fullDesc,
        screenshots: playScreenshotAssets,
        publishToPlay,
        track: document.getElementById('ghTrack').value || 'internal'
      }, buildLog);
      if (ok) {
        buildBtn.style.background = '#2ed573';
        buildBtn.textContent = '✅ Flutter AAB Ready';
      } else {
        buildBtn.style.background = '#ff4757';
        buildBtn.textContent = '❌ Flutter Build Failed';
      }

    } else {
      // build.yml — simple trigger
      const ok = await triggerAndWait(token, repo, 'build.yml', branch, undefined, 'Build');
      if (ok) {
        buildBtn.style.background = '#2ed573';
        buildBtn.textContent = '✅ Build Passed!';
      } else {
        buildBtn.style.background = '#ff4757';
        buildBtn.textContent = '❌ Build Failed';
      }
    }

    buildLog(`<a href="https://github.com/${repo}/actions" target="_blank" style="color:#00d4ff">View on GitHub →</a>`);

  } catch (err) {
    buildLog(`Error: ${err.message}`, 'log-error');
  }

  setTimeout(() => {
    buildBtn.disabled = false;
    buildBtn.style.background = '#7C4DFF';
    buildBtn.textContent = '🚀 Setup + Build + Publish';
  }, 10000);
});

// ==================== FETCH ALL CONSOLE (DEVELOPER ACCOUNT REPORTS) ====================

let consoleFetchRunning = false;

// ===== INJECTED: list accounts from the selector, or click one by name =====
// action: 'list' -> { accounts: [{name, devId|null}] } ; 'click' -> true/false
function consoleAccountMenuAction(action, accountName) {
  return new Promise(async (resolve) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const vis = el => {
      if (!el || !el.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 3 || r.height < 3) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none';
    };
    // For popup containers only: accept elements whose subtree has any box
    const visPopup = el => {
      if (!el) return false;
      if (vis(el)) return true;
      const list = el.querySelector && el.querySelector('material-list');
      return !!(list && list.getBoundingClientRect().height > 3);
    };
    // Shadow-DOM piercing querySelectorAll — Play Console renders the account
    // selector inside Web Components, so plain querySelectorAll misses it.
    function deepAll(selector, root) {
      const results = [];
      const stack = [root || document.documentElement];
      while (stack.length) {
        const node = stack.pop();
        if (!node) continue;
        if (node.shadowRoot) stack.push(node.shadowRoot);
        if (node.nodeType === 1) {
          try { if (node.matches(selector)) results.push(node); } catch (_) {}
        }
        const kids = node.children;
        if (kids) for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
      }
      return results;
    }
    // Realistic click — Play Console often listens to mousedown/up, not click()
    function realClick(el) {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
      }
      try { el.click(); } catch (_) {}
    }
    const MARKERS = ['sign out', 'déconnexion', 'deconnexion', 'se déconnecter', 'se deconnecter',
      'manage developer accounts', 'gérer les comptes', 'gerer les comptes',
      'gérer les comptes de développeur', 'manage accounts'];
    const EXCLUDE_RE = /manage developer accounts|gérer les comptes|gerer les comptes|sign out|déconnexion|deconnexion|se déconnecter|add account|ajouter un compte|view app|console/i;

    // Precise: the Play Console developer-account listbox (Angular Material)
    function findDevList() {
      const lists = deepAll('material-list.developers-container, material-list[aria-label*="developer account" i], material-list[aria-label*="comptes" i]');
      return lists.filter(visPopup)[0] || null;
    }
    function devListRows(list) {
      return deepAll('material-select-item', list)
        .filter(vis)
        .filter(r => r.getAttribute('debug-id') !== 'manage-accounts-button')
        .filter(r => r.querySelector('.primary-text'));
    }
    function devListName(row) {
      const pt = row.querySelector('.primary-text');
      return pt ? pt.textContent.trim() : '';
    }

    function findMenu() {
      const devList = findDevList();
      if (devList) return devList;
      const matches = [];
      const all = deepAll('div, ul, [role="menu"], [role="listbox"], [role="dialog"], [role="list"]');
      for (const el of all) {
        if (!vis(el)) continue;
        const t = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
        if (!MARKERS.some(m => t.includes(m))) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 120 || r.height < 80) continue;
        if (r.width >= window.innerWidth * 0.98 && r.height >= window.innerHeight * 0.98) continue;
        matches.push(el);
      }
      // deepest match (one that contains no other match)
      for (const el of matches) {
        if (!matches.some(o => o !== el && el.contains(o))) return el;
      }
      return null;
    }

    function itemName(el) {
      const lines = (el.innerText || '').split('\n').map(s => s.trim())
        .filter(s => s.length > 1 && s.length < 80 && !s.includes('@') && !EXCLUDE_RE.test(s));
      return lines[0] || '';
    }

    function menuRows(menu) {
      const rows = deepAll('a, button, li, [role="menuitem"], [role="option"], [role="link"], [role="menuitemlink"], [class*="item"], [class*="entry"], [class*="account"]', menu)
        .filter(vis)
        .filter(el => itemName(el));
      // keep only outermost rows (avoid nested duplicates)
      return rows.filter(el => !rows.some(o => o !== el && el.contains(o)));
    }

    function parseItems(menu) {
      const items = [];
      const seen = new Set();
      // Path 0: the exact Play Console developer listbox (material-select-item rows)
      const list = findDevList() || (menu && menu.matches && menu.matches('material-list') ? menu : null);
      if (list) {
        for (const row of devListRows(list)) {
          const name = devListName(row);
          if (!name || seen.has(name)) continue;
          seen.add(name);
          items.push({ name, devId: null });
        }
        if (items.length) return items;
      }
      // Path 1: anchor items exposing the developer id in their href (menu first, then whole page)
      let anchors = deepAll('a[href*="developers/"]', menu);
      if (!anchors.length) anchors = deepAll('a[href*="developers/"]');
      for (const a of anchors) {
        if (!vis(a)) continue;
        const m = (a.getAttribute('href') || '').match(/developers\/(\d+)/);
        if (!m) continue;
        const name = itemName(a);
        if (!name || seen.has(m[1])) continue;
        seen.add(m[1]);
        items.push({ name, devId: m[1] });
      }
      if (items.length) return items;
      // Path 2: clickable rows without hrefs (resolved later by clicking)
      const seenNames = new Set();
      for (const el of menuRows(menu)) {
        const name = itemName(el);
        if (!name || seenNames.has(name)) continue;
        seenNames.add(name);
        items.push({ name, devId: null });
      }
      return items;
    }

    // Activate the developer-switcher using several event strategies
    async function activateSwitcher() {
      const btn = deepAll('developer-switcher button[debug-id="current-developer-button"], button[debug-id="current-developer-button"]')
        .filter(vis)[0];
      if (!btn) return false;
      const wrapper = btn.closest('console-button-popup, [popupsource], .popup-source') || btn;
      const img = btn.querySelector('img');
      const targets = [wrapper, btn, img].filter(Boolean);
      for (const t of targets) {
        const r = t.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          t.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type,
            { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, isPrimary: true }));
        }
      }
      try { btn.focus(); } catch (_) {}
      try { btn.click(); } catch (_) {}
      // Wait for the popup pane to actually fill with the developer list
      for (let w = 0; w < 24; w++) {
        await sleep(250);
        const list = findDevList();
        if (list && devListRows(list).length > 0) return true;
        const popup = deepAll('material-popup.dropdown-popup, material-popup.console-popup').filter(vis)
          .find(p => (p.innerText || '').trim().length > 5);
        if (popup && findDevList()) return true;
      }
      return !!findDevList();
    }

    async function openMenu() {
      let menu = findMenu();
      if (menu) return menu;
      // 1) The exact Play Console trigger: developer-switcher icon button (up to 3 attempts)
      for (let attempt = 0; attempt < 3; attempt++) {
        const ok = await activateSwitcher();
        if (ok) {
          menu = findMenu();
          if (menu) return menu;
        }
        await sleep(400);
      }
      // 2) The gaia-selector / account chip in the top-right
      const chip = deepAll('gaia-selector, material-chip, [class*="gaia"], [class*="account-chip"], [debug-id*="account"]')
        .filter(vis)[0];
      if (chip) {
        realClick(chip);
        await sleep(900);
        menu = findMenu();
        if (menu) return menu;
      }
      // 2) Scan likely top-right buttons
      const btns = deepAll('button, [role="button"], a, [aria-haspopup], [aria-label]')
        .filter(vis)
        .filter(b => { const r = b.getBoundingClientRect(); return r.top < 120 && r.height < 90 && r.width < 420; })
        .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
      // Try likely account buttons first (avatar, name, arrow), then the rest
      const score = b => {
        const s = ((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || '')).toLowerCase();
        let sc = 0;
        if (/account|compte|avatar|profile|profil|switch|changer/.test(s)) sc += 3;
        if (/notification|bell|help|aide/.test(s)) sc -= 2;
        return sc;
      };
      btns.sort((a, b) => (score(b) - score(a)) || (b.getBoundingClientRect().right - a.getBoundingClientRect().right));
      for (const b of btns.slice(0, 18)) {
        realClick(b);
        await sleep(900);
        menu = findMenu();
        if (menu) return menu;
        // maybe the click opened anchors directly without a marker container
        if (deepAll('a[href*="developers/"]').filter(vis).length >= 2) return document.body;
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(300);
      }
      return null;
    }

    function findScroller(menu) {
      let best = menu;
      const all = deepAll('*', menu);
      for (const el of all) {
        if (el.scrollHeight > el.clientHeight + 30 && el.clientHeight > 60) {
          if (best === menu || el.contains(best) === false) best = el;
        }
      }
      return best;
    }

    try {
      const menu = await openMenu();
      if (!menu) { resolve(action === 'list' ? { accounts: [], error: 'Account selector menu not found' } : false); return; }
      const scroller = findScroller(menu);
      const step = Math.max(140, (scroller.clientHeight || 300) - 40);

      if (action === 'list') {
        const accMap = new Map();
        const collect = () => { for (const it of parseItems(menu)) accMap.set(it.devId || it.name, it); };
        collect();
        for (let pos = 0; pos <= scroller.scrollHeight + step; pos += step) {
          scroller.scrollTop = pos;
          await sleep(350);
          collect();
        }
        scroller.scrollTop = 0;
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        resolve({ accounts: [...accMap.values()] });
        return;
      }

      // action === 'click': scroll until the named account row is visible, then click it
      for (let pos = 0; pos <= scroller.scrollHeight + step; pos += step) {
        // Precise path: material-select-item rows matched by .primary-text
        const list = findDevList();
        if (list) {
          const rows = devListRows(list);
          const target = rows.find(r => devListName(r) === accountName)
            || rows.find(r => devListName(r).toLowerCase() === (accountName || '').toLowerCase());
          if (target) {
            target.scrollIntoView({ block: 'center' });
            await sleep(250);
            // Focus the option (Angular Material listens to focus + keyboard)
            try { target.focus(); } catch (_) {}
            target.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
            await sleep(150);
            // Full pointer sequence on the row AND its inner developer-item
            realClick(target);
            const inner = target.querySelector('developer-item, .primary-text');
            if (inner) realClick(inner);
            await sleep(200);
            // Keyboard confirm as extra fallback
            for (const key of [' ', 'Enter']) {
              target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
              target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
            }
            resolve(true);
            return;
          }
        }
        const rows = menuRows(menu);
        let target = rows.find(el => itemName(el) === accountName)
          || rows.find(el => itemName(el).toLowerCase() === (accountName || '').toLowerCase())
          || rows.find(el => itemName(el).toLowerCase().startsWith((accountName || '').toLowerCase()));
        if (target) {
          target.scrollIntoView({ block: 'center' });
          await sleep(250);
          realClick(target);
          resolve(true);
          return;
        }
        scroller.scrollTop = pos;
        await sleep(350);
      }
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      resolve(false);
    } catch (e) {
      resolve(action === 'list' ? { accounts: [], error: e.message } : false);
    }
  });
}

// ===== INJECTED: diagnostics — what the page exposes for account discovery =====
function probeAccountSelector() {
  const out = { url: location.href, headerAccounts: [], menuMarkers: [], topRightButtons: [], pageAnchors: [] };
  const vis = el => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  function deepAll(selector, root) {
    const results = [];
    const stack = [root || document.documentElement];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (node.shadowRoot) stack.push(node.shadowRoot);
      if (node.nodeType === 1) { try { if (node.matches(selector)) results.push(node); } catch (_) {} }
      const kids = node.children;
      if (kids) for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
    return results;
  }
  // Header account block (name / id on the current page)
  const bt = document.body.innerText || '';
  const im = bt.match(/Account ID[:\s]*([0-9]{6,})/i) || bt.match(/ID de compte[:\s]*([0-9]{6,})/i);
  if (im) out.headerAccounts.push({ text: im[0].trim() });
  // Any visible container mentioning account-menu markers
  for (const el of deepAll('div, ul, [role="menu"], [role="listbox"], [role="dialog"]').filter(vis).slice(0, 4000)) {
    const t = (el.innerText || '').toLowerCase();
    if (['sign out', 'déconnexion', 'manage developer accounts', 'gérer les comptes'].some(m => t.includes(m))) {
      const r = el.getBoundingClientRect();
      out.menuMarkers.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 60), w: Math.round(r.width), h: Math.round(r.height) });
      if (out.menuMarkers.length >= 5) break;
    }
  }
  // Top-right buttons that could open the selector
  for (const b of deepAll('button, [role="button"], [aria-haspopup]').filter(vis)) {
    const r = b.getBoundingClientRect();
    if (r.top > 130 || r.height > 90 || r.width > 420) continue;
    out.topRightButtons.push({
      tag: b.tagName,
      label: (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 50),
      right: Math.round(window.innerWidth - r.right)
    });
    if (out.topRightButtons.length >= 12) break;
  }
  // All developers/ anchors visible anywhere on the page
  for (const a of deepAll('a[href*="developers/"]').filter(vis)) {
    const m = (a.getAttribute('href') || '').match(/developers\/(\d+)/);
    out.pageAnchors.push({ devId: m ? m[1] : '', text: (a.innerText || '').trim().split('\n')[0].slice(0, 40) });
    if (out.pageAnchors.length >= 30) break;
  }
  return out;
}

// ===== INJECTED: page-wide scan of account links (no menu needed) =====
function scanPageForAccounts() {
  const vis = el => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  function deepAll(selector, root) {
    const results = [];
    const stack = [root || document.documentElement];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (node.shadowRoot) stack.push(node.shadowRoot);
      if (node.nodeType === 1) { try { if (node.matches(selector)) results.push(node); } catch (_) {} }
      const kids = node.children;
      if (kids) for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
    return results;
  }
  const EXCLUDE_RE = /manage developer accounts|gérer les comptes|gerer les comptes|sign out|déconnexion|deconnexion|add account|ajouter un compte|view app|console/i;
  // Left-nav items and other page links must never be treated as account names
  const NAV_RE = /^(home|policy status|users and permissions|order management|download reports|developer account|activity log|settings|help|android developer verification|all apps|monetize|academy)$/i;
  const accMap = new Map();
  for (const a of deepAll('a[href*="developers/"]').filter(vis)) {
    const m = (a.getAttribute('href') || '').match(/developers\/(\d+)/);
    if (!m) continue;
    const lines = (a.innerText || '').split('\n').map(s => s.trim())
      .filter(s => s.length > 1 && s.length < 80 && !s.includes('@') && !EXCLUDE_RE.test(s) && !NAV_RE.test(s));
    const name = lines[0] || '';
    if (!name) continue;
    if (!accMap.has(m[1])) accMap.set(m[1], { name, devId: m[1] });
  }
  const accounts = [...accMap.values()];
  // Header of the current page: account name + id shown near "Account ID"
  let headerName = '';
  let headerId = '';
  const bt = document.body.innerText || '';
  const im = bt.match(/Account ID[:\s]*([0-9]{6,})/i) || bt.match(/ID de compte[:\s]*([0-9]{6,})/i);
  if (im) headerId = im[1];
  let idHost = null;
  for (const el of deepAll('div, span, p, section, header, h1, h2, h3').filter(vis)) {
    const t = el.textContent || '';
    if (/Account ID|ID de compte/i.test(t)) {
      if (!idHost || t.length < (idHost.textContent || '').length) idHost = el;
    }
  }
  if (idHost) {
    const container = idHost.closest('section, header, div') || idHost.parentElement;
    const lines = ((container && container.innerText) || '').split('\n').map(s => s.trim())
      .filter(s => s.length > 1 && s.length < 60 && !s.includes('@')
        && !/account id|id de compte|organization account|compte d'organisation|compte organisation|pinned apps|applications épinglées/i.test(s));
    headerName = lines[0] || '';
  }
  return { accounts, headerName, headerId };
}

// ===== INJECTED: extract account id + full apps table (all pages) from current account page =====
function extractAccountAppsReport() {
  return new Promise(async (resolve) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const vis = el => {
      if (!el || !el.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 3 || r.height < 3) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none';
    };
    try {
      // Wait for the console splash screen to disappear
      for (let w = 0; w < 30; w++) {
        const splash = document.getElementById('console-splash-021280');
        if (!splash || splash.classList.contains('hide') || splash.style.opacity === '0' || splash.style.display === 'none') break;
        await sleep(1000);
      }
      await sleep(2500);

      // ---- Account ID (page text, then URL) ----
      let accountId = '';
      const bodyText = document.body.innerText || '';
      const m = bodyText.match(/Account ID[:\s]*([0-9]{6,})/i) || bodyText.match(/ID de compte[:\s]*([0-9]{6,})/i);
      if (m) accountId = m[1];
      if (!accountId) { const um = location.href.match(/developers\/(\d+)/); if (um) accountId = um[1]; }

      // ---- Account name shown in the page header (best effort, for verification) ----
      let pageAccountName = '';
      let idHost = null;
      const cand = document.querySelectorAll('div, span, p, section, header, h1, h2, h3');
      for (const el of cand) {
        const t = el.textContent || '';
        if (/Account ID|ID de compte/i.test(t)) {
          if (!idHost || t.length < (idHost.textContent || '').length) idHost = el;
        }
      }
      if (idHost) {
        const container = idHost.closest('section, header, div') || idHost.parentElement;
        const lines = ((container && container.innerText) || '').split('\n').map(s => s.trim())
          .filter(s => s.length > 1 && s.length < 60 && !s.includes('@')
            && !/account id|id de compte|organization account|compte d'organisation|compte organisation|pinned apps|applications épinglées/i.test(s));
        pageAccountName = lines[0] || '';
      }

      // ---- Apps table across all pages ----
      const apps = [];
      const seen = new Set();
      const STATUS_RE = /^(production|draft|brouillon|removed|supprimée|supprime|suspended|suspendue|unpublished|retirée|retire|active|inactive|in review|en cours d'examen|rejected|refusée|refuse)$/i;
      const DATE_RE = /([A-Z][a-z]{2,9}\.? \d{1,2}, \d{4})|(\d{1,2} [a-zéûà]+\.? \d{4})|(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i;
      const PKG_RE = /([a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,})/i;

      function parseRow(row) {
        if (!row || !row.querySelector) return null;
        const link = row.querySelector('a[href*="/app/"]');
        if (!link) return null;
        const hrefM = (link.getAttribute('href') || '').match(/\/app\/(\d+)/);
        let name = '';
        let pkg = '';
        // Prefer structured cells: first cell holds the app title + package
        const cells = Array.from(row.querySelectorAll('td, [role="cell"], [role="gridcell"]'));
        if (cells.length) {
          const firstText = (cells[0].innerText || '').trim();
          const fl = firstText.split('\n').map(s => s.trim()).filter(Boolean);
          for (const t of fl) {
            if (!name && !PKG_RE.test(t) && !STATUS_RE.test(t) && t.length > 1 && t.length < 80) name = t;
            if (!pkg) { const pm = t.match(PKG_RE); if (pm) pkg = pm[1]; }
          }
        }
        if (!name) {
          // Walk the link's own lines, skipping package-like and action text
          const ll = (link.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
          for (const t of ll) {
            if (!PKG_RE.test(t) && !STATUS_RE.test(t) && !/^(view app|open app)$/i.test(t) && t.length > 1 && t.length < 80) { name = t; break; }
          }
        }
        if (!pkg) {
          const rowText = row.innerText || '';
          const pm = rowText.match(PKG_RE);
          if (pm) pkg = pm[1];
        }
        if (/^(view app|open app)$/i.test(name || '')) name = '';
        const texts = (cells.length ? cells.map(c => (c.innerText || '').trim()) : (row.innerText || '').split('\n').map(s => s.trim())).filter(Boolean);
        let status = '', updateStatus = '', installed = '', updated = '';
        for (const t of texts) {
          if (!status && STATUS_RE.test(t)) { status = t; continue; }
          if (!updateStatus && status && /update|mise à jour|jour|rollout|déploiement/i.test(t) && t.length < 60 && t !== status) updateStatus = t;
          if (!updated) { const dm = t.match(DATE_RE); if (dm) updated = dm[0]; }
          if (!installed && /^\d[\d\s,.]*$/.test(t) && t.length < 12) installed = t.replace(/\s/g, '');
        }
        if (!name) name = pkg;
        if (!name && !pkg) return null;
        const key = pkg || name;
        if (seen.has(key)) return null;
        seen.add(key);
        return { name, pkg, appId: hrefM ? hrefM[1] : '', installed, status, updateStatus, updated };
      }

      for (let page = 0; page < 30; page++) {
        const rows = document.querySelectorAll('tr, [role="row"], li');
        for (const row of rows) { const app = parseRow(row); if (app) apps.push(app); }
        if (page === 0 && apps.length === 0) {
          // Fallback: no table markup — walk up from each app link to a pseudo-row
          for (const a of document.querySelectorAll('a[href*="/app/"]')) {
            let row = a;
            for (let up = 0; up < 4 && row.parentElement; up++) {
              row = row.parentElement;
              const t = row.innerText || '';
              if (PKG_RE.test(t) || STATUS_RE.test(t.trim())) break;
            }
            const app = parseRow(row);
            if (app) apps.push(app);
          }
        }
        // Next page button (pagination)
        const nextBtn = Array.from(document.querySelectorAll('button, [role="button"]')).filter(vis)
          .find(b => /next page|next|page suivante|suivant/i.test(b.getAttribute('aria-label') || '')
            && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
        if (!nextBtn) break;
        const firstLink = document.querySelector('a[href*="/app/"]');
        const sig = (firstLink ? firstLink.getAttribute('href') : '') + '|' + document.querySelectorAll('a[href*="/app/"]').length;
        nextBtn.click();
        let changed = false;
        for (let w = 0; w < 24; w++) {
          await sleep(500);
          const f = document.querySelector('a[href*="/app/"]');
          const nsig = (f ? f.getAttribute('href') : '') + '|' + document.querySelectorAll('a[href*="/app/"]').length;
          if (nsig !== sig) { changed = true; break; }
        }
        if (!changed) break;
        await sleep(1200);
      }

      resolve({ accountId, pageAccountName, apps });
    } catch (e) {
      resolve({ accountId: '', pageAccountName: '', apps: [], error: e.message });
    }
  });
}

// ===== Sidebar-side helpers for the reports =====

function sanitizeReportFileName(name) {
  return (name || 'account').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').trim() || 'account';
}

function csvEscape(v) {
  const s = (v === undefined || v === null) ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function accountStatusCounts(apps) {
  const has = (re) => apps.filter(a => re.test(a.status || '')).length;
  const prod = has(/production|active/i);
  const draft = has(/draft|brouillon/i);
  const unpublished = has(/unpublished|retirée|retire/i);
  const removed = has(/removed|supprimée|supprime/i);
  const suspended = has(/suspended|suspendue/i);
  const inReview = has(/in review|en cours d'examen/i);
  const rejected = has(/rejected|refusée|refuse/i);
  const inactive = has(/^inactive/i);
  const known = prod + draft + unpublished + removed + suspended + inReview + rejected + inactive;
  return { total: apps.length, prod, draft, unpublished, removed, suspended, inReview, rejected, inactive, other: apps.length - known };
}

function buildAccountCsv(accountName, report) {
  const c = accountStatusCounts(report.apps);
  const rows = [
    ['Account Name', accountName],
    ['Account ID', report.accountId || ''],
    ['Total Apps', c.total],
    ['Production Apps', c.prod],
    ['Draft Apps', c.draft],
    ['Unpublished Apps', c.unpublished],
    ['Removed Apps', c.removed],
    ['Suspended Apps', c.suspended],
    ['In Review Apps', c.inReview],
    ['Rejected Apps', c.rejected],
    ['Inactive Apps', c.inactive],
    ['Other Status Apps', c.other],
    [],
    ['App', 'Package Name', 'Installed Audience', 'App Status', 'Update Status', 'Last Updated'],
    ...report.apps.map(a => [a.name, a.pkg, a.installed, a.status, a.updateStatus, a.updated])
  ];
  return rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
}

function buildAccountsSummaryCsv(entries) {
  const rows = [
    ['Account Name', 'Account ID', 'Total Apps', 'Production Apps', 'Draft Apps', 'Unpublished Apps', 'Removed Apps', 'Suspended Apps', 'Other Status Apps', 'Report File'],
    ...entries.map(e => [e.name, e.accountId, e.total, e.prod, e.draft, e.unpublished || 0, e.removed || 0, e.suspended || 0, e.other || 0, e.fileName])
  ];
  return rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
}

function downloadCsvFile(filename, content) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function downloadDataUrl(filename, dataUrl) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Injected into the wa.me / web.whatsapp.com tab: wait for the chat to load,
// then click the Send button automatically.
function autoClickWhatsAppSend() {
  return new Promise((resolve) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    (async () => {
      // Wait for web.whatsapp.com chat to load — try multiple send-button selectors
      const SEND_SELECTORS = [
        '[data-icon="send"]',
        'button[aria-label*="Send" i]',
        'button[aria-label*="Envoyer" i]',
        '[aria-label*="Send" i][role="button"]',
        '[aria-label*="Envoyer" i][role="button"]',
        'span[data-icon="send"]',
        'div[role="button"][aria-label*="Send" i]',
        'div[role="button"][aria-label*="Envoyer" i]'
      ];
      // Also try the composer footer send icon (WhatsApp's current layout)
      const COMPOSER_FOOTER = 'footer button, footer [role="button"], #main footer [data-icon]';
      for (let w = 0; w < 90; w++) { // up to 45s
        for (const sel of SEND_SELECTORS) {
          const btn = document.querySelector(sel);
          if (btn) {
            const clickable = btn.closest('button, [role="button"], div') || btn;
            clickable.click();
            btn.click();
            resolve({ sent: true, selector: sel, wait: w });
            return;
          }
        }
        // Fallback: last icon-button in the composer footer is usually Send
        const footerBtns = document.querySelectorAll(COMPOSER_FOOTER);
        if (footerBtns.length) {
          const last = footerBtns[footerBtns.length - 1];
          const clickable = last.closest('button, [role="button"], div') || last;
          clickable.click();
          last.click();
          resolve({ sent: true, selector: 'composer-footer-fallback', wait: w });
          return;
        }
        // Last resort: press Enter in the message composer (WhatsApp sends on Enter)
        const composer = document.querySelector('[contenteditable="true"][data-tab="10"], #main [contenteditable="true"], div[contenteditable="true"][title]');
        if (composer) {
          composer.focus();
          for (const type of ['keydown', 'keypress', 'keyup']) {
            composer.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
          }
          resolve({ sent: true, selector: 'enter-key-fallback', wait: w });
          return;
        }
        // If WhatsApp shows "phone number invalid" or a login QR code, bail out
        const bodyText = (document.body.innerText || '').toLowerCase();
        if (bodyText.includes('phone number') && (bodyText.includes('invalid') || bodyText.includes('not on whatsapp'))) {
          resolve({ sent: false, error: 'invalid-number' });
          return;
        }
        if (document.querySelector('[data-testid="qrcode"], canvas[aria-label*="QR" i], .landing-qr')) {
          resolve({ sent: false, error: 'login-required' });
          return;
        }
        await sleep(500);
      }
      resolve({ sent: false, error: 'timeout' });
    })();
  });
}

// Open WhatsApp (web/app) with the account description pre-filled, then auto-click Send.
// Returns { opened, sent, error }.
async function sendWhatsAppDescription(phone, text) {
  const digits = (phone || '').replace(/[^0-9]/g, '');
  if (!digits) return { opened: false, sent: false, error: 'no-number' };
  // web.whatsapp.com/send works in-browser (scriptable). wa.me would open the native desktop app on Mac.
  const url = `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(text)}`;

  // Create the tab via chrome.tabs (more reliable than window.open for scripting injection)
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: true });
  } catch (_) {
    const win = window.open(url, '_blank');
    if (!win) return { opened: false, sent: false, error: 'popup-blocked' };
    return { opened: true, sent: false, error: 'no-tab-handle' }; // opened but can't auto-click
  }
  if (!tab || !tab.id) return { opened: true, sent: false, error: 'no-tab-handle' };

  // Wait for web.whatsapp.com to load the chat, then inject the clicker
  for (let attempt = 0; attempt < 24; attempt++) {
    await sleep(1000);
    try {
      const info = await chrome.tabs.get(tab.id);
      if (info.status !== 'complete') continue;
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: autoClickWhatsAppSend
      });
      const r = result && result[0] && result[0].result;
      if (r && r.sent) {
        // Leave the tab open briefly so the send registers, then close it
        await sleep(2500);
        try { chrome.tabs.remove(tab.id); } catch (_) {}
        return { opened: true, sent: true };
      }
      if (r && r.error && r.error !== 'timeout') {
        return { opened: true, sent: false, error: r.error };
      }
      // timeout on this attempt — page may still be redirecting; retry
    } catch (_) {
      // Tab closed by user or navigated away
      return { opened: true, sent: false, error: 'tab-closed' };
    }
  }
  return { opened: true, sent: false, error: 'timeout' };
}

// Build a human-readable description of one developer account from its report
function buildAccountDescription(accountName, report, screenshotFile) {
  const c = accountStatusCounts(report.apps);
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `Developer Account: ${accountName}`,
    `Account ID: ${report.accountId || 'unknown'}`,
    `Captured: ${date}`,
    `Dashboard screenshot: ${screenshotFile || 'not captured'}`,
    '',
    `Total apps: ${c.total}`,
    `Production apps: ${c.prod}`,
    `Draft apps: ${c.draft}`,
    `Unpublished apps: ${c.unpublished}`,
    `Removed apps: ${c.removed}`,
    `Suspended apps: ${c.suspended}`,
    `In review apps: ${c.inReview}`,
    `Rejected apps: ${c.rejected}`,
    `Inactive apps: ${c.inactive}`,
    `Other status: ${c.other}`,
    '',
    'Apps:',
    ...(report.apps.length
      ? report.apps.map(a =>
          `- ${a.name}${a.pkg ? ` (${a.pkg})` : ''} — ${a.status || 'unknown status'}`
          + `${a.installed ? `, installed audience ${a.installed}` : ''}`
          + `${a.updated ? `, last updated ${a.updated}` : ''}`
          + `${a.pkg ? `\n  https://play.google.com/store/apps/details?id=${a.pkg}` : ''}`)
      : ['- No apps found on this account.'])
  ];
  return lines.join('\n');
}

// Capture the visible Play Console tab as PNG, returns a data URL or null
async function captureDashboardScreenshot(tab) {
  try {
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (_) {
    return null;
  }
}

function renderConsoleReportResults(entries) {
  const host = document.getElementById('consoleReportResults');
  if (!host) return;
  host.innerHTML = entries.map(e =>
    `<div class="console-report-entry">${e.error
      ? `⚠️ <b>${e.name}</b> — ${e.error}`
      : `✅ <b>${e.name}</b> (${e.accountId || 'no id'}) — ${e.total} apps: ${e.prod} production, ${e.draft} draft → ${e.fileName}`}</div>`
  ).join('');
}

// ===== One-click: fetch the whole console, one CSV report per developer account =====
document.getElementById('fetchAllConsoleBtn').addEventListener('click', async () => {
  if (consoleFetchRunning) return;
  const btn = document.getElementById('fetchAllConsoleBtn');
  const resultsHost = document.getElementById('consoleReportResults');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('play.google.com/console')) {
    log('Navigate to Google Play Console first!', 'error');
    return;
  }

  consoleFetchRunning = true;
  btn.disabled = true;
  document.getElementById('stopBtn').style.display = 'block';
  if (resultsHost) resultsHost.innerHTML = '';
  const entries = [];

  try {
    log('🔍 Reading developer accounts from the account selector...', 'info');
    let res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: consoleAccountMenuAction,
      args: ['list', '']
    });
    let data = (res && res[0] && res[0].result) || { accounts: [] };
    let accounts = data.accounts || [];
    if (accounts.length === 0) {
      // Fallback 1: scan the whole page for developers/<id> links (selector may render links)
      log('  ℹ️ Selector menu not detected — scanning page for account links...', 'info');
      res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scanPageForAccounts });
      data = (res && res[0] && res[0].result) || { accounts: [] };
      accounts = (data.accounts || []).slice();
      // Only accept nav-free results; otherwise fall back to the current account from the header
      const currentDevId = (tab.url.match(/developers\/(\d+)/) || [])[1] || data.headerId || '';
      const currentName = data.headerName || (accounts.length === 1 ? accounts[0].name : '') || 'CurrentAccount';
      if (accounts.length <= 1 && currentDevId) {
        accounts = [{ name: currentName, devId: currentDevId }];
        log(`  ℹ️ Only the current account could be identified: ${currentName} (${currentDevId})`, 'info');
        log('  ℹ️ To process every account, open the account selector once before running, or paste the ⚙️ Debug output if this repeats.', 'info');
      }
    }
    if (accounts.length === 0) {
      // Diagnostics: dump what the page exposes so we can adapt detection
      const probe = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: probeAccountSelector });
      const info = (probe && probe[0] && probe[0].result) || {};
      log(`  ⚙️ Debug: url=${info.url || '?'}`, 'info');
      log(`  ⚙️ Debug: header=${JSON.stringify(info.headerAccounts || [])}`, 'info');
      log(`  ⚙️ Debug: menuMarkers=${JSON.stringify(info.menuMarkers || [])}`, 'info');
      log(`  ⚙️ Debug: topRightButtons=${JSON.stringify(info.topRightButtons || [])}`, 'info');
      log(`  ⚙️ Debug: pageAnchors=${JSON.stringify(info.pageAnchors || [])}`, 'info');
      throw new Error('No developer accounts found. Copy the ⚙️ Debug lines above and send them so detection can be adapted to your console layout.');
    }
    log(`Found ${accounts.length} developer account(s): ${accounts.map(a => a.name).join(', ')}`, 'success');

    // Optional filter: only process accounts whose name matches one of the given lines
    const filterRaw = (document.getElementById('consoleAccountFilter')?.value || '').trim();
    if (filterRaw) {
      const wanted = filterRaw.split('\n').map(s => s.trim().toLowerCase()).filter(Boolean);
      const before = accounts.length;
      accounts = accounts.filter(a => wanted.some(w => a.name.toLowerCase().includes(w)));
      const skipped = before - accounts.length;
      log(`🎯 Filter active: ${accounts.length}/${before} account(s) selected${skipped ? ` (${skipped} skipped)` : ''}: ${accounts.map(a => a.name).join(', ') || 'NONE'}`, 'info');
      if (accounts.length === 0) {
        throw new Error(`No account matches the filter. Available accounts: see the list above.`);
      }
    }

    for (let i = 0; i < accounts.length; i++) {
      if (!consoleFetchRunning) { log('Stopped by user.', 'info'); break; }
      const acc = accounts[i];
      const pct = Math.round((i / accounts.length) * 100);
      document.getElementById('progressBar').style.width = pct + '%';
      log(`▶ [${i + 1}/${accounts.length}] ${acc.name}...`, 'info');

      try {
        // 1) Switch to the account (direct URL when the id is known, selector click otherwise)
        if (acc.devId) {
          await chrome.tabs.update(tab.id, { url: `https://play.google.com/console/u/0/developers/${acc.devId}/app-list` });
          await waitForTabLoad(tab.id);
        } else {
          const before = (await chrome.tabs.get(tab.id)).url;
          const beforeDev = (before.match(/developers\/(\d+)/) || [])[1] || '';
          const clickRes = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: consoleAccountMenuAction,
            args: ['click', acc.name]
          });
          if (!clickRes || !clickRes[0] || clickRes[0].result !== true) {
            throw new Error('could not click the account in the selector');
          }
          // Wait until the URL shows a DIFFERENT developer id (SPA navigation)
          for (let w = 0; w < 30; w++) {
            await sleep(500);
            const info = await chrome.tabs.get(tab.id);
            const dm = (info.url || '').match(/developers\/(\d+)/);
            if (dm && dm[1] !== beforeDev) { acc.devId = dm[1]; break; }
          }
          await waitForTabLoad(tab.id);
        }
        await sleep(3000);

        // Resolve / confirm the account id from the URL
        const info = await chrome.tabs.get(tab.id);
        const devMatch = (info.url || '').match(/developers\/(\d+)/);
        if (devMatch) acc.devId = devMatch[1];

        // 2) Extract the apps table
        let ext = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractAccountAppsReport });
        let report = (ext && ext[0] && ext[0].result) || { apps: [] };

        // Fallback: retry from the account root page if nothing was found
        if ((!report.apps || report.apps.length === 0) && acc.devId) {
          log(`  ℹ️ No apps on this page, retrying from account home...`, 'info');
          await chrome.tabs.update(tab.id, { url: `https://play.google.com/console/u/0/developers/${acc.devId}/` });
          await waitForTabLoad(tab.id);
          await sleep(3000);
          ext = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractAccountAppsReport });
          report = (ext && ext[0] && ext[0].result) || report;
        }
        if (!report.accountId) report.accountId = acc.devId || '';
        if (report.error) throw new Error(report.error);
        if (report.pageAccountName && report.pageAccountName.toLowerCase() !== acc.name.toLowerCase()) {
          log(`  ⚠️ Page header shows "${report.pageAccountName}" — keeping selector name "${acc.name}"`, 'info');
        }

        // 3) Build + download the per-account CSV report
        const csv = buildAccountCsv(acc.name, report);
        const baseName = sanitizeReportFileName(acc.name);
        const fileName = baseName + '_report.csv';
        downloadCsvFile(fileName, csv);

        // 4) Dashboard screenshot for this account
        const screenshotFile = baseName + '_dashboard.png';
        const shot = await captureDashboardScreenshot(tab);
        let savedShot = '';
        if (shot) {
          downloadDataUrl(screenshotFile, shot);
          savedShot = screenshotFile;
        } else {
          log('  ⚠️ Dashboard screenshot not captured (permission or focus issue)', 'info');
        }

        // 5) Human-readable description for this account
        const description = buildAccountDescription(acc.name, report, savedShot);
        const descFile = baseName + '_description.txt';
        downloadTextFile(descFile, description);

        // 6) Optional: open WhatsApp with this description pre-filled and auto-click Send
        const waNumber = (document.getElementById('whatsAppNumber')?.value || '').trim();
        const waSend = document.getElementById('whatsAppSend')?.checked;
        if (waSend && waNumber) {
          const wa = await sendWhatsAppDescription(waNumber, description);
          if (wa.sent) log(`  📱 WhatsApp sent for ${acc.name} ✅`, 'success');
          else if (wa.opened && wa.error === 'login-required') log(`  ⚠️ WhatsApp Web not logged in — scan the QR code once, then retry`, 'error');
          else if (wa.opened && wa.error === 'invalid-number') log(`  ⚠️ WhatsApp: invalid number ${waNumber}`, 'error');
          else if (wa.opened && wa.error === 'no-tab-handle') log(`  ⚠️ WhatsApp opened but auto-click unavailable — press Send manually`, 'info');
          else if (wa.opened) log(`  ⚠️ WhatsApp auto-send timed out — tab left open, press Send`, 'info');
          else log(`  ⚠️ WhatsApp popup blocked — allow popups for this page, then retry`, 'error');
        } else if (waNumber && !waSend) {
          // checkbox off — silent
        } else if (waSend && !waNumber) {
          log(`  ⚠️ WhatsApp send enabled but no number set`, 'error');
        }

        const c = accountStatusCounts(report.apps);
        entries.push({ name: acc.name, accountId: report.accountId, total: c.total, prod: c.prod, draft: c.draft, unpublished: c.unpublished, removed: c.removed, suspended: c.suspended, other: c.other, fileName, screenshotFile: savedShot, descFile, description });
        renderConsoleReportResults(entries);
        log(`  ✅ ${acc.name}: ${c.total} apps (${c.prod} production, ${c.draft} draft) → ${fileName}${savedShot ? ` + ${savedShot}` : ''} + ${descFile}`, 'success');
        await sleep(1200);
      } catch (e) {
        entries.push({ name: acc.name, accountId: acc.devId || '', error: e.message });
        renderConsoleReportResults(entries);
        log(`  ❌ ${acc.name}: ${e.message}`, 'error');
      }
    }

    if (entries.some(e => !e.error)) {
      const okEntries = entries.filter(e => !e.error);
      downloadCsvFile('all_accounts_summary.csv', buildAccountsSummaryCsv(okEntries));
      log('📦 Downloaded all_accounts_summary.csv', 'success');
      downloadTextFile('all_accounts_descriptions.txt',
        okEntries.map(e => e.description).join('\n\n========================================\n\n'));
      log('📦 Downloaded all_accounts_descriptions.txt', 'success');
    }
    document.getElementById('progressBar').style.width = '100%';
    log('🏁 Fetch all console finished.', 'success');
  } catch (e) {
    log('Error: ' + e.message, 'error');
  } finally {
    consoleFetchRunning = false;
    btn.disabled = false;
    document.getElementById('stopBtn').style.display = 'none';
  }
});
