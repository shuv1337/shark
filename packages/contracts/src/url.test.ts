import { describe, expect, it } from "vitest";
import { isPublicAddress } from "./ip";
import { isPublicHttpsUrl, publicHttpsHref } from "./url";

describe("isPublicHttpsUrl", () => {
  it.each([
    "https://client.example/logo.png",
    "https://client.example./logo.png",
    "https://cdn.example.com:8443/a.png?x=1",
    "https://93.184.216.34/a.png",
    "https://[2606:4700:4700::1111]/a.png",
    "https://[64:ff9b::5db8:d822]/a.png",
    "https://localhost.example.com/a.png",
  ])("accepts %s", (value) => {
    expect(isPublicHttpsUrl(value)).toBe(true);
  });

  it.each([
    // Local and special-use names, including the absolute trailing-dot forms.
    "https://localhost/probe",
    "https://localhost./probe",
    "https://localhost../probe",
    "https://LOCALHOST./probe",
    "https://app.localhost./probe",
    "https://printer.local/probe",
    "https://printer.local./probe",
    "https://db.internal./probe",
    "https://router.home.arpa./probe",
    "https://intranet/probe",
    "https://intranet./probe",
    // IPv4 private, loopback, link-local, CGNAT, documentation, benchmark, multicast, broadcast.
    "https://0.0.0.0/probe",
    "https://10.0.0.5/probe",
    "https://100.64.0.1/probe",
    "https://127.0.0.1./probe",
    "https://169.254.169.254/latest/meta-data/",
    "https://172.16.0.1/probe",
    "https://192.168.1.1/probe",
    "https://192.0.2.1/probe",
    "https://198.18.0.1/probe",
    "https://198.51.100.1/probe",
    "https://203.0.113.1/probe",
    "https://224.0.0.1/probe",
    "https://255.255.255.255/probe",
    // Decimal, octal, and hex IPv4 spellings of loopback and metadata.
    "https://2130706433/probe",
    "https://0177.0.0.1/probe",
    "https://0x7f.0.0.1/probe",
    "https://0x7f000001/probe",
    "https://127.1/probe",
    "https://0xa9fea9fe/probe",
    // IPv6 unspecified, loopback, link-local, ULA, multicast, documentation.
    "https://[::]/probe",
    "https://[::1]/probe",
    "https://[fe80::1]/probe",
    "https://[fe90::1]/probe",
    "https://[febf::1]/probe",
    "https://[fc00::1]/probe",
    "https://[fd12:3456::1]/probe",
    "https://[ff00::1]/probe",
    "https://[ff02::1]/probe",
    "https://[2001:db8::1]/probe",
    "https://[3fff::1]/probe",
    // IPv4-mapped, IPv4-compatible, NAT64, and 6to4 forms of private IPv4.
    "https://[::ffff:127.0.0.1]/probe",
    "https://[::ffff:169.254.169.254]/probe",
    "https://[::127.0.0.1]/probe",
    "https://[64:ff9b::a00:1]/probe",
    "https://[64:ff9b::169.254.169.254]/probe",
    "https://[2002:a00:1::]/probe",
    // Not HTTPS, or not a URL.
    "http://client.example/probe",
    "javascript:alert(1)",
    "not a url",
  ])("rejects %s", (value) => {
    expect(isPublicHttpsUrl(value)).toBe(false);
  });
});

describe("publicHttpsHref", () => {
  it("normalizes accepted URLs", () => {
    expect(publicHttpsHref(" https:client.example/logo.png")).toBe(
      "https://client.example/logo.png",
    );
  });

  it.each([
    "https://localhost./probe",
    "https://printer.local./probe",
    "https://[::]/probe",
    "https://[fe90::1]/probe",
    "https://[ff00::1]/probe",
    "https://user:secret@client.example/",
    "https://user@client.example/",
    "https://:secret@client.example/",
    null,
    undefined,
    "",
  ])("returns null for %s", (value) => {
    expect(publicHttpsHref(value)).toBeNull();
  });
});

describe("isPublicAddress", () => {
  it("rejects malformed literals instead of guessing", () => {
    for (const value of [
      "",
      "example.com",
      "1.2.3",
      "01.2.3.4",
      "1.2.3.256",
      "2606:4700::zz",
      "1:2:3:4:5:6:7:8:9",
      "1::2::3",
      "fe80::1%en0",
      "::ffff:1.2.3",
    ]) {
      expect(isPublicAddress(value), value).toBe(false);
    }
  });
});
