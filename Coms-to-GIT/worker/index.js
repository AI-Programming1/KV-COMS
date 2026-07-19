export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (!env.ACCOUNT_KV) return error("ACCOUNT_KV is not bound");
    if (!env.MESSAGE_KV) return error("MESSAGE_KV is not bound");
    if (!env.USER_HASH_SECRET) return error("USER_HASH_SECRET missing");

    const url = new URL(req.url);

    try {
      if (req.method === "POST" && url.pathname === "/register")
        return withCors(await register(req, env));

      if (req.method === "POST" && url.pathname === "/validate-account")
        return withCors(await validateAccount(req, env));

      if (req.method === "GET" && url.pathname === "/resolve")
        return withCors(await resolveHandle(env, url));

      if (req.method === "POST" && url.pathname === "/message")
        return withCors(await relayMessage(req, env));

      if (req.method === "GET" && url.pathname === "/inbox")
        return withCors(await getInbox(env, url));

      if (req.method === "DELETE" && url.pathname === "/delete-messages")
        return withCors(await deleteMessages(req, env));

      if (req.method === "DELETE" && url.pathname === "/delete-account")
        return withCors(await deleteAccount(req, env));

      return withCors(new Response("Not Found", { status: 404 }));

    } catch (err) {
      console.error("WORKER ERROR:", err);
      return withCors(
        new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        })
      );
    }
  }
};

/* =========================
   SECURITY HASHING
========================= */

// Salted handle hash (prevents rainbow attacks)
async function hashHandle(handle, env) {
  const data = new TextEncoder().encode(
    handle.toLowerCase().trim() + env.USER_HASH_SECRET
  );
  return sha256Hex(data);
}

// Hash viewKey (also salted for extra protection)
async function hashViewKey(viewKey, env) {
  const data = new TextEncoder().encode(
    viewKey + env.USER_HASH_SECRET
  );
  return sha256Hex(data);
}

// Generic SHA-256 → hex
async function sha256Hex(data) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/* =========================
   ROUTES
========================= */

async function register(req, env) {
  const { handle, viewKey } = await req.json();

  if (!handle || !viewKey)
    return new Response("Missing handle or viewKey", { status: 400 });

  const handleHash = await hashHandle(handle, env);
  const viewKeyHash = await hashViewKey(viewKey, env);

  const handleKey = `h:${handleHash}`;
  const exists = await env.ACCOUNT_KV.get(handleKey);

  if (exists)
    return new Response("Handle already exists", { status: 409 });

  // Store ONLY hashed values
  await env.ACCOUNT_KV.put(
    handleKey,
    JSON.stringify({
      viewKeyHash,
      created: Date.now()
    })
  );

  return json({ success: true });
}

async function validateAccount(req, env) {
  const { handle, viewKey } = await req.json();

  if (!handle || !viewKey)
    return new Response("Missing credentials", { status: 400 });

  const handleHash = await hashHandle(handle, env);
  const viewKeyHash = await hashViewKey(viewKey, env);

  const account = await env.ACCOUNT_KV.get(`h:${handleHash}`, "json");

  if (!account || account.viewKeyHash !== viewKeyHash)
    return new Response("Invalid account", { status: 401 });

  return json({ valid: true });
}

async function resolveHandle(env, url) {
  const handle = url.searchParams.get("handle");
  if (!handle)
    return new Response("Missing handle", { status: 400 });

  const handleHash = await hashHandle(handle, env);
  const account = await env.ACCOUNT_KV.get(`h:${handleHash}`);

  if (!account)
    return new Response("User not found", { status: 404 });

  return json({ exists: true });
}

async function relayMessage(req, env) {
  const { to, from, payload } = await req.json();

  if (!to || !from || !payload)
    return new Response("Invalid message payload", { status: 400 });

  const recipientHandleHash = await hashHandle(to, env);
  const account = await env.ACCOUNT_KV.get(`h:${recipientHandleHash}`, "json");

  if (!account)
    return new Response("User not found", { status: 404 });

  const inboxKey = `inbox:${account.viewKeyHash}`;
  const inbox = (await env.MESSAGE_KV.get(inboxKey, "json")) || [];

  const senderHash = await hashHandle(from, env);

  inbox.push({
    from: senderHash,
    payload,
    received: Date.now()
  });

  await env.MESSAGE_KV.put(inboxKey, JSON.stringify(inbox));

  return json({ delivered: true });
}

async function getInbox(env, url) {
  const viewKey = url.searchParams.get("viewKey");
  if (!viewKey)
    return new Response("Missing viewKey", { status: 400 });

  const viewKeyHash = await hashViewKey(viewKey, env);
  const inbox = await env.MESSAGE_KV.get(`inbox:${viewKeyHash}`, "json");

  return json({ messages: inbox || [] });
}

async function deleteMessages(req, env) {
  const { viewKey } = await req.json();
  if (!viewKey)
    return new Response("Missing viewKey", { status: 400 });

  const viewKeyHash = await hashViewKey(viewKey, env);
  await env.MESSAGE_KV.delete(`inbox:${viewKeyHash}`);

  return json({ deleted: true });
}

async function deleteAccount(req, env) {
  const { handle, viewKey } = await req.json();
  if (!handle || !viewKey)
    return new Response("Missing account identifiers", { status: 400 });

  const handleHash = await hashHandle(handle, env);
  const viewKeyHash = await hashViewKey(viewKey, env);

  await env.ACCOUNT_KV.delete(`h:${handleHash}`);
  await env.MESSAGE_KV.delete(`inbox:${viewKeyHash}`);

  return json({ deleted: true });
}

/* =========================
   HELPERS
========================= */

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json" }
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "https://domain.com",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function withCors(res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders()))
    headers.set(k, v);

  return new Response(res.body, {
    status: res.status,
    headers
  });
}

function error(msg) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 500,
    headers: corsHeaders()
  });
}
