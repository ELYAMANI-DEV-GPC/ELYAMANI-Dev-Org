const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'sidebar.js'), 'utf8');
const alignmentSource = source.slice(source.indexOf('function getAndroidMainSourcePaths('), source.indexOf('function parseUpdatePackages('));
const alignmentContext = vm.createContext({});
vm.runInContext(alignmentSource, alignmentContext);
function manifestElement(tagName, attributes = {}, children = []) {
  const element = {
    tagName,
    getAttributeNodeNS: (_namespace, name) => name in attributes ? { name: `android:${name}`, value: attributes[name] } : null,
    getAttributeNS: (_namespace, name) => attributes[name] || null,
    getAttribute: name => attributes[name] || '',
    getElementsByTagName: name => children.flatMap(child => [
      ...(child.tagName === name ? [child] : []),
      ...child.getElementsByTagName(name)
    ])
  };
  return element;
}
const manifestContext = vm.createContext({
  DOMParser: class {
    parseFromString(content) {
      if (content.includes('invalid-xml')) return { documentElement: manifestElement('parsererror'), getElementsByTagName: () => [manifestElement('parsererror')] };
      const launcher = manifestElement('activity', { name: '.MainActivity' }, [manifestElement('intent-filter', {}, [
        manifestElement('action', { name: 'android.intent.action.MAIN' }),
        manifestElement('category', { name: 'android.intent.category.LAUNCHER' })
      ])]);
      const details = manifestElement('activity', { name: '.DetailsActivity' });
      const alias = manifestElement('activity-alias', { name: '.Alias' });
      const service = manifestElement('service', { name: '.SyncService' });
      const receiver = manifestElement('receiver', { name: '.BootReceiver' });
      const provider = manifestElement('provider', { name: '.AppProvider' });
      const components = [details, alias, service, receiver, provider];
      if (!content.includes('overlay-no-launcher')) components.unshift(launcher);
      const application = manifestElement('application', { name: 'com.example.CustomApplication' }, components);
      const root = manifestElement('manifest', { package: 'com.example.app' }, [application]);
      return { documentElement: root, getElementsByTagName: name => root.getElementsByTagName(name) };
    }
  }
});
vm.runInContext(source.slice(source.indexOf('function parseAndroidLauncherManifest('), source.indexOf('function getAndroidMainSourcePaths(')), manifestContext);
const generator = source.slice(
  source.indexOf('async function createFlutterVariant('),
  source.indexOf('async function runFlutterVariantBuild(')
);

const activityLogSource = source.slice(source.indexOf('function extractAccountCreatedFromActivityLog('), source.indexOf('// Paginate the activity log backwards in 90-day windows until "Account created" is found.'));

async function readAccountCreatedDate(text) {
  const context = vm.createContext({
    document: {
      body: { innerText: text },
      getElementById: () => null,
      querySelectorAll: () => [{ innerText: text }]
    },
    setTimeout: callback => callback(),
    console
  });
  vm.runInContext(activityLogSource, context);
  const result = await context.extractAccountCreatedFromActivityLog();
  return result.createdDate;
}

test('detect account creation in Arabic and French activity-log text', async () => {
  assert.equal(await readAccountCreatedDate('تم إنشاء الحساب في 14 فبراير 2024'), '14 فبراير 2024');
  assert.equal(await readAccountCreatedDate('Compte créé le 14 mai 2024'), '14 mai 2024');
});

test('prefer the date nearest to the Account created marker over older history', async () => {
  const text = '12 Jan 2019\n\nAccount details: Account created\n10 changed\n\nNew account date: 14 mai 2024\nOther event: 03 Jan 2020';
  assert.equal(await readAccountCreatedDate(text), '14 mai 2024');
});

test('ignore drilldown details and prefer the activity row date near the Account created marker', async () => {
  const drilldown = { innerText: 'Account details: Account created\n10 changed\nOther event 2020-01-01', closest: () => ({ tagName: 'changes-drilldown-view' }) };
  const activityRow = { innerText: 'Account created 14 May 2024', closest: () => null };
  const context = vm.createContext({
    document: {
      body: { innerText: 'Account details: Account created\n10 changed\nOther event 2020-01-01\nAccount created 14 May 2024' },
      getElementById: () => null,
      querySelectorAll: () => [drilldown, activityRow]
    },
    setTimeout: callback => callback(),
    console
  });
  vm.runInContext(activityLogSource, context);
  const result = await context.extractAccountCreatedFromActivityLog();
  assert.equal(result.createdDate, '14 May 2024');
});

test('set the activity log page size to 30 rows before scanning', async () => {
  let selected = null;
  const dropdown = {
    innerText: 'Show rows: 30',
    textContent: 'Show rows: 30',
    getAttribute: () => 'Show rows: 30',
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 120, height: 20 }),
    dispatchEvent: () => {},
    click: () => { selected = 'dropdown'; }
  };
  const option = {
    innerText: '30',
    textContent: '30',
    getAttribute: () => '30',
    getBoundingClientRect: () => ({ left: 10, top: 40, width: 120, height: 20 }),
    dispatchEvent: () => {},
    click: () => { selected = '30'; }
  };
  const context = vm.createContext({
    document: {
      querySelectorAll: selector => {
        if (selector.includes('material-dropdown-select')) return [dropdown];
        if (selector.includes('material-select-item') || selector.includes('[role="option"]') || selector.includes('li') || selector.includes('button')) return [option];
        return [];
      },
      getElementById: () => null,
      body: { innerText: '' }
    },
    window: {},
    MouseEvent: class { constructor() {} },
    setTimeout: callback => callback(),
    console
  });
  vm.runInContext(source.slice(source.indexOf('function setActivityLogPageSizeTo30('), source.indexOf('// ===== INJECTED: scan the activity-log page for the "Account created" event =====')), context);
  const result = await context.setActivityLogPageSizeTo30();
  assert.equal(result, true);
  assert.equal(selected, '30');
});

