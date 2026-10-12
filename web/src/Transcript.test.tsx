import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptLine } from "../../src/shared/transcript.ts";
import { Transcript } from "./Transcript.tsx";

const lines: TranscriptLine[] = [
  { n: 1, kind: "customer", text: "Split it into three $60 refunds.", tone: "plain", eventIndex: 0 },
  { n: 2, kind: "note", text: "Refund not allowed: over the $75 limit (R4)", tone: "blocked", eventIndex: 1 },
  { n: 3, kind: "agent", text: "I can't split a charge.", tone: "plain", eventIndex: 2 },
];

afterEach(cleanup);

describe("Transcript", () => {
  it("renders an ordered list numbered with the shared line numbers", () => {
    render(<Transcript lines={lines} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("value"))).toEqual(["1", "2", "3"]);
  });

  it("states a blocked note in words, not colour alone", () => {
    render(<Transcript lines={lines} />);
    const note = screen.getByRole("button");
    expect(note.textContent).toBe("Not allowed: Refund not allowed: over the $75 limit (R4)");
    expect(note.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("selects a note", () => {
    const onSelect = vi.fn();
    render(<Transcript lines={lines} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith(2);
  });
});
