"use strict";

const dns = require("node:dns/promises");
const net = require("node:net");

const DEFAULT_ALLOWED_PORTS = Object.freeze(new Set(["80","443"]));

function createUrlPolicyError(message, code) {
  const error = new Error(message);
  error.name = "UrlPolicyError";
  error.code = code;
  error.isClientRequestError = true;
  return error;
}

function normalizeIpv4(address) {
  const parts = String(address || "").split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return null;
  }
  return octets;
}

function ipv4ToNumber(octets) {
  return (
    (((octets[0] << 24) >>> 0) +
      (octets[1] << 16) +
      (octets[2] << 8) +
      octets[3]) >>>
    0
  );
}

function inIpv4Cidr(octets, base, prefix) {
  const value = ipv4ToNumber(octets);
  const baseValue = ipv4ToNumber(base);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

const BLOCKED_IPV4_RANGES = Object.freeze([
  [[0,0,0,0],8],
  [[10,0,0,0],8],
  [[100,64,0,0],10],
  [[127,0,0,0],8],
  [[169,254,0,0],16],
  [[172,16,0,0],12],
  [[192,0,0,0],24],
  [[192,0,2,0],24],
  [[192,168,0,0],16],
  [[198,18,0,0],15],
  [[198,51,100,0],24],
  [[203,0,113,0],24],
  [[224,0,0,0],4],
  [[240,0,0,0],4]
]);

function isBlockedIpv4(address) {
  const octets = normalizeIpv4(address);
  if (!octets) return true;
  return BLOCKED_IPV4_RANGES.some(([base,prefix]) =>
    inIpv4Cidr(octets,base,prefix)
  );
}

function parseIpv6Groups(address) {
  let input = String(address || "").toLowerCase().split("%")[0];
  if (!input) return null;

  const embeddedIpv4 = input.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (embeddedIpv4) {
    const octets = normalizeIpv4(embeddedIpv4[1]);
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    input = input.slice(0, -embeddedIpv4[1].length) + high + ":" + low;
  }

  if ((input.match(/::/g) || []).length > 1) return null;

  const [leftRaw,rightRaw] = input.split("::");
  const left = leftRaw ? leftRaw.split(":").filter(Boolean) : [];
  const right = rightRaw ? rightRaw.split(":").filter(Boolean) : [];

  let groups;
  if (input.includes("::")) {
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left,...Array(missing).fill("0"),...right];
  } else {
    groups = left;
  }

  if (groups.length !== 8) return null;
  const values = groups.map((group) => {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return NaN;
    return Number.parseInt(group,16);
  });
  if (values.some((value) => !Number.isInteger(value))) return null;
  return values;
}

function isBlockedIpv6(address) {
  const groups = parseIpv6Groups(address);
  if (!groups) return true;

  const allZero = groups.every((value) => value === 0);
  const loopback = groups.slice(0,7).every((value) => value === 0) && groups[7] === 1;
  if (allZero || loopback) return true;

  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;

  const ipv4Mapped =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff;

  if (ipv4Mapped) {
    const octets = [
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff
    ];
    return BLOCKED_IPV4_RANGES.some(([base,prefix]) =>
      inIpv4Cidr(octets,base,prefix)
    );
  }

  return false;
}

function isPublicIp(address) {
  const family = net.isIP(String(address || ""));
  if (family === 4) return !isBlockedIpv4(address);
  if (family === 6) return !isBlockedIpv6(address);
  return false;
}

function validateUrlSyntax(input, options = {}) {
  let url;
  try {
    url = new URL(String(input || ""));
  } catch {
    throw createUrlPolicyError("La URL no es valida.","INVALID_WEB_URL");
  }

  if (!["http:","https:"].includes(url.protocol)) {
    throw createUrlPolicyError(
      "Solo se permiten URLs HTTP o HTTPS.",
      "WEB_PROTOCOL_BLOCKED"
    );
  }

  if (url.username || url.password) {
    throw createUrlPolicyError(
      "No se permiten credenciales embebidas en URLs.",
      "WEB_CREDENTIALS_BLOCKED"
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/,"");
  if (!hostname) {
    throw createUrlPolicyError("La URL no contiene host.","INVALID_WEB_HOST");
  }

  const blockedNames = [
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal"
  ];
  if (
    blockedNames.includes(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw createUrlPolicyError(
      "El host solicitado pertenece a una red local o reservada.",
      "WEB_HOST_BLOCKED"
    );
  }

  const allowedPorts =
    options.allowedPorts instanceof Set
      ? options.allowedPorts
      : DEFAULT_ALLOWED_PORTS;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (!allowedPorts.has(port)) {
    throw createUrlPolicyError(
      "El puerto solicitado no esta permitido.",
      "WEB_PORT_BLOCKED"
    );
  }

  return url;
}

async function resolveAndValidateUrl(input, options = {}) {
  const url = validateUrlSyntax(input, options);
  const hostname = url.hostname.toLowerCase().replace(/\.$/,"");
  const literalFamily = net.isIP(hostname);
  let addresses;

  if (literalFamily) {
    addresses = [{address:hostname,family:literalFamily}];
  } else {
    const lookup = options.lookup || dns.lookup;
    try {
      addresses = await lookup(hostname,{all:true,verbatim:true});
    } catch {
      throw createUrlPolicyError(
        "No fue posible resolver el host solicitado.",
        "WEB_DNS_FAILED"
      );
    }
  }

  if (!Array.isArray(addresses) || !addresses.length) {
    throw createUrlPolicyError(
      "El host no tiene direcciones IP utilizables.",
      "WEB_DNS_EMPTY"
    );
  }

  for (const entry of addresses) {
    if (!isPublicIp(entry?.address)) {
      throw createUrlPolicyError(
        "La URL resuelve a una direccion privada, local o reservada.",
        "WEB_SSRF_BLOCKED"
      );
    }
  }

  return {
    url,
    addresses:addresses.map((entry)=>({
      address:String(entry.address),
      family:Number(entry.family) || net.isIP(String(entry.address))
    }))
  };
}

module.exports = {
  DEFAULT_ALLOWED_PORTS,
  validateUrlSyntax,
  resolveAndValidateUrl,
  isPublicIp,
  isBlockedIpv4,
  isBlockedIpv6,
  parseIpv6Groups,
  createUrlPolicyError
};
