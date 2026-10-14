import type { Plugin } from "vite";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function getLocalRedirectUrl(
  configuredUrl: string | undefined,
  requestHost: string | undefined,
  requestPath: string
): string | undefined {
  if (!configuredUrl || !requestHost || !requestPath.startsWith("/")) return undefined;
  try {
    const configured = new URL(configuredUrl);
    const requested = new URL(`${configured.protocol}//${requestHost}`);
    if (
      !["http:", "https:"].includes(configured.protocol) ||
      !loopbackHosts.has(configured.hostname) ||
      !loopbackHosts.has(requested.hostname) ||
      requested.port !== configured.port ||
      requested.hostname === configured.hostname
    )
      return undefined;
    // Keep auth cookies, API calls and backend redirects on the configured host.
    return configured.origin + requestPath;
  } catch {
    return undefined;
  }
}

export function localOriginPlugin(configuredUrl: string | undefined): Plugin {
  return {
    name: "crm-local-origin",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const target = getLocalRedirectUrl(configuredUrl, request.headers.host, request.url ?? "/");
        if (!target) return next();
        response.writeHead(302, { Location: target });
        response.end();
      });
    },
  };
}
