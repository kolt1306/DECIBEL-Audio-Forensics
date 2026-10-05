import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MotionConfig } from "motion/react";
import Investigation from "../src/components/Investigation";
import type { Analysis } from "../src/lib/api";
import fixture from "./fixtures/analysis.json";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount() {
  return render(
    <MotionConfig reducedMotion="always">
      <Investigation
        result={fixture as Analysis}
        comparison={null}
        onMode={vi.fn()}
        onRegion={vi.fn()}
        onError={vi.fn()}
      />
    </MotionConfig>,
  );
}

it("exports the complete report with the original analysis values and filename", async () => {
  let blob: Blob | undefined;
  const create = vi.fn((value: Blob) => {
    blob = value;
    return "blob:report";
  });
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("DECIBEL-visual-qa-high.json");
      expect(this.href).toBe("blob:report");
    });
  const view = mount();
  fireEvent.click(view.getByRole("button", { name: "Export JSON" }));
  expect(click).toHaveBeenCalledOnce();
  expect(blob?.type).toBe("application/json");
  const contents = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob!);
  });
  expect(JSON.parse(contents)).toEqual({ product: "DECIBEL", ...fixture });
});

it("keeps diagnostics available behind accessible disclosure and acknowledges copied summaries", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const view = mount();
  const toggle = view.getByRole("button", { name: /Technical analysis/ });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(view.getByText("Model fingerprint")).toBeTruthy();
  expect(
    view.getByRole("region", { name: "Segment predictions" }),
  ).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Copy summary" }));
  await waitFor(() =>
    expect(view.getByRole("button", { name: "Copied" })).toBeTruthy(),
  );
  expect(writeText.mock.calls[0][0]).toContain("92.3%");
});

it("exports browser warnings separately while preserving saturated classifier scores", async () => {
  let blob: Blob | undefined;
  vi.stubGlobal("URL", {
    createObjectURL: (value: Blob) => {
      blob = value;
      return "blob:report";
    },
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const result = {
    ...fixture,
    fake_probability: 1,
    fake_percentage: 100,
    real_probability: 4.2727716476e-8,
  } as Analysis;
  const capture = {
    requested: { echoCancellation: false },
    settings: { echoCancellation: true },
    relaxedConstraints: [],
    warnings: ["Browser processing enabled"],
  };
  const view = render(
    <MotionConfig reducedMotion="always">
      <Investigation
        result={result}
        capture={capture}
        comparison={null}
        onMode={vi.fn()}
        onRegion={vi.fn()}
        onError={vi.fn()}
      />
    </MotionConfig>,
  );
  expect(
    view.getByRole("list", { name: "Browser capture warnings" }).textContent,
  ).toContain("Browser processing enabled");
  fireEvent.click(view.getByRole("button", { name: "Export JSON" }));
  const contents = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob!);
  });
  expect(JSON.parse(contents)).toEqual({
    product: "DECIBEL",
    ...result,
    browser_capture: capture,
  });
});
