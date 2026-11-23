import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ColumnFilter } from "../components/ColumnFilter";

const options = [
  { value: "Art Assessment", label: "Art Assessment", count: 1 },
  { value: "Job Initiation", label: "Job Initiation", count: 12 },
  { value: "Pre-editing", label: "Pre-editing", count: 14 },
];

function setup(selected: string[] = []) {
  const onChange = vi.fn();
  render(<ColumnFilter title="Stage" getOptions={() => options} selected={selected} onChange={onChange} />);
  return { onChange };
}

const openPanel = async () => {
  await userEvent.click(screen.getByRole("button", { name: /Filter Stage/ }));
  return screen.findByRole("dialog", { name: "Filter Stage" });
};

describe("ColumnFilter", () => {
  it("Clear all unticks everything and blocks Apply until a value is ticked", async () => {
    const { onChange } = setup();
    const panel = await openPanel();
    await userEvent.click(within(panel).getByRole("button", { name: "Clear all" }));
    within(panel).getAllByRole("checkbox").forEach((c) => expect(c).not.toBeChecked());
    expect(within(panel).getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(within(panel).getByText("Tick at least one value")).toBeInTheDocument();

    await userEvent.click(within(panel).getByRole("checkbox", { name: /Pre-editing/ }));
    expect(onChange).not.toHaveBeenCalled(); // ticks are a draft
    await userEvent.click(within(panel).getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith(["Pre-editing"]);
  });

  it("Select all applies as no filter; Esc cancels the draft", async () => {
    const { onChange } = setup(["Job Initiation"]);
    let panel = await openPanel();
    await userEvent.click(within(panel).getByRole("button", { name: "Select all" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenLastCalledWith([]);

    onChange.mockClear();
    panel = await openPanel();
    await userEvent.click(within(panel).getByRole("checkbox", { name: /Art Assessment/ }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stays open while its list scrolls", async () => {
    setup();
    const panel = await openPanel();
    fireEvent.scroll(within(panel).getByRole("list"));
    expect(screen.getByRole("dialog", { name: "Filter Stage" })).toBeInTheDocument();
  });
});
