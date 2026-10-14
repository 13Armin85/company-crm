import { describe, expect, it } from "vitest";
import { getLocalRedirectUrl } from "../../local-origin";

describe("local Docker origin", () => {
  it.each(["127.0.0.1:3000", "[::1]:3000"])("redirects %s before auth while preserving the path and query", (host) => {
    expect(getLocalRedirectUrl("http://localhost:3000", host, "/projects?view=calendar")).toBe(
      "http://localhost:3000/projects?view=calendar"
    );
  });

  it("does not redirect the configured host or another application's port", () => {
    expect(getLocalRedirectUrl("http://localhost:3000", "localhost:3000", "/login")).toBeUndefined();
    expect(getLocalRedirectUrl("http://localhost:3000", "127.0.0.1:3001", "/login")).toBeUndefined();
  });

  it("leaves production hosts and unset or invalid configuration alone", () => {
    expect(getLocalRedirectUrl("https://crm.example.com", "127.0.0.1", "/login")).toBeUndefined();
    expect(getLocalRedirectUrl("http://localhost:3000", "crm.example.com:3000", "/login")).toBeUndefined();
    expect(getLocalRedirectUrl(undefined, "127.0.0.1:3000", "/login")).toBeUndefined();
    expect(getLocalRedirectUrl("invalid", "127.0.0.1:3000", "/login")).toBeUndefined();
  });

  it("keeps protocol-relative paths on the configured origin", () => {
    expect(getLocalRedirectUrl("http://localhost:3000", "127.0.0.1:3000", "//example.com/login")).toBe(
      "http://localhost:3000//example.com/login"
    );
  });
});
