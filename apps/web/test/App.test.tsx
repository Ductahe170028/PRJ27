import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "../src/app/App";

describe("App", () => {
  it("renders the application shell and its three workspace regions", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "MindX 360" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Chế độ ứng dụng")).toHaveTextContent(
      "V1 · Chỉ đọc",
    );
    expect(
      screen.getByRole("region", { name: "Cây dữ liệu" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Chi tiết" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Liên kết" }),
    ).toBeInTheDocument();

    await user.tab();
    expect(
      screen.getByRole("link", { name: "Đi đến khu vực làm việc" }),
    ).toHaveFocus();
  });
});