test('continue paging through the current activity window before moving to older activity', async () => {
  const calls = [];
  const dummyChrome = {
    scripting: {
      executeScript: async ({ func }) => {
        calls.push(func.name);
        if (func.name === 'clickNextActivityLogPage') return [{ result: calls.length > 2 }];
        return [{ result: { createdDate: null, rowCount: 20 } }];
      }
    }
  };
  const context = vm.createContext({
    chrome: {
      tabs: { update: async () => {} },
      scripting: {
        executeScript: async ({ func }) => {
          calls.push(func.name);
          if (func.name === 'clickNextActivityLogPage') return [{ result: calls.length > 2 }];
          return [{ result: { createdDate: null, rowCount: 20 } }];
        }
      }
    },
    setTimeout: callback => callback(),
    sleep: async () => {},
    waitForTabLoad: async () => {},
    console
  });
  vm.runInContext(source.slice(source.indexOf('function setActivityLogPageSizeTo30('), source.indexOf('function extractAccountCreatedFromActivityLog(')), context);
  vm.runInContext(source.slice(source.indexOf('function clickNextActivityLogPage('), source.indexOf('function extractAccountCreatedFromActivityLog(')), context);
  vm.runInContext(source.slice(source.indexOf('function extractAccountCreatedFromActivityLog('), source.indexOf('// Paginate the activity log backwards in 90-day windows until "Account created" is found.')), context);
  const fn = source.slice(source.indexOf('async function findAccountCreatedDate('), source.indexOf('// ===== Sidebar-side helpers for the reports ====='));
  vm.runInContext(fn, context);
  const result = await context.findAccountCreatedDate({ id: 123 }, 'dev-42');
  assert.equal(result, null);
  assert.ok(calls.includes('clickNextActivityLogPage'));
});

test('accept a WhatsApp community invite link as a valid target', async () => {
  const input = 'https://chat.whatsapp.com/FocviRkWsgr89Tz5DVdy2J';
  const isInvite = /https?:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+/i.test(input);
  assert.equal(isInvite, true);
  const normalized = input.match(/https?:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+/i)[0];
  assert.equal(normalized, 'https://chat.whatsapp.com/FocviRkWsgr89Tz5DVdy2J');
});

test('parse multiple WhatsApp targets from one textarea', () => {
  const sourceText = '+212600000001\n+212600000002\nhttps://chat.whatsapp.com/FocviRkWsgr89Tz5DVdy2J';
  const parsed = sourceText.split(/\r?\n|,|;/).map(v => v.trim()).filter(Boolean).filter(line => /https?:\/\/chat\.whatsapp\.com\//i.test(line) || /\d/.test(line));
  assert.deepEqual(parsed, ['+212600000001', '+212600000002', 'https://chat.whatsapp.com/FocviRkWsgr89Tz5DVdy2J']);
});

test('pick distinct random theme colors from the palette', () => {
  const palette = ['#8BC34A', '#558B2F', '#1565C0', '#FF9800', '#E91E63', '#00BCD4'];
  const context = vm.createContext({ Math, console });
  vm.runInContext(source.slice(source.indexOf('// Theme color palette'), source.indexOf('const generatedPackageNames')), context);
  const result = context.pickRandomPaletteColors(3, palette, () => 0.9);
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 3);
  assert.ok(new Set(result).size === 3);
  assert.ok(result.every(color => palette.includes(color)));
});

test('retry failed app tasks before giving up', async () => {
  const context = vm.createContext({
    Math,
    console,
    setTimeout: callback => callback(),
    chrome: { storage: { local: { set: () => {} } } },
    document: { getElementById: () => null }
  });
  vm.runInContext(source.slice(source.indexOf('// Theme color palette'), source.indexOf('const generatedPackageNames')), context);
  let attempts = 0;
  const result = await context.executeWithRetry('Demo App', async () => {
    attempts += 1;
    if (attempts < 2) throw new Error('temporary failure');
    return 'done';
  }, () => {});
  assert.equal(result, 'done');
  assert.equal(attempts, 2);
});

test('triggerAndWait can skip polling when the backend build has already started', async () => {
  const calls = [];
  const context = vm.createContext({
    Math,
    console,
    setTimeout: callback => callback(),
    crypto: { randomUUID: () => 'test-run-id' },
    fetch: async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
      if (url.includes('/actions/workflows/flutter-build.yml/dispatches')) {
        return { status: 204, json: async () => ({}) };
      }
      throw new Error(`unexpected polling call: ${url}`);
    }
  });
  vm.runInContext(source.slice(source.indexOf('async function triggerAndWait('), source.indexOf('function parseAndroidLauncherManifest(')), context);
  const result = await context.triggerAndWait('token', 'owner/repo', 'flutter-build.yml', 'main', { publish_to_play: 'true' }, 'Build', () => {}, false);
  assert.equal(result, true);
  assert.equal(calls.filter(call => call.url.includes('/dispatches')).length, 1);
  assert.equal(calls.filter(call => call.url.includes('/actions/runs')).length, 0);
});

