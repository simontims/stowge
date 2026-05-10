import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useNumericField } from "../src/hooks/useNumericField";

/**
 * Test component that uses the useNumericField hook.
 * Useful for testing hook behavior in a component context.
 */
function TestComponent({
  initialValue,
  min,
  max,
  fallback,
  integer = true,
}: {
  initialValue: number;
  min?: number;
  max?: number;
  fallback: number;
  integer?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const field = useNumericField(value, setValue, { min, max, fallback, integer });

  return (
    <div>
      <input
        type="number"
        data-testid="numeric-input"
        {...field}
        aria-label="test-input"
      />
      <div data-testid="value-display">{value}</div>
    </div>
  );
}

describe("useNumericField", () => {
  describe("onChange behavior", () => {
    it("allows user to clear the field without snapping back", async () => {
      const user = userEvent.setup();
      render(
        <TestComponent
          initialValue={5}
          min={0}
          max={100}
          fallback={0}
        />
      );

      const input = screen.getByTestId("numeric-input") as HTMLInputElement;
      expect(input.value).toBe("5");

      // Clear the field
      await user.clear(input);
      expect(input.value).toBe("");

      // Field should still be empty (not snapped back)
      expect(input.value).toBe("");
    });

    it("allows typing partial values without auto-correction", async () => {
      const user = userEvent.setup();
      render(
        <TestComponent
          initialValue={0}
          min={0}
          max={100}
          fallback={0}
        />
      );

      const input = screen.getByTestId("numeric-input") as HTMLInputElement;
      await user.clear(input);
      await user.type(input, "2");

      expect(input.value).toBe("2");

      // Continue typing to "25"
      await user.type(input, "5");
      expect(input.value).toBe("25");
    });
  });

  describe("onBlur behavior", () => {
    it("snaps empty field to fallback value on blur", async () => {
      const user = userEvent.setup();
      render(
        <TestComponent
          initialValue={5}
          min={0}
          max={100}
          fallback={0}
        />
      );

      const input = screen.getByTestId("numeric-input") as HTMLInputElement;
      const display = screen.getByTestId("value-display");

      await user.clear(input);
      expect(input.value).toBe("");

      // Blur the input
      await user.click(display);

      // Should snap to fallback (0)
      expect(input.value).toBe("0");
    });

    it("clamps value to min on blur", async () => {
      const user = userEvent.setup();
      render(
        <TestComponent
          initialValue={50}
          min={10}
          max={100}
          fallback={50}
        />
      );

      const input = screen.getByTestId("numeric-input") as HTMLInputElement;
      const display = screen.getByTestId("value-display");

      await user.clear(input);
      await user.type(input, "5");
      await user.click(display); // Blur

      expect(input.value).toBe("10");
    });

    it("clamps value to max on blur", async () => {
      const user = userEvent.setup();
      render(
        <TestComponent
          initialValue={50}
          min={0}
          max={100}
          fallback={50}
        />
      );

      const input = screen.getByTestId("numeric-input") as HTMLInputElement;
      const display = screen.getByTestId("value-display");

      await user.clear(input);
      await user.type(input, "150");
      await user.click(display); // Blur

      expect(input.value).toBe("100");
    });

    it("uses fallback when invalid input on blur", async () => {
      const user = userEvent.setup();
      render(
        <TestComponent
          initialValue={50}
          min={0}
          max={100}
          fallback={25}
        />
      );

      const input = screen.getByTestId("numeric-input") as HTMLInputElement;
      const display = screen.getByTestId("value-display");

      await user.clear(input);
      await user.type(input, "abc");
      await user.click(display); // Blur

      // Should use fallback
      expect(input.value).toBe("25");
    });

    it("commits valid value to parent state on blur", async () => {
      const user = userEvent.setup();
      render(
        <TestComponent
          initialValue={0}
          min={0}
          max={100}
          fallback={0}
        />
      );

      const input = screen.getByTestId("numeric-input") as HTMLInputElement;
      const display = screen.getByTestId("value-display");

      await user.clear(input);
      await user.type(input, "42");
      await user.click(display); // Blur

      // Parent state should update to 42
      expect(display.textContent).toBe("42");
    });
  });

  describe("external value changes", () => {
    it("syncs raw display when committed value changes externally", async () => {
      const { rerender } = render(
        <TestComponent
          initialValue={10}
          min={0}
          max={100}
          fallback={0}
        />
      );

      const input = screen.getByTestId("numeric-input") as HTMLInputElement;
      expect(input.value).toBe("10");

      // Re-render with different value (simulating external change, like form reset)
      rerender(
        <TestComponent
          initialValue={50}
          min={0}
          max={100}
          fallback={0}
        />
      );

      // Input should update to new value
      expect(input.value).toBe("50");
    });
  });

  describe("integer vs float parsing", () => {
    it("parses as integer by default", async () => {
      const user = userEvent.setup();
      render(
        <TestComponent
          initialValue={0}
          min={0}
          max={100}
          fallback={0}
          integer={true}
        />
      );

      const input = screen.getByTestId("numeric-input") as HTMLInputElement;
      const display = screen.getByTestId("value-display");

      await user.clear(input);
      await user.type(input, "3.7");
      await user.click(display); // Blur

      // Should parse as 3 (integer parsing)
      expect(input.value).toBe("3");
    });

    it("parses as float when integer=false", async () => {
      const user = userEvent.setup();
      render(
        <TestComponent
          initialValue={0}
          min={0}
          max={100}
          fallback={0}
          integer={false}
        />
      );

      const input = screen.getByTestId("numeric-input") as HTMLInputElement;
      const display = screen.getByTestId("value-display");

      await user.clear(input);
      await user.type(input, "3.7");
      await user.click(display); // Blur

      // Should parse as 3.7 (float parsing)
      expect(input.value).toBe("3.7");
    });
  });

  describe("quantity-specific behavior", () => {
    it("allows quantity of 0 with fallback to 0 on empty", async () => {
      const user = userEvent.setup();
      render(
        <TestComponent
          initialValue={5}
          min={0}
          fallback={0}
        />
      );

      const input = screen.getByTestId("numeric-input") as HTMLInputElement;
      const display = screen.getByTestId("value-display");

      await user.clear(input);
      await user.type(input, "0");
      await user.click(display); // Blur

      expect(input.value).toBe("0");
      expect(display.textContent).toBe("0");
    });

    it("clamps negative values to 0", async () => {
      const user = userEvent.setup();
      render(
        <TestComponent
          initialValue={5}
          min={0}
          fallback={0}
        />
      );

      const input = screen.getByTestId("numeric-input") as HTMLInputElement;
      const display = screen.getByTestId("value-display");

      await user.clear(input);
      await user.type(input, "-5");
      await user.click(display); // Blur

      // Should clamp to 0 (min value)
      expect(input.value).toBe("0");
    });
  });
});
