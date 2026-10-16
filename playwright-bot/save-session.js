// save-session.js — ONE-TIME manual step.
// Opens a persistent Chrome profile (chrome-bot-profile/) on Play Console.
// Log in once (2FA included), then press Enter here.
// The profile keeps your session — later runs are fully headless.
const { chromium } = require('playwright');
const readline = require('readline');
const path = require('path');

const PROFILE_DIR = path.join(__dirname, 'chrome-bot-profile');

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome', // use installed Google Chrome (less bot-like than bundled chromium)
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    args: ['--disable-blink-features=AutomationControlled']
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://play.google.com/console');

  console.log('=================================================');
  console.log('1. Connectez-vous à votre compte Google dans la fenetre.');
  console.log('2. Attendez de voir le tableau de bord Play Console.');
  console.log('3. Revenez ici et appuyez sur Entree.');
  console.log('=================================================');

  await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Appuyez sur Entree une fois connecte... ', () => { rl.close(); resolve(); });
  });

  await context.close();
  console.log('✅ Session sauvegardee dans chrome-bot-profile/');
  console.log('⚠️  Ce dossier ne doit JAMAIS etre commite (deja dans .gitignore).');
})().catch((e) => { console.error(e); process.exit(1); });