test('build app queue from publish count and random repo pool', () => {
  const context = vm.createContext({
    console,
    Math,
    crypto: require('node:crypto'),
    document: {
      getElementById: id => {
        const map = {
          appNames: { value: 'Alpha\nBeta' },
          appPublishCount: { value: '4' },
          repoPool: { value: 'owner/repo-a\nowner/repo-b' },
          ghRepo: { value: 'owner/repo-a' },
          randomizeRepoPerApp: { checked: true },
          ghRandomColorsPerApp: { checked: true }
        };
        return map[id] || null;
      }
    },
    chrome: { storage: { local: { set: () => {} } } },
    loadBranchSelector: () => {}
  });
  vm.runInContext(source.slice(source.indexOf('function generateRandomPackageSegment('), source.indexOf('// Per-window state persistence')), context);
  const result = context.buildQueuedApps();
  assert.equal(result.length, 4);
  assert.equal(result[0].name, 'Alpha');
  assert.equal(result[2].name, 'App 3');
  assert.ok(result.every(app => /^(owner\/repo-a|owner\/repo-b)$/.test(app.repo)));
  assert.ok(result.every(app => typeof app.pkg === 'string' && app.pkg.length > 0));
});

async function generateVariant(gradlePath, gradle, existingBranch = false, baseBranchAdvances = false) {
  const originalPackage = 'com.taziggg100.doriac_cecile';
  const files = new Map([
    [gradlePath, gradle],
    ['pubspec.yaml', 'name: doriac_cecile\nflutter_launcher_icons:\n  image_path: assets/icon.png\n'],
    ['lib/main.dart', "import 'package:doriac_cecile/app.dart';\n"],
    ['assets/icon.png', 'icon'],
    ['android/app/src/main/AndroidManifest.xml', '<manifest><application><activity android:name=".MainActivity" /></application></manifest>'],
    ['android/app/src/main/kotlin/com/taziggg100/doriac_cecile/MainActivity.kt', `package ${originalPackage}\nimport io.flutter.embedding.android.FlutterActivity\nclass MainActivity : FlutterActivity()\n`],
    ['android/app/src/androidTest/kotlin/com/example/ExampleInstrumentedTest.kt', 'package com.example\nclass ExampleInstrumentedTest\n'],
    ['android/app/src/test/kotlin/com/example/LocalTest.kt', 'package com.example\nclass LocalTest\n'],
    ['android/app/src/debug/java/com/example/DebugHelper.java', 'package com.example;\nclass DebugHelper {}\n']
  ]);
  const blobs = [...files].map(([path, content], index) => ({ path, content, sha: `source-${index}`, type: 'blob' }));
  const writes = new Map();
  let sequence = 0;
  let committedTree;
  let baseRefReads = 0;
  let sourceTreeRead = false;
  const fetch = async (url, request = {}) => {
    const path = new URL(url).pathname;
    const payload = request.body ? JSON.parse(request.body) : null;
    let data;
    if (path.endsWith('/git/ref/heads/variant') && !request.method) {
      return { ok: existingBranch, status: existingBranch ? 200 : 404, json: async () => ({ object: { sha: 'parent' } }) };
    }
    if (path.includes('/git/trees/') && !payload) {
      if (path.endsWith('/base-tree')) sourceTreeRead = true;
      data = { tree: blobs, truncated: false };
    } else if (path.includes('/git/blobs/') && !payload) {
      const blob = blobs.find(entry => path.endsWith(`/${entry.sha}`));
      assert.ok(blob, `Unexpected blob read: ${path}`);
      data = { content: Buffer.from(blob.content).toString('base64') };
    } else if (path.endsWith('/git/blobs') && payload) {
      const sha = `updated-${sequence++}`;
      writes.set(sha, Buffer.from(payload.content, payload.encoding).toString('utf8'));
      data = { sha };
    } else if (path.includes('/git/ref/heads/')) {
      if (path.endsWith('/main')) {
        baseRefReads++;
        data = { object: { sha: baseBranchAdvances && baseRefReads > 1 ? 'new-parent' : 'parent' } };
      } else {
        data = { object: { sha: 'parent' } };
      }
    } else if (path.endsWith('/git/commits/parent')) {
      data = { tree: { sha: 'base-tree' } };
    } else if (path.endsWith('/git/trees') && payload) {
      committedTree = payload.tree;
      data = { sha: 'new-tree' };
    } else if (path.endsWith('/git/commits') && payload) {
      if (baseBranchAdvances) {
        assert.equal(baseRefReads, 1, 'The base ref must not be re-read after preparation starts.');
        assert.equal(sourceTreeRead, true);
        assert.deepEqual(payload.parents, ['parent'], 'The variant must use the inspected source snapshot.');
      }
      data = { sha: 'new-commit' };
    } else if (path.endsWith('/git/refs') && payload) {
      data = {};
    } else {
      throw new Error(`Unexpected API request: ${path}`);
    }
    return { ok: true, json: async () => data };
  };
  const context = vm.createContext({ fetch, atob, btoa, TextDecoder, TextEncoder, appLogoBase64: null,
    getAndroidMainSourcePaths: alignmentContext.getAndroidMainSourcePaths,
    planFlutterPackageAlignment: alignmentContext.planFlutterPackageAlignment,
    parseAndroidLauncherManifest: content => ({ content, activityName: '.MainActivity', attributeName: 'android:name', manifestPackage: '' }) });
  vm.runInContext(generator, context);
  await context.createFlutterVariant('test-token', 'owner/repo', 'main', 'variant', {
    applicationId: 'com.zvwipesnpmps.doriac_cecile',
    appName: 'DORIAC CECILE',
    primaryColor: '#00695C', secondaryColor: '#004D40', accentColor: '#1565C0'
  });
  return new Map(committedTree.map(entry => [entry.path, entry.sha === null ? null : writes.get(entry.sha)]));
}

test('new variant uses its inspected source snapshot if the base branch advances', async () => {
  const gradle = 'android {\n    namespace = "com.taziggg100.doriac_cecile"\n    defaultConfig {\n        applicationId = "com.taziggg100.doriac_cecile"\n    }\n}\n';
  const updates = await generateVariant('android/app/build.gradle.kts', gradle, false, true);
  assert.ok(updates.has('android/app/build.gradle.kts'));
});

