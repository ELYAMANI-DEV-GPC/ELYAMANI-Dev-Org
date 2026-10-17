// Side panel available on every tab; toolbar click opens it (Chrome handles unsupported pages).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

async function enableSidePanelForTab(tabId) {
  await chrome.sidePanel.setOptions({
    tabId,
    path: 'sidebar.html',
    enabled: true,
  });
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'complete') {
    enableSidePanelForTab(tabId).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    await enableSidePanelForTab(tabId);
  } catch (_) {}
});

// ── WhatsApp auto-send (runs in background so the Play Console tab keeps focus) ──
// The side panel sends { type: 'wa-send', phone, text }; we open a background tab,
// inject the auto-clicker, and report back. The console tab is never unfocused.
function autoClickWhatsAppSend() {
  return new Promise((resolve) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    (async () => {
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
      const COMPOSER_FOOTER = 'footer button, footer [role="button"], #main footer [data-icon]';
      for (let w = 0; w < 90; w++) {
        for (const sel of SEND_SELECTORS) {
          const btn = document.querySelector(sel);
          if (btn) {
            const clickable = btn.closest('button, [role="button"], div') || btn;
            clickable.click();
            btn.click();
            resolve({ sent: true, selector: sel });
            return;
          }
        }
        const footerBtns = document.querySelectorAll(COMPOSER_FOOTER);
        if (footerBtns.length) {
          const last = footerBtns[footerBtns.length - 1];
          const clickable = last.closest('button, [role="button"], div') || last;
          clickable.click();
          last.click();
          resolve({ sent: true, selector: 'composer-footer-fallback' });
          return;
        }
        const composer = document.querySelector('[contenteditable="true"][data-tab="10"], #main [contenteditable="true"], div[contenteditable="true"][title]');
        if (composer) {
          composer.focus();
          for (const type of ['keydown', 'keypress', 'keyup']) {
            composer.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
          }
          resolve({ sent: true, selector: 'enter-key-fallback' });
          return;
        }
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'wa-send') return false;
  (async () => {
    const digits = (msg.phone || '').replace(/[^0-9]/g, '');
    if (!digits) { sendResponse({ opened: false, sent: false, error: 'no-number' }); return; }
    const url = `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(msg.text || '')}`;
    let tab = null;
    try {
      tab = await chrome.tabs.create({ url, active: false }); // background tab — console keeps focus
    } catch (e) {
      sendResponse({ opened: false, sent: false, error: 'popup-blocked' });
      return;
    }
    if (!tab || !tab.id) { sendResponse({ opened: true, sent: false, error: 'no-tab-handle' }); return; }

    for (let attempt = 0; attempt < 24; attempt++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const info = await chrome.tabs.get(tab.id);
        if (info.status !== 'complete') continue;
        const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: autoClickWhatsAppSend });
        const r = result && result[0] && result[0].result;
        if (r && r.sent) {
          await new Promise(r2 => setTimeout(r2, 2500));
          try { chrome.tabs.remove(tab.id); } catch (_) {}
          sendResponse({ opened: true, sent: true });
          return;
        }
        if (r && r.error && r.error !== 'timeout') {
          try { chrome.tabs.remove(tab.id); } catch (_) {}
          sendResponse({ opened: true, sent: false, error: r.error });
          return;
        }
      } catch (_) {
        sendResponse({ opened: true, sent: false, error: 'tab-closed' });
        return;
      }
    }
    sendResponse({ opened: true, sent: false, error: 'timeout' });
  })();
  return true; // async response
});
