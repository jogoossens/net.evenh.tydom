// Turns user input or a discovery address into a hostname that is safe to
// put in a URL (tydom-client builds `https://${hostname}` and throws on an
// invalid one). Returns undefined when it isn't a usable address.
export const normalizeHostname = (input: string): string | undefined => {
  let host = (input || '')
    .trim()
    .replace(/^[a-z]+:\/\//i, '') // "http://192.168.1.50"
    .replace(/\/.*$/, ''); // "192.168.1.50/"
  if (!host) return undefined;
  // Bare IPv6 address (more than one colon) needs brackets in a URL.
  if (!host.startsWith('[') && (host.match(/:/g) || []).length > 1) host = `[${host}]`;
  try {
    return new URL(`https://${host}`).host ? host : undefined;
  } catch {
    return undefined;
  }
};

export const invalidHostnameMessage = (input: string) =>
  `"${input}" is not a valid IP address — enter something like 192.168.1.50`;