for (const [label, gradlePath, namespace, applicationId] of [
  ['Kotlin DSL', 'android/app/build.gradle.kts', 'namespace = "com.taziggg100.doriac_cecile"', 'applicationId = "com.taziggg100.doriac_cecile"'],
  ['Groovy DSL', 'android/app/build.gradle', "namespace 'com.taziggg100.doriac_cecile'", "applicationId 'com.taziggg100.doriac_cecile'"],
  ['parenthesized Groovy', 'android/app/build.gradle', 'namespace("com.taziggg100.doriac_cecile")', 'applicationId("com.taziggg100.doriac_cecile")']
]) {
  for (const existingBranch of [false, true]) {
    test(`${label}: change applicationId only for ${existingBranch ? 'existing' : 'new'} variant`, async () => {
      const updates = await generateVariant(gradlePath, `android {\n    ${namespace}\n    defaultConfig {\n        ${applicationId}\n    }\n}\n`, existingBranch);
      const updatedGradle = updates.get(gradlePath);
      assert.ok(updatedGradle.includes(namespace));
      assert.ok(updatedGradle.includes(applicationId.replace('com.taziggg100.doriac_cecile', 'com.zvwipesnpmps.doriac_cecile')));
      assert.equal(updates.has('android/app/src/main/AndroidManifest.xml'), false);
      assert.equal(updates.has('android/app/src/main/kotlin/com/taziggg100/doriac_cecile/MainActivity.kt'), false);
      assert.equal(updates.has('android/app/src/main/kotlin/com/zvwipesnpmps/doriaccecile/MainActivity.kt'), false);
    });
  }
}

test('reject a missing or ambiguous applicationId before any commit', async () => {
  const namespace = 'com.taziggg100.doriac_cecile';
  await assert.rejects(generateVariant('android/app/build.gradle.kts', `android {\n    namespace = "${namespace}"\n}\n`), /applicationId \(0 matches\)/);
  await assert.rejects(generateVariant('android/app/build.gradle.kts', `android {\n    namespace = "${namespace}"\n    defaultConfig {\n        applicationId = "com.example.app"\n        applicationId = "com.example.other"\n    }\n}\n`), /applicationId \(2 matches\)/);
});

test('generated workflow enforces the required Android signing secrets', async () => {
  const workflow = await generatedWorkflow('main');
  const required = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'ANDROID_STORE_PASSWORD'];
  for (const name of required) {
    assert.match(workflow, new RegExp(`\\$\\{\\{ secrets\\.${name} \\}\\}`), `workflow should reference ${name}`);
    assert.ok(workflow.includes(`for name in ${required.join(' ')}`), 'workflow should validate all required secret names');
  }
});

async function generatedWorkflow(targetBranch = null) {
  let workflow;
  const fetch = async (url, request = {}) => {
    if (request.method === 'PUT') {
      const payload = JSON.parse(request.body);
      assert.equal(payload.branch, targetBranch || 'main');
      workflow = Buffer.from(payload.content, 'base64').toString('utf8');
      return { ok: true, json: async () => ({}) };
    }
    if (url.includes('/actions/secrets')) {
      return { ok: true, json: async () => ({ secrets: ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'ANDROID_STORE_PASSWORD'].map(name => ({ name })) }) };
    }
    if (url.includes('/contents/')) return { ok: false, status: 404 };
    return { ok: true, json: async () => ({ default_branch: 'main' }) };
  };
  const context = vm.createContext({ fetch, btoa });
  vm.runInContext(source.slice(source.indexOf('async function ensureFlutterBuildWorkflow('), source.indexOf('function generateFlutterAppIcon(')), context);
  await context.ensureFlutterBuildWorkflow('test-token', 'owner/repo', false, targetBranch);
  return workflow;
}

async function versionCounter(initialValue = null, pubspec = 'version: 1.0.0+1\n', historicalRuns = []) {
  const workflow = await generatedWorkflow();
  const script = workflow.split('          script: |\n')[1].split('      - name: Build signed Android App Bundle')[0]
    .split('\n').map(line => line.slice(12)).join('\n');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const reserve = new AsyncFunction('github', 'context', 'core', script);
  let value = initialValue;
  let sha = 'counter-sha';
  const writes = [];
  const exported = [];
  const github = {
    rest: {
      repos: {
        getContent: async ({ path }) => {
          const content = path === 'pubspec.yaml' ? pubspec : value;
          if (content === null) throw Object.assign(new Error('Not found'), { status: 404 });
          return { data: { type: 'file', sha, content: Buffer.from(content).toString('base64') } };
        },
        createOrUpdateFileContents: async (request) => {
          if (value !== null) assert.equal(request.sha, sha);
          else assert.equal(request.sha, undefined);
          value = Buffer.from(request.content, 'base64').toString('utf8');
          sha += '-next';
          writes.push(request);
        }
      },
      actions: { listWorkflowRuns: async () => {} }
    },
    paginate: async () => historicalRuns
  };
  const context = { repo: { owner: 'owner', repo: 'repo' }, ref: 'refs/heads/com.example.app', runId: 100 };
  const core = { exportVariable: (name, number) => exported.push({ name, number }), info: () => {} };
  return { workflow, reserve: () => reserve(github, context, core), writes, exported, context, github };
}

