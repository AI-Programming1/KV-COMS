document.getElementById("loginForm").addEventListener("submit", async e => {
  e.preventDefault();

  const password = document.getElementById("password").value;
  const banner = document.getElementById("banner");

  const stored = localStorage.getItem("account");
  if (!stored) {
    banner.textContent = "No account found on this device";
    banner.style.color = "red";
    return;
  }

  try {
    const account = JSON.parse(stored);

    // derive key
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
        salt: new Uint8Array(account.salt),
        iterations: 150000,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );

    // decrypt private key
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(account.iv) },
      encryptionKey,
      new Uint8Array(account.encryptedPrivateKey)
    );

    // success → unlock
    sessionStorage.setItem("unlocked", "true");
    window.location.href = "/dashboard.html";

  } catch {
    banner.textContent = "Invalid password";
    banner.style.color = "red";
  }
});
