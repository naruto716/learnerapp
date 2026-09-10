const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const test = require("node:test");
const {
  fetchPublicSource,
  htmlToText,
  isPrivateIp,
  normalizeText,
  parseSourceFile,
  tiptapToText,
  validatePublicUrl,
} = require("./sourceParsing");

test("normalizes text and extracts readable HTML and Tiptap content", () => {
  assert.equal(normalizeText("one \r\n\r\n\r\n two  \n"), "one\n\n two");
  assert.equal(htmlToText("<h1>A &amp; B</h1><script>bad()</script><p>Body&nbsp;text</p>"), "A & B\nBody text");
  assert.equal(tiptapToText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] }), "Hello");
});

test("rejects local and private URL destinations", async () => {
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("10.1.2.3"), true);
  assert.equal(isPrivateIp("8.8.8.8"), false);
  await assert.rejects(validatePublicUrl("file:///etc/passwd"), /HTTP or HTTPS/);
  await assert.rejects(validatePublicUrl("https://localhost/page"), /Private or local/);
  await assert.rejects(
    validatePublicUrl("https://internal.example/page", async () => [{ address: "192.168.1.5" }]),
    /Private or local/,
  );
});

test("validates redirect destinations before fetching them", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(null, { headers: { location: "http://127.0.0.1/private" }, status: 302 });
  };
  await assert.rejects(
    fetchPublicSource("https://public.example", {
      fetchImpl,
      lookup: async () => [{ address: "93.184.216.34" }],
    }),
    /Private or local/,
  );
  assert.equal(calls, 1);
});

test("parses supported text files and rejects unsupported extensions", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "learner-source-"));
  const textPath = path.join(directory, "source.md");
  const binaryPath = path.join(directory, "source.exe");
  await fs.writeFile(textPath, "# Heading\n\nUseful text\n", "utf8");
  await fs.writeFile(binaryPath, "no", "utf8");
  assert.equal((await parseSourceFile(textPath)).text, "# Heading\n\nUseful text");
  await assert.rejects(parseSourceFile(binaryPath), /Unsupported source file type/);
  await fs.rm(directory, { recursive: true });
});