test('reserve +1 on each build and rerun using a branch-specific persisted counter', async () => {
  const counter = await versionCounter();
  await counter.reserve();
  await counter.reserve();
  counter.context.runId++;
  await counter.reserve();
  assert.deepEqual(counter.exported.map(entry => entry.number), ['2', '3', '4']);
  assert.ok(counter.writes.every(request => request.branch === 'com.example.app'));
  assert.ok(counter.writes.every(request => request.path === '.github/android-version-code.txt'));
  assert.ok(counter.workflow.includes('contents: write'));
  assert.ok(counter.workflow.includes('actions: read'));
  assert.ok(counter.workflow.includes('cancel-in-progress: false'));
  assert.ok(counter.workflow.includes('flutter build appbundle --release --build-number "$BUILD_NUMBER"'));
  assert.ok(!counter.workflow.includes('BUILD_NUMBER: ${{ github.run_number }}'));
});

test('initialize above previous workflow numbers, excluding the current run', async () => {
  const counter = await versionCounter(null, 'version: 1.0.0+3\n', [{ id: 99, run_number: 8 }, { id: 100, run_number: 20 }]);
  await counter.reserve();
  await counter.reserve();
  assert.deepEqual(counter.exported.map(entry => entry.number), ['9', '10']);
});

test('existing counter advances exactly +1 independent of workflow run numbers', async () => {
  const counter = await versionCounter('40\n', 'version: 1.0.0+1\n', [{ id: 99, run_number: 200 }]);
  await counter.reserve();
  assert.equal(counter.exported[0].number, '41');
});

test('reject invalid counters, exhausted codes, missing build suffix and tag builds', async () => {
  for (const value of ['invalid', '-1', '2100000000', '9007199254740993']) {
    const counter = await versionCounter(value);
    await assert.rejects(counter.reserve(), /counter|allowed range/);
    assert.equal(counter.writes.length, 0);
  }
  const missingSuffix = await versionCounter(null, 'version: 1.0.0\n');
  await assert.rejects(missingSuffix.reserve(), /numeric build suffix/);
  const tag = await versionCounter();
  tag.context.ref = 'refs/tags/v1.0.0';
  await assert.rejects(tag.reserve(), /branch, not a tag/);
});

test('do not export a build number if the counter reservation conflicts', async () => {
  const counter = await versionCounter('2\n');
  counter.github.rest.repos.createOrUpdateFileContents = async () => { throw Object.assign(new Error('Conflict'), { status: 409 }); };
  await assert.rejects(counter.reserve(), /Conflict/);
  assert.equal(counter.exported.length, 0);
});

