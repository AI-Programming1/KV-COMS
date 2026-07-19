/* =========================
   CONFIG
========================= */

const WORKER_URL = "https://subdomain.cloudflare-worker.workers.dev";
const POLL_INTERVAL = 5000;

/* =========================
   HELPERS
========================= */

function api(path) {
  return `${WORKER_URL}${path}`;
}

function loadAccount() {
  const raw = localStorage.getItem("account");
  if (!raw) {
    window.location.href = "/index.html";
    return null;
  }
  return JSON.parse(raw);
}

const account = loadAccount();

/* =========================
   SESSION INIT
========================= */

document.addEventListener("DOMContentLoaded", () => {
  if (!account) return;

  startInboxPolling();
});

/* =========================
   HANDLE RESOLUTION
========================= */

async function resolveHandle(handle) {
  const res = await fetch(
    api(`/resolve?handle=${encodeURIComponent(handle)}`)
  );

  if (!res.ok) {
    throw new Error("User not found");
  }

  return res.json();
}

/* =========================
   MESSAGE SEND
========================= */

async function sendMessage(toHandle, encryptedPayload) {
  const { viewKey } = await resolveHandle(toHandle);

  const res = await fetch(api("/message"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: viewKey,
      payload: encryptedPayload
    })
  });

  if (!res.ok) {
    throw new Error("Failed to send message");
  }
}

/* =========================
   INBOX
========================= */

async function fetchInbox() {
  const res = await fetch(
    api(`/inbox?viewKey=${encodeURIComponent(account.viewKey)}`)
  );

  if (!res.ok) return [];

  return res.json();
}

async function startInboxPolling() {
  await refreshInbox();

  setInterval(async () => {
    await refreshInbox();
  }, POLL_INTERVAL);
}

async function refreshInbox() {
  try {
    const messages = await fetchInbox();
    renderInbox(messages);
  } catch (err) {
    console.error("Inbox refresh failed", err);
  }
}

/* =========================
   UI RENDERING
========================= */

function renderInbox(messages) {
  const list = document.getElementById("messageList");
  if (!list) return;

  list.innerHTML = "";

  messages.forEach((msg, index) => {
    const item = document.createElement("div");
    item.className = "message-item";
    item.textContent = `Encrypted message #${index + 1}`;
    item.onclick = () => openConversation(msg);
    list.appendChild(item);
  });
}

function openConversation(message) {
  const panel = document.getElementById("conversation");
  panel.textContent = JSON.stringify(message, null, 2);
}

/* =========================
   SETTINGS ACTIONS
========================= */

async function deleteAllMessages() {
  const res = await fetch(api("/delete-messages"), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      viewKey: account.viewKey
    })
  });

  if (!res.ok) {
    alert("Failed to delete messages");
    return;
  }

  renderInbox([]);
}

async function deleteAccount() {
  const confirmed = confirm(
    "This will permanently delete your account and all messages. Continue?"
  );

  if (!confirmed) return;

  const res = await fetch(api("/delete-account"), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      viewKey: account.viewKey,
      handle: account.handle
    })
  });

  if (!res.ok) {
    alert("Account deletion failed");
    return;
  }

  localStorage.clear();
  sessionStorage.clear();
  window.location.href = "/index.html";
}

/* =========================
   FORM BINDINGS
========================= */

const sendForm = document.getElementById("sendForm");
if (sendForm) {
  sendForm.addEventListener("submit", async e => {
    e.preventDefault();

    const to = document.getElementById("toHandle").value;
    const message = document.getElementById("messageText").value;

    try {
      // Placeholder: encrypt before sending
      const encryptedPayload = btoa(message);

      await sendMessage(to, encryptedPayload);
      sendForm.reset();
    } catch (err) {
      alert(err.message);
    }
  });
}
