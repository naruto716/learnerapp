const dns = require("dns/promises");
const fs = require("fs/promises");
const http = require("http");
const https = require("https");
const net = require("net");
const path = require("path");
const mammoth = require("mammoth");
const pdf = require("pdf-parse");

const maxSourceBytes = 20 * 1024 * 1024;
const supportedExtensions = new Set([".docx", ".html", ".htm", ".md", ".pdf", ".txt"]);

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (match, entity) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] || match;
    const radix = entity[1].toLowerCase() === "x" ? 16 : 10;
    const valueStart = radix === 16 ? 2 : 1;
    const codePoint = Number.parseInt(entity.slice(valueStart), radix);
    return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
  });
}

function htmlToText(html) {
  return normalizeText(
    decodeHtmlEntities(
      String(html || "")
        .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<\s*br\s*\/?>/gi, "\n")
        .replace(/<\/(?:address|article|aside|blockquote|div|footer|h[1-6]|header|li|main|p|section|table|tr)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/[ \t]*\n[ \t]*/g, "\n"),
    ),
  );
}

function tiptapToText(document) {
  const blocks = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (typeof node.text === "string") blocks.push(node.text);
    if (node.type === "hardBreak") blocks.push("\n");
    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
    }
    if (["blockquote", "bulletList", "codeBlock", "heading", "listItem", "orderedList", "paragraph"].includes(node.type)) {
      blocks.push("\n");
    }
  }
  visit(document);
  return normalizeText(blocks.join(""));
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (!net.isIPv6(address)) return true;
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? isPrivateIp(mapped) : false;
}

async function resolvePublicUrl(value, lookup = dns.lookup) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("A valid source URL is required.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Source URLs must use HTTP or HTTPS.");
  if (url.username || url.password) throw new Error("Source URLs cannot contain credentials.");
  if (!url.hostname || url.hostname.toLowerCase() === "localhost") throw new Error("Private or local source URLs are not allowed.");

  const addresses = net.isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Private or local source URLs are not allowed.");
  }
  return { addresses, url };
}

async function validatePublicUrl(value, lookup = dns.lookup) {
  return (await resolvePublicUrl(value, lookup)).url;
}

function secureRequest(url, addresses) {
  return new Promise((resolve, reject) => {
    const address = addresses[0].address;
    const family = net.isIPv6(address) ? 6 : 4;
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.get(url, {
      headers: { Accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1" },
      lookup: (_hostname, lookupOptions, callback) => lookupOptions?.all
        ? callback(null, [{ address, family }])
        : callback(null, address, family),
      timeout: 20_000,
    }, (response) => {
      resolve({
        body: response,
        headers: new Headers(response.headers),
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
      });
    });
    request.on("timeout", () => request.destroy(new Error("Source URL request timed out.")));
    request.on("error", reject);
  });
}

async function readBoundedResponse(response, limit = maxSourceBytes) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > limit) throw new Error("Source response is too large.");
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw new Error("Source response is too large.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function fetchPublicSource(value, options = {}) {
  const fetchImpl = options.fetchImpl;
  const lookup = options.lookup || dns.lookup;
  let resolved = await resolvePublicUrl(value, lookup);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = fetchImpl
      ? await fetchImpl(resolved.url, {
          headers: { Accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1" },
          redirect: "manual",
          signal: AbortSignal.timeout(20_000),
       })
      : await secureRequest(resolved.url, resolved.addresses);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      response.body?.resume?.();
      if (redirect === 5) throw new Error("Source URL redirected too many times.");
      const location = response.headers.get("location");
      if (!location) throw new Error("Source URL returned an invalid redirect.");
      resolved = await resolvePublicUrl(new URL(location, resolved.url).toString(), lookup);
      continue;
    }
    if (!response.ok) {
      response.body?.resume?.();
      throw new Error(`Source URL returned HTTP ${response.status}.`);
    }
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/") && !contentType.includes("html") && !contentType.includes("xhtml")) {
      throw new Error("Source URL did not return readable text or HTML.");
    }
    const body = (await readBoundedResponse(response)).toString("utf8");
    const text = contentType.includes("html") || /^\s*<!?html/i.test(body) ? htmlToText(body) : normalizeText(body);
    if (!text) throw new Error("Source URL did not contain readable text.");
    return { contentType, finalUrl: resolved.url.toString(), text };
  }
  throw new Error("Source URL could not be fetched.");
}

async function parseSourceFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!supportedExtensions.has(extension)) throw new Error(`Unsupported source file type: ${extension || "unknown"}.`);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > maxSourceBytes) throw new Error("Source file is too large or is not a regular file.");
  const buffer = await fs.readFile(filePath);
  let text;
  if (extension === ".pdf") text = (await pdf(buffer)).text;
  else if (extension === ".docx") text = (await mammoth.extractRawText({ buffer })).value;
  else if (extension === ".html" || extension === ".htm") text = htmlToText(buffer.toString("utf8"));
  else text = buffer.toString("utf8");
  text = normalizeText(text);
  if (!text) throw new Error("Source file did not contain readable text.");
  return { extension, size: stat.size, text };
}

module.exports = {
  fetchPublicSource,
  htmlToText,
  isPrivateIp,
  normalizeText,
  parseSourceFile,
  supportedExtensions,
  tiptapToText,
  validatePublicUrl,
};