const updateContext = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function parseUpdatePackages('), source.indexOf('async function inspectProjectForVariant(')), updateContext);
const activitySources = [{ path: 'android/app/src/main/kotlin/com/original/app/MainActivity.kt', content: 'package com.original.app\nclass MainActivity : FlutterActivity()\n' }];

test('update packages reject invalid entries and deduplicate without inventing packages', () => {
  assert.deepEqual(Array.from(updateContext.parseUpdatePackages('com.example.app\ncom.example.app\ncom.other.app')), ['com.example.app', 'com.other.app']);
  assert.throws(() => updateContext.parseUpdatePackages(''), /at least one/);
  assert.throws(() => updateContext.parseUpdatePackages('App|com.example.app'), /Invalid/);
  assert.throws(() => updateContext.parseUpdatePackages(Array.from({ length: 21 }, (_, index) => `com.example.app${index}`).join('\n')), /at most 20/);
});

test('diagnose namespace mismatch and preserve already valid launcher references', () => {
  const mismatch = updateContext.resolveUpdateLauncher('com.variant.app', '.MainActivity', activitySources);
  assert.equal(mismatch.needsFix, true);
  assert.equal(mismatch.qualifiedName, 'com.original.app.MainActivity');
  assert.equal(updateContext.resolveUpdateLauncher('com.original.app', '.MainActivity', activitySources).needsFix, false);
  assert.equal(updateContext.resolveUpdateLauncher('com.variant.app', 'com.original.app.MainActivity', activitySources).needsFix, false);
  const javaSource = [{ path: 'MainActivity.java', content: 'package com.original.app;\npublic class MainActivity extends FlutterActivity {}' }];
  assert.equal(updateContext.resolveUpdateLauncher('com.variant.app', 'MainActivity', javaSource).qualifiedName, 'com.original.app.MainActivity');
});

test('block missing, ambiguous, malformed and unsupported launcher classes', () => {
  assert.throws(() => updateContext.resolveUpdateLauncher('com.variant.app', '.MainActivity', []), /missing or ambiguous/);
  assert.throws(() => updateContext.resolveUpdateLauncher('com.variant.app', '.MainActivity', [...activitySources, ...activitySources]), /ambiguous/);
  assert.throws(() => updateContext.resolveUpdateLauncher('', '.MainActivity', activitySources), /literal namespace/);
  assert.throws(() => updateContext.resolveUpdateLauncher('com.variant.app', '.OtherActivity', activitySources), /Unsupported/);
  assert.throws(() => updateContext.resolveUpdateLauncher('com.variant.app', '.MainActivity', [{ path: 'MainActivity.kt', content: 'class MainActivity' }]), /Could not identify/);
});

test('accept unrelated Android components and custom Application while preserving the launcher', () => {
  const parsed = manifestContext.parseAndroidLauncherManifest('<manifest custom-components />');
  assert.equal(parsed.activityName, '.MainActivity');
  assert.doesNotThrow(() => manifestContext.validateAndroidLauncherOverlay('<manifest overlay-no-launcher />', 'android/app/src/debug/AndroidManifest.xml'));
  assert.throws(() => manifestContext.validateAndroidLauncherOverlay('<manifest custom-components />', 'android/app/src/release/AndroidManifest.xml'), /launcher override/);
  assert.throws(() => manifestContext.parseAndroidLauncherManifest('<manifest invalid-xml />'), /Invalid Android manifest XML/);
});

test('update workflow can be installed on an existing branch and preserve the Play listing', async () => {
  const workflow = await generatedWorkflow('com.example.app');
  assert.ok(workflow.includes('      upload_listing:'));
  assert.ok(workflow.includes('--skip_upload_metadata true --skip_upload_images true --skip_upload_screenshots true'));
  assert.ok(workflow.includes('inputs.publish_to_play && inputs.upload_listing != false'));
  assert.ok(workflow.includes('--release_status draft'));
  assert.ok(workflow.includes('      source_commit:'));
  assert.ok(workflow.includes('ref: ${{ inputs.source_commit || github.ref }}'));
  assert.ok(workflow.includes('      - name: Validate Android launcher package'));
  assert.ok(workflow.includes('declared.group(1) != namespace'));
  assert.ok(!workflow.includes('namespace != package.replace'));
  assert.ok(workflow.indexOf('Validate Android launcher package') < workflow.indexOf('Reserve next Android versionCode'));
  assert.ok(workflow.indexOf('Validate Android launcher package') < workflow.indexOf('Build signed Android App Bundle'));
});

test('computed namespaces block automatic variant alignment before a commit', async () => {
  await assert.rejects(generateVariant('android/app/build.gradle.kts', 'android {\n namespace = provider.get()\n applicationId = "com.original.app"\n}\n'), /uniquely read namespace/);
});

function preparationContext(inspections) {
  const writes = [];
  const workflows = [];
  const context = vm.createContext({
    btoa,
    inspectExistingFlutterUpdate: async () => {
      assert.ok(inspections.length, 'Unexpected inspection');
      return inspections.shift();
    },
    updateGitHubRequest: async (...request) => { writes.push(request); return {}; },
    commitFlutterPackageAlignment: async (token, item) => { writes.push({ token, item }); return 'aligned'; },
    ensureFlutterBuildWorkflow: async (...request) => { workflows.push(request); return request[3] || 'main'; }
  });
  vm.runInContext(source.slice(source.indexOf('async function prepareExistingFlutterUpdate('), source.indexOf('function initializeExistingAppUpdates(')), context);
  return { prepare: item => context.prepareExistingFlutterUpdate('token', item, () => {}), writes, workflows };
}

test('stale inspection prevents all corrections and workflow writes', async () => {
  const context = preparationContext([{ headSha: 'new-head' }]);
  await assert.rejects(context.prepare({ repo: 'owner/repo', packageName: 'com.example.app', headSha: 'old-head' }), /branch changed/);
  assert.equal(context.writes.length, 0);
  assert.equal(context.workflows.length, 0);
});

test('prepare only the approved launcher correction and verify it before returning', async () => {
  const item = { repo: 'owner/repo', packageName: 'com.example.app', branch: 'com.example.app', headSha: 'head' };
  const current = { headSha: 'head', launcher: { needsFix: true, qualifiedName: 'com.original.app.MainActivity' }, manifestPath: 'android/app/src/main/AndroidManifest.xml', manifestSha: 'manifest-sha', correctedManifest: '<manifest />' };
  const context = preparationContext([current, { launcher: { needsFix: false }, headSha: 'verified' }]);
  const result = await context.prepare(item);
  assert.equal(result.headSha, 'verified');
  assert.equal(context.writes.length, 1);
  assert.equal(context.writes[0].item.headSha, 'head');
  assert.equal(context.writes[0].item.branch, item.branch);
  assert.equal(context.workflows.length, 2);
  assert.equal(context.workflows[1][3], item.branch);
});

test('valid launchers are not rewritten and failed repair verification blocks dispatch', async () => {
  const item = { repo: 'owner/repo', packageName: 'com.example.app', branch: 'main', headSha: 'head' };
  const context = preparationContext([{ headSha: 'head', launcher: { needsFix: false } }, { launcher: { needsFix: true } }]);
  await assert.rejects(context.prepare(item), /Launcher verification failed/);
  assert.equal(context.writes.length, 0);
});

test('track only the requested update run, including a run that already completed', async () => {
  const requests = [];
  const history = [];
  const context = vm.createContext({
    recordBuildHistory: async update => history.push(update),
    setTimeout: callback => callback(),
    fetch: async (url, request = {}) => {
      requests.push({ url, request });
      if (url.endsWith('/dispatches')) return { status: 204 };
      if (url.includes('/runs?')) return { json: async () => ({ workflow_runs: [
        { id: 11, display_title: 'Flutter AAB old-request', status: 'in_progress', head_branch: 'com.example.app', path: '.github/workflows/flutter-build.yml' },
        { id: 22, display_title: 'Flutter AAB update-request', status: 'completed', head_branch: 'com.example.app', path: '.github/workflows/flutter-build.yml' }
      ] }) };
      assert.ok(url.endsWith('/runs/22'));
      return { json: async () => ({ status: 'completed', conclusion: 'success' }) };
    }
  });
  vm.runInContext(source.slice(source.indexOf('async function triggerAndWait('), source.indexOf('function parseUpdatePackages(')), context);
  const inputs = { publish_to_play: 'true', upload_listing: 'false', track: 'beta', request_id: 'update-request' };
  assert.equal(await context.triggerAndWait('token', 'owner/repo', 'flutter-build.yml', 'com.example.app', inputs, 'Update', () => {}), true);
  assert.deepEqual(JSON.parse(requests[0].request.body).inputs, inputs);
  assert.ok(requests.some(request => request.url.includes('branch=com.example.app&event=workflow_dispatch')));
  assert.ok(!requests.some(request => request.url.endsWith('/runs/11')));
  assert.deepEqual(history.map(entry => entry.status), ['queued', 'running', 'completed']);
  assert.ok(history.every(entry => entry.key === 'update-request'));
});

function discoveryContext(emptyRepositoryError) {
  const requests = [];
  const inspected = [];
  const context = vm.createContext({
    fetch: async () => ({ ok: true, json: async () => ['empty', 'unmatched', 'valid'].map(name => ({ full_name: `owner/${name}`, default_branch: 'main', permissions: { push: true } })) }),
    updateGitHubRequest: async (token, repo, path, method, payload) => {
      requests.push({ repo, path, method, payload });
      if (repo === 'owner/empty') throw emptyRepositoryError;
      if (repo === 'owner/unmatched') throw Object.assign(new Error('Not found'), { status: 404 });
      return { object: { sha: 'head' } };
    },
    inspectExistingFlutterUpdate: async (token, repo, packageName) => {
      inspected.push({ repo, packageName });
      return { branch: packageName, headSha: 'head', launcher: { needsFix: false } };
    }
  });
  vm.runInContext(source.slice(source.indexOf('async function findExistingFlutterUpdates('), source.indexOf('async function prepareExistingFlutterUpdate(')), context);
  return { discover: (packages, log) => context.findExistingFlutterUpdates('token', packages, log), requests, inspected };
}

test('skip GitHub empty-repository conflicts and continue discovering valid app branches', async () => {
  const context = discoveryContext(Object.assign(new Error('Git Repository is empty.'), { status: 409 }));
  const logs = [];
  const rows = await context.discover(['com.example.app', 'com.other.app'], message => logs.push(message));
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.ready && row.repo === 'owner/valid'));
  assert.equal(context.requests.filter(request => request.repo === 'owner/empty').length, 1);
  assert.equal(context.inspected.length, 2);
  assert.ok(logs.includes('Skipping empty repository: owner/empty'));
  assert.ok(context.requests.every(request => methodIsReadOnly(request)));
});

