import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SegmentTimeline from "../src/components/SegmentTimeline";
import type { Segment } from "../src/lib/api";

afterEach(cleanup);
const segments: Segment[] = [
  {
    index: 0,
    start_seconds: 0,
    end_seconds: 4,
    status: "analyzed",
    real_probability: 0.08,
    fake_probability: 0.92,
    risk: "high",
    reason: null,
  },
  {
    index: 1,
    start_seconds: 3,
    end_seconds: 7,
    status: "skipped",
    real_probability: null,
    fake_probability: null,
    risk: null,
    reason: "silent",
  },
];
it("exposes exact estimates and skipped windows through focus, and preserves segment seeking", () => {
  const seek = vi.fn();
  const view = render(
    <SegmentTimeline segments={segments} duration={7} onSeek={seek} />,
  );
  const high = view.getByRole("button", { name: /92.0 percent/ });
  fireEvent.focus(high);
  expect(view.getByRole("status").textContent).toContain("92.0% · HIGH RISK");
  fireEvent.click(high);
  expect(seek).toHaveBeenCalledWith(0, 4);
  fireEvent.focus(view.getByRole("button", { name: /not analyzed, silent/ }));
  expect(view.getByRole("status").textContent).toContain(
    "SILENT · NOT ANALYZED",
  );
  expect(view.container.querySelectorAll(".trace-window")).toHaveLength(1);
});
