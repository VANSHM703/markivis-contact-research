import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BrandLockup } from "@/components/shell/BrandLockup";
import { SidebarNav } from "@/components/shell/SidebarNav";
import { navItemsForRole } from "@/config/navigation";
import { PRODUCT_NAME } from "@/config/product";

vi.mock("next/navigation", () => ({ usePathname: () => "/people/abc" }));

describe("BrandLockup", () => {
  it("renders the mark, the word and the product sub-label, linking to the BEAM home", () => {
    render(<BrandLockup />);
    const link = screen.getByRole("link", { name: "BEAM by Markivis home" });
    expect(link).toHaveAttribute("href", "/");
    expect(link).toHaveTextContent("BEAM");
    expect(link).toHaveTextContent(PRODUCT_NAME);
  });
});

describe("SidebarNav", () => {
  it("marks the current section and shows counts with an accessible word", () => {
    render(<SidebarNav items={navItemsForRole("partner")} counts={{ "/actions": { value: 3, overdue: true } }} />);
    expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /Actions/ })).toHaveTextContent("3 overdue");
  });
});
