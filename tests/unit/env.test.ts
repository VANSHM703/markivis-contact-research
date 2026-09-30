import { describe, expect, it } from "vitest";
import { getDataMode, isAnyAdapterMock } from "@/config/env";

describe("getDataMode", () => {
  it("defaults to mock when unset or invalid", () => {
    expect(getDataMode({})).toBe("mock");
    expect(getDataMode({ DATA_MODE: "production" })).toBe("mock");
  });

  it("accepts live, mock and record in any case", () => {
    expect(getDataMode({ DATA_MODE: "live" })).toBe("live");
    expect(getDataMode({ DATA_MODE: " Record " })).toBe("record");
  });
});

describe("isAnyAdapterMock", () => {
  it("is true in mock mode", () => {
    expect(isAnyAdapterMock({ DATA_MODE: "mock", ANTHROPIC_API_KEY: "key" })).toBe(true);
  });

  it("is true in live mode without an Anthropic key, because the AI adapter falls back to mock", () => {
    expect(isAnyAdapterMock({ DATA_MODE: "live" })).toBe(true);
  });

  it("is false in live mode with an Anthropic key", () => {
    expect(isAnyAdapterMock({ DATA_MODE: "live", ANTHROPIC_API_KEY: "key" })).toBe(false);
  });
});