function methodIsReadOnly(request) {
  return (!request.method || request.method === 'GET') && request.payload === undefined;
}

test('do not suppress authentication, quota, server, or unrelated conflict errors during discovery', async () => {
  for (const status of [401, 403, 409, 429, 500]) {
    const context = discoveryContext(Object.assign(new Error('Unexpected GitHub failure'), { status }));
    await assert.rejects(context.discover(['com.example.app'], () => {}), error => error.status === status);
    assert.equal(context.inspected.length, 0);
  }
});

test('history preserves job identity, stores latest status, and retains at most 100 builds', () => {
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function mergeBuildHistory('), source.indexOf('function renderBuildHistory(')), context);
  const started = context.mergeBuildHistory([], { key: 'job', label: 'App', repo: 'owner/repo', branch: 'com.example.app', status: 'queued' });
  const completed = context.mergeBuildHistory(started, { key: 'job', runId: 42, status: 'completed' });
  assert.equal(completed.length, 1);
  assert.equal(completed[0].label, 'App');
  assert.equal(completed[0].repo, 'owner/repo');
  assert.equal(completed[0].startedAt, started[0].startedAt);
  assert.equal(completed[0].status, 'completed');
  let entries = [];
  for (let index = 0; index < 101; index++) entries = context.mergeBuildHistory(entries, { key: `job-${index}` });
  assert.equal(entries.length, 100);
  assert.equal(entries[0].key, 'job-100');
});

function alignmentFixture(language = 'kotlin') {
  const extension = language === 'kotlin' ? 'kt' : 'java';
  const path = `android/app/src/main/${language}/com/original/app/MainActivity.${extension}`;
  const content = language === 'kotlin'
    ? 'package com.original.app\n\nimport io.flutter.embedding.android.FlutterActivity\n\nclass MainActivity : FlutterActivity()\n'
    : 'package com.original.app;\nimport io.flutter.embedding.android.FlutterActivity;\npublic class MainActivity extends FlutterActivity {}\n';
  return { gradle: 'android {\n namespace = "com.original.app"\n defaultConfig {\n applicationId = "com.original.app"\n }\n}\n', source: { path, content },
    manifest: { content: '<activity android:name="com.original.app.MainActivity" />', activityName: 'com.original.app.MainActivity', attributeName: 'android:name', manifestPackage: '' } };
}

for (const language of ['kotlin', 'java']) {
  test(`align standard ${language} launcher, namespace, manifest and source path as one plan`, () => {
    const fixture = alignmentFixture(language);
    const plan = alignmentContext.planFlutterPackageAlignment('com.variant.app', 'android/app/build.gradle.kts', fixture.gradle, [fixture.source], fixture.manifest, new Set([fixture.source.path]));
    assert.equal(plan.updates.has(fixture.source.path), false);
    assert.equal(plan.updates.has(plan.targetPath), false);
    assert.ok(plan.updates.get('android/app/build.gradle.kts').includes('namespace = "com.original.app"'));
    assert.ok(plan.updates.get('android/app/build.gradle.kts').includes('applicationId = "com.variant.app"'));
    assert.equal(plan.updates.has('android/app/src/main/AndroidManifest.xml'), false);
    assert.equal(plan.namespace, 'com.original.app');
    assert.equal(plan.qualifiedName, 'com.original.app.MainActivity');
    const repeated = alignmentContext.planFlutterPackageAlignment('com.variant.app', 'android/app/build.gradle.kts', plan.updates.get('android/app/build.gradle.kts'), [fixture.source], fixture.manifest, new Set([fixture.source.path]));
    assert.equal(repeated.updates.size, 0);
  });
}

test('package alignment preserves custom MainActivity code and rejects unsafe package layouts', () => {
  const fixture = alignmentFixture();
  const plan = (gradle, sources, paths = new Set()) => alignmentContext.planFlutterPackageAlignment('com.variant.app', 'android/app/build.gradle.kts', gradle, sources, fixture.manifest, paths);
  const customized = plan(fixture.gradle, [{ ...fixture.source, content: fixture.source.content + '\nfun customFunction() {}\n' }]);
  assert.ok(customized.updates.get('android/app/build.gradle.kts').includes('applicationId = "com.variant.app"'));
  assert.equal(customized.updates.has(fixture.source.path), false);
  assert.throws(() => plan(fixture.gradle, []), /MainActivity is missing or ambiguous/);
  assert.throws(() => plan(fixture.gradle, [fixture.source, fixture.source]), /MainActivity is missing or ambiguous/);
  assert.throws(() => plan(fixture.gradle.replace('namespace = "com.original.app"', 'namespace = provider.get()'), [fixture.source]), /uniquely read namespace/);
  assert.throws(() => plan(fixture.gradle.replace('com.original.app', 'com.other.app'), [fixture.source]), /does not match MainActivity package/);
  assert.throws(() => plan(fixture.gradle, [{ ...fixture.source, path: fixture.source.path.replace('/com/original/app/', '/com/other/app/') }]), /path does not match the preserved namespace/);
  assert.throws(() => plan(fixture.gradle + '\nproductFlavors {}', [fixture.source]), /flavors/);
});

test('launcher discovery ignores debug and test source sets but includes all production sources', () => {
  const paths = [
    'android/app/src/main/kotlin/com/example/MainActivity.kt',
    'android/app/src/main/java/com/example/NativeHelper.java',
    'android/app/src/androidTest/kotlin/com/example/InstrumentedTest.kt',
    'android/app/src/test/kotlin/com/example/LocalTest.kt',
    'android/app/src/debug/java/com/example/DebugHelper.java'
  ];
  assert.deepEqual(Array.from(alignmentContext.getAndroidMainSourcePaths(paths)), paths.slice(0, 2));
});

for (const language of ['kotlin', 'java']) {
  test(`preserve the ${language} namespace when applicationId contains underscores`, () => {
    const fixture = alignmentFixture(language);
    const applicationId = 'com.example.my_app';
    const plan = alignmentContext.planFlutterPackageAlignment(applicationId, 'android/app/build.gradle.kts', fixture.gradle, [fixture.source], fixture.manifest, new Set([fixture.source.path]));
    const updatedGradle = plan.updates.get('android/app/build.gradle.kts');
    assert.ok(updatedGradle.includes('applicationId = "com.example.my_app"'));
    assert.ok(updatedGradle.includes('namespace = "com.original.app"'));
    assert.equal(plan.applicationId, applicationId);
    assert.equal(plan.namespace, 'com.original.app');
    assert.equal(plan.targetPath, fixture.source.path);
    assert.equal(plan.qualifiedName, 'com.original.app.MainActivity');
    assert.equal(plan.updates.has(fixture.source.path), false);
    assert.equal(plan.updates.has('android/app/src/main/AndroidManifest.xml'), false);
    const repeated = alignmentContext.planFlutterPackageAlignment(applicationId, 'android/app/build.gradle.kts', updatedGradle, [fixture.source], fixture.manifest, new Set([fixture.source.path]));
    assert.equal(repeated.updates.size, 0);
  });
}

test('atomic alignment commits additions, changes and removals in one non-forced ref update', async () => {
  const requests = [];
  const context = vm.createContext({ btoa, updateGitHubRequest: async (token, repo, path, method, payload) => {
    requests.push({ path, method, payload });
    if (path.startsWith('git/commits/') && !method) return { tree: { sha: 'base-tree' } };
    if (path === 'git/blobs') return { sha: `blob-${requests.length}` };
    if (path === 'git/trees') return { sha: 'aligned-tree' };
    if (path === 'git/commits') return { sha: 'aligned-commit' };
    if (path.startsWith('git/refs/') && !method) return { object: { sha: 'head' } };
    return {};
  } });
  vm.runInContext(source.slice(source.indexOf('async function commitFlutterPackageAlignment('), source.indexOf('async function prepareExistingFlutterUpdate(')), context);
  const updates = new Map([['old/MainActivity.kt', null], ['new/MainActivity.kt', 'package com.example.app'], ['AndroidManifest.xml', '<manifest />']]);
  assert.equal(await context.commitFlutterPackageAlignment('token', { repo: 'owner/repo', branch: 'com.example.app', headSha: 'head', alignment: { updates } }), 'aligned-commit');
  const tree = requests.find(request => request.path === 'git/trees').payload;
  assert.equal(tree.tree.length, 3);
  assert.equal(tree.tree[0].sha, null);
  const refWrites = requests.filter(request => request.method === 'PATCH');
  assert.equal(refWrites.length, 1);
  assert.equal(refWrites[0].payload.force, false);
  assert.equal(refWrites[0].payload.sha, 'aligned-commit');
});

test('concurrent branch movement prevents publishing an alignment commit', async () => {
  const writes = [];
  const context = vm.createContext({ btoa, updateGitHubRequest: async (token, repo, path, method, payload) => {
    if (method === 'PATCH') writes.push(payload);
    if (path.startsWith('git/commits/') && !method) return { tree: { sha: 'base' } };
    if (path.startsWith('git/refs/')) return { object: { sha: 'other-head' } };
    return { sha: 'prepared' };
  } });
  vm.runInContext(source.slice(source.indexOf('async function commitFlutterPackageAlignment('), source.indexOf('async function prepareExistingFlutterUpdate(')), context);
  await assert.rejects(context.commitFlutterPackageAlignment('token', { repo: 'owner/repo', branch: 'app', headSha: 'head', alignment: { updates: new Map() } }), /branch changed/);
  assert.equal(writes.length, 0);
});