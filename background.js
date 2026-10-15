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
