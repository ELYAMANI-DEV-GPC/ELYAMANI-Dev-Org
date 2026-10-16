// save-session.js — ONE-TIME manual step.
// Opens a visible browser, you log in to Google / Play Console (2FA included),
// then press Enter here. Cookies are saved to play-console-auth.json (gitignored).
const { chromium } = require('playwright');
const readline = require('readline');

const AUTH_FILE = 'play-console-auth.json';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'en-US'
  });
  const page = await context.newPage();
  await page.goto('https://play.google.com/console');

  console.log('=================================================');
  console.log('1. Connectez-vous à votre compte Google.');
  console.log('2. Attendez de voir le tableau de bord Play Console.');
  console.log('3. Revenez ici et appuyez sur Entrée.');
  console.log('=================================================');

  await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Appuyez sur Entrée une fois connecté... ', () => { rl.close(); resolve(); });
  });

  await context.storageState({ path: AUTH_FILE });
  console.log(`✅ Session sauvegardée dans ${AUTH_FILE}`);
  console.log('⚠️  Ne committez JAMAIS ce fichier (déjà dans .gitignore).');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
