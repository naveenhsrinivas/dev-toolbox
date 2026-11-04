import { describe, expect, it } from "vitest";
import {
  colourWarning,
  contrastRatio,
  EMPTY_CONTACT,
  escapeVcard,
  escapeWifi,
  mailtoPayload,
  parseWifi,
  recognise,
  smsPayload,
  telPayload,
  vcardPayload,
  wifiPayload,
} from "./payload";

describe("Wi-Fi", () => {
  it("escapes the special characters", () => {
    expect(escapeWifi(`a\\b;c,d:e"f`)).toBe(`a\\\\b\\;c\\,d\\:e\\"f`);
    expect(escapeWifi("plain")).toBe("plain");
  });

  it("builds the payload", () => {
    expect(wifiPayload({ ssid: "Home", password: "secret", security: "WPA", hidden: false })).toBe("WIFI:T:WPA;S:Home;P:secret;;");
    expect(wifiPayload({ ssid: "Cafe", password: "ignored", security: "nopass", hidden: false })).toBe("WIFI:T:nopass;S:Cafe;;");
    expect(wifiPayload({ ssid: "My;Net", password: 'p:a,s"s\\', security: "WEP", hidden: true })).toBe(
      'WIFI:T:WEP;S:My\\;Net;P:p\\:a\\,s\\"s\\\\;H:true;;',
    );
  });

  it("round-trips through the parser", () => {
    const w = { ssid: `Net "5G"; a,b:c\\`, password: `;;::,,""\\\\ x`, security: "WPA" as const, hidden: true };
    expect(parseWifi(wifiPayload(w))).toEqual(w);
    const open = { ssid: "Open", password: "", security: "nopass" as const, hidden: false };
    expect(parseWifi(wifiPayload(open))).toEqual(open);
  });

  it("parses fields in any order and rejects non-Wi-Fi text", () => {
    expect(parseWifi("WIFI:S:Lab;T:WEP;P:abc;;")).toEqual({ ssid: "Lab", password: "abc", security: "WEP", hidden: false });
    expect(parseWifi("https://example.com")).toBeUndefined();
    expect(parseWifi("WIFI:T:WPA;;")).toBeUndefined();
  });
});

describe("email, phone and SMS", () => {
  it("builds mailto links", () => {
    expect(mailtoPayload({ to: "a@example.com", subject: "", body: "" })).toBe("mailto:a@example.com");
    expect(mailtoPayload({ to: "a@example.com, b@example.com", subject: "Hi & bye", body: "Line 1\nLine 2" })).toBe(
      "mailto:a@example.com,b@example.com?subject=Hi%20%26%20bye&body=Line%201%0D%0ALine%202",
    );
  });

  it("cleans phone numbers", () => {
    expect(telPayload("+1 (555) 123-4567")).toBe("tel:+15551234567");
    expect(telPayload("020 7946 0958")).toBe("tel:02079460958");
    expect(smsPayload("+44 7700 900123", "On my way: 5 min")).toBe("SMSTO:+447700900123:On my way: 5 min");
  });
});

describe("vCard", () => {
  it("escapes text values", () => {
    expect(escapeVcard("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("builds a contact card", () => {
    const card = vcardPayload({
      ...EMPTY_CONTACT,
      firstName: "Ada",
      lastName: "Lovelace",
      org: "Analytical Engines, Ltd",
      phone: "+44 20 7946 0000",
      email: "ada@example.com",
      city: "London",
      country: "UK",
      note: "Line one\nLine two",
    });
    expect(card.split("\r\n")).toEqual([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Lovelace;Ada;;;",
      "FN:Ada Lovelace",
      "ORG:Analytical Engines\\, Ltd",
      "TEL;TYPE=CELL:+44 20 7946 0000",
      "EMAIL:ada@example.com",
      "ADR:;;;London;;;UK",
      "NOTE:Line one\\nLine two",
      "END:VCARD",
    ]);
  });

  it("falls back to the organisation for the display name", () => {
    expect(vcardPayload({ ...EMPTY_CONTACT, org: "ACME" })).toContain("FN:ACME");
  });
});

describe("recognise", () => {
  it("recognises Wi-Fi with escaped values", () => {
    const r = recognise('WIFI:T:WPA;S:My\\;Net;P:p\\:a\\,s\\"s;;');
    expect(r.kind).toBe("wifi");
    expect(r.details).toContainEqual(["Network name (SSID)", "My;Net"]);
    expect(r.details).toContainEqual(["Password", 'p:a,s"s']);
  });

  it("recognises links, email, phone, SMS, contacts and locations", () => {
    expect(recognise("https://example.com/a?b=1").kind).toBe("url");
    expect(recognise("https://example.com/a?b=1").details).toContainEqual(["Site", "example.com"]);
    const mail = recognise("mailto:a@example.com?subject=Hi%20%2B%20there&body=x");
    expect(mail.kind).toBe("email");
    expect(mail.details).toContainEqual(["Subject", "Hi + there"]);
    expect(recognise("tel:+15551234567").details).toEqual([["Number", "+15551234567"]]);
    expect(recognise("SMSTO:+1555:Hello: world").details).toEqual([
      ["To", "+1555"],
      ["Message", "Hello: world"],
    ]);
    expect(recognise("sms:+1555?body=Hi%20there").details).toEqual([
      ["To", "+1555"],
      ["Message", "Hi there"],
    ]);
    const card = recognise(vcardPayload({ ...EMPTY_CONTACT, firstName: "Ada", org: "A, B", city: "London" }));
    expect(card.kind).toBe("vcard");
    expect(card.details).toContainEqual(["Organisation", "A, B"]);
    expect(card.details).toContainEqual(["Address", "London"]);
    expect(recognise("geo:51.5,-0.12").kind).toBe("geo");
    expect(recognise("just some text").kind).toBe("text");
    expect(recognise("ftp://example.com").kind).toBe("text");
  });
});

describe("colours", () => {
  it("computes contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#fff", "#fff")).toBeCloseTo(1, 5);
  });

  it("warns about similar or inverted colours", () => {
    expect(colourWarning("#000000", "#ffffff")).toBeUndefined();
    expect(colourWarning("#1e3a8a", "#ffffff")).toBeUndefined();
    expect(colourWarning("#777777", "#888888")).toMatch(/too similar/);
    expect(colourWarning("#ffffff", "#000000")).toMatch(/inverted/);
    expect(colourWarning("#888888", "#ffffff")).toMatch(/low/);
  });
});
