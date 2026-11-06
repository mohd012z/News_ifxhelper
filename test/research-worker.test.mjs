import assert from "node:assert/strict";
import worker from "../worker/index.mjs";

const BASE = "https://gentle-violet-4a79.ifxhelper.workers.dev";
const originalFetch = globalThis.fetch;
const get = (path, env) => worker.fetch(new Request(BASE + path), env);

function mockRegistries() {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.github.com/search/repositories")) {
      return Response.json({ items: [
        { full_name: "gh/one", description: "gh hit", stargazers_count: 9 },
        { full_name: "bad", description: "no slash", stargazers_count: 1 } ] });
    }
    if (url.startsWith("https://gitlab.com/api/v4/projects")) {
      return Response.json([{ path_with_namespace: "gl/one", web_url: "https://gitlab.com/gl/one",
        description: "gl hit", star_count: 3 },
        { path_with_namespace: "gl/deletion_x", star_count: 9 }]);
    }
    if (url.startsWith("https://registry.npmjs.org/-/v1/search")) {
      return Response.json({ objects: [
        { package: { name: "npm-one", description: "npm hit" }, downloads: { monthly: 1200 } } ] });
    }
    if (url.startsWith("https://crates.io/api/v1/crates")) {
      return Response.json({ crates: [
        { name: "crates-one", description: "crates hit", downloads: 5000 },
        { name: "tiny", description: "noise", downloads: 10 } ] });
    }
    if (url.startsWith("https://hub.docker.com/v2/search/repositories/")) {
      return Response.json({ results: [
        { repo_name: "docker/one", short_description: "docker hit", pull_count: 42 } ] });
    }
    if (url.includes("archive.org/advancedsearch.php")) {
      return Response.json({ response: { docs: [
        { identifier: "ia-one", title: "IA Book", author_name: ["A"] } ] } });
    }
    if (url.includes("gutenberg.org/ebooks/search.opds/")) {
      return new Response(
        '<feed><entry><id>https://www.gutenberg.org/ebooks/42.opds</id><title>PG Book</title></entry></feed>',
        { status: 200, headers: { "Content-Type": "application/atom+xml" } });
    }
    return Response.json({}, { status: 404 });
  };
}

// 1) menu
{
  const r = await get("/api/research?menu=1");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.subjects.length, 12);
  assert.equal(body.markup.inline_keyboard.length, 7);
  console.log("ok - research menu returns 12-subject grid markup");
}

// 2) subject path, no env -> deterministic digest, no Minda call
{
  mockRegistries();
  let llmCalls = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = async (input, opts) => {
    if (String(input).includes("chat/completions")) llmCalls++;
    return orig(input, opts);
  };
  const r = await get("/api/research/machine%20learning");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(llmCalls, 0);
  assert.equal(body.llm, false);
  assert.ok(body.nGlobal > 0);
  assert.ok(body.nEbooks > 0);
  assert.match(body.text, /Research report/);
  assert.match(body.text, /AI digest \(Worker agent\)/);
  assert.match(body.text, /gh\/one/);
  assert.match(body.text, /ia-one/);
  globalThis.fetch = originalFetch;
  console.log("ok - research by subject works with NO env (deterministic, no Minda)");
}

// 3) ?q= param
{
  mockRegistries();
  const r = await get("/api/research?q=" + encodeURIComponent("forex trading"));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.subject, "forex trading");
  globalThis.fetch = originalFetch;
  console.log("ok - research via ?q= param is equivalent");
}

// 4) no subject -> 400
{
  const r = await get("/api/research");
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.ok, false);
  console.log("ok - research with no subject is 400");
}

// 5) dead registries fail-open
{
  const orig = originalFetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.github.com/")) {
      return Response.json({ items: [{ full_name: "gh/only", description: "d", stargazers_count: 4 }] });
    }
    if (url.startsWith("https://gitlab.com/") || url.startsWith("https://registry.npmjs.org/") ||
        url.startsWith("https://crates.io/") || url.startsWith("https://hub.docker.com/")) {
      throw new Error("down");
    }
    if (url.includes("archive.org/") || url.includes("gutenberg.org/")) {
      return new Response("", { status: 503 });
    }
    return orig(input);
  };
  const r = await get("/api/research/quantum%20computing");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.deepEqual(Object.keys(body.sources), ["github"]);
  globalThis.fetch = originalFetch;
  console.log("ok - dead registries fail-open: report still ok with fewer sources");
}

console.log("research-worker tests passed");
