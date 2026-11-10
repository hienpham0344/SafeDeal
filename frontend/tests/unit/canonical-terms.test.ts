import { describe, expect, it } from "vitest";
import {
  buildCanonicalTermsJson,
  canonicalizeJsonValue,
  computeCanonicalTermsHash,
} from "@/utils/canonical-terms";

describe("canonical-terms (RFC 8785)", () => {
  it("sorts keys lexicographically regardless of input order and strips undefined values", () => {
    const a = canonicalizeJsonValue({ z: 1, a: "hello", nested: { b: true, a: null }, skip: undefined });
    const b = canonicalizeJsonValue({ nested: { a: null, b: true }, a: "hello", z: 1 });
    expect(a).toBe('{"a":"hello","nested":{"a":null,"b":true},"z":1}');
    expect(a).toBe(b);
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalizeJsonValue(Number.NaN)).toThrow();
    expect(() => canonicalizeJsonValue(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("normalizes addresses to lowercase and blank buyer to null across identical trade terms", async () => {
    const res1 = await computeCanonicalTermsHash({
      version: 1,
      chainId: 43113,
      seller: "0x70997970C51812DC3A010C7D01B50E0D17DC79C8",
      buyer: "   ",
      arbiter: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      amountWei: "1500000000000000000",
      fundingDeadline: 1800000000,
      deliveryDeadline: 1800086400,
      inspectionWindowSeconds: 259200,
      title: "  Hardware Wallet Sale  ",
      description: "Sealed device with tracking",
      terms: "Shipped within 24 hours",
    });

    const res2 = await computeCanonicalTermsHash({
      version: 1,
      chainId: 43113,
      seller: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
      buyer: null,
      arbiter: "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
      amountWei: "1500000000000000000",
      fundingDeadline: 1800000000,
      deliveryDeadline: 1800086400,
      inspectionWindowSeconds: 259200,
      title: "Hardware Wallet Sale",
      description: "Sealed device with tracking",
      terms: "Shipped within 24 hours",
    });

    expect(res1.canonicalJson).toBe(
      '{"amountWei":"1500000000000000000","arbiter":"0x90f79bf6eb2c4f870365e785982e1f101e93b906","buyer":null,"chainId":43113,"deliveryDeadline":1800086400,"description":"Sealed device with tracking","fundingDeadline":1800000000,"inspectionWindowSeconds":259200,"seller":"0x70997970c51812dc3a010c7d01b50e0d17dc79c8","terms":"Shipped within 24 hours","title":"Hardware Wallet Sale","version":1}'
    );
    expect(res1.canonicalJson).toBe(res2.canonicalJson);
    expect(res1.termsHash).toBe(res2.termsHash);
    expect(res1.termsHash).toBe("0xbf5ef59687168af6140d2ebd15e63b94df1ac4d3206e45f3a2f681cb962ade62");
  });

  it("changes hash when any field mutates", async () => {
    const base = {
      version: 1,
      chainId: 31337,
      seller: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      buyer: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
      arbiter: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
      amountWei: "1000000000000000000",
      fundingDeadline: 1800000000,
      deliveryDeadline: 1800086400,
      inspectionWindowSeconds: 86400,
      title: "MacBook Pro",
      description: "M3 laptop escrow deal",
      terms: "No scratches; charger included",
    };

    const h1 = await computeCanonicalTermsHash(base);
    const h2 = await computeCanonicalTermsHash({ ...base, amountWei: "1000000000000000001" });
    expect(buildCanonicalTermsJson(base)).toContain('"buyer":"0x70997970c51812dc3a010c7d01b50e0d17dc79c8"');
    expect(h1.termsHash).not.toBe(h2.termsHash);
  });
});
