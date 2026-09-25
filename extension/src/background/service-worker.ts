/**
 * MV3 service worker entry point.
 *
 * Chrome may suspend this worker at any time, so connection state lives in the
 * Bridge instance and is rebuilt lazily on alarms, startup and install. The
 * worker only coordinates; the content script owns the page.
 */
import { Bridge } from "./bridge.js";

const bridge = new Bridge();

chrome.runtime.onInstalled.addListener(() => {
  void bridge.start();
});

chrome.runtime.onStartup.addListener(() => {
  void bridge.start();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const typed = message as { type?: string } | undefined;
  if (typed?.type === "remora.popup.status") {
    void bridge.getStatus().then(sendResponse);
    return true;
  }
  if (typed?.type === "remora.popup.reconnect") {
    void bridge
      .reconnect()
      .then(() => bridge.getStatus())
      .then(sendResponse);
    return true;
  }
  return false;
});

void bridge.start();
