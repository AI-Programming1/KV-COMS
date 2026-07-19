const WORKER_URL = "https://subdomain.cloudflare-worker.workers.dev";

async function generateKeys(password) {
  // Generate ECDH keypair
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "X25519" },
    true,
    ["deriveKey"]
  );

  const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privateKeyRaw = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  // Derive encryption key from password
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 150000,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedPrivateKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encryptionKey,
    privateKeyRaw
  );

  // View key = public routing identifier
  const viewKey = crypto.randomUUID();

  return {
    viewKey,
    publicKey: btoa(String.fromCharCode(...new Uint8Array(publicKeyRaw))),
    encryptedPrivateKey: Array.from(new Uint8Array(encryptedPrivateKey)),
    salt: Array.from(salt),
    iv: Array.from(iv)
  };
}

document.getElementById("registerForm").addEventListener("submit", async e => {
  e.preventDefault();

  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  const handle = document.getElementById("handle").value;
  const banner = document.getElementById("banner");

  try {
    // Generate keys client-side
    const keys = await generateKeys(password);

    // Store private materials locally ONLY
    localStorage.setItem(
      "account",
      JSON.stringify({
        username, // operator-only secret
        encryptedPrivateKey: keys.encryptedPrivateKey,
        salt: keys.salt,
        iv: keys.iv,
        viewKey: keys.viewKey
      })
    );

    // Send only public data to Worker
    const res = await fetch(`${WORKER_URL}/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        handle,
        viewKey: keys.viewKey,
        publicKey: keys.publicKey
      })
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }

    banner.textContent = "Account creation was a success!";
    banner.style.color = "green";
  } catch (err) {
    banner.textContent = err.message || "Registration failed";
    banner.style.color = "red";
  }
});
