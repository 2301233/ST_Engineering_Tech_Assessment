/**
 * This file contains the following unit tests:
 * 
 * Core flows:
 * - Initial mount data fetch + render
 * - Filter changes trigger refetch and reset to page 1
 * - Pagination (Next/Previous) refetches correct page
 * - Jump-to-page input and validation (including Enter key)
 *
 * Edge cases:
 * - Validating that params always include filter keys
 * - Pagination boundary button disabled behavior
 * - Empty backend data (total=0) renders safely
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";
import { expect, test, vi, beforeEach, afterEach, describe } from "vitest";
import axios from "axios";

// Mocks
vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

class MockEventSource {
  url: string;
  onmessage: ((event: { data: string }) => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  emitMessage(payload: any) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  static instances: MockEventSource[] = [];
}

// helper functions
function setFileOnInput(file: File) {
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  expect(fileInput).toBeTruthy();
  fireEvent.change(fileInput, { target: { files: [file] } });
  return fileInput;
}

describe("App", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    globalThis.EventSource = MockEventSource as any;

    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "confirm").mockImplementation(() => true);

    mockedAxios.get.mockResolvedValue({
      data: {
        data: [
          {
            id: 1,
            post_id: 1,
            csv_id: 10,
            name: "Alice",
            email: "alice@test.com",
            body: "Hello",
          },
        ],
        total: 6,
      },
    });

    mockedAxios.post.mockResolvedValue({ data: { message: "ok" } });
    mockedAxios.delete.mockResolvedValue({ data: { ok: true } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test("fetches data on mount and renders table row + pagination text", async () => {
    render(<App />);

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("alice@test.com")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();

    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();
  });

  test("updates jumpPage input when user types", async () => {
    render(<App />);

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());

    const input = screen.getByLabelText(/Go to page:/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });

    expect(input.value).toBe("5");
  });

  test("typing in filter triggers refetch with params and resets to page 1", async () => {
    render(<App />);

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    const nameFilter = screen.getByPlaceholderText(/Name\.\.\./i) as HTMLInputElement;
    fireEvent.change(nameFilter, { target: { value: "Al" } });

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(2));

    const [, config] = mockedAxios.get.mock.calls[1];
    expect(config.params.page).toBe(1);
    expect(config.params.limit).toBe(5);
    expect(config.params.name).toBe("Al");
  });

  test("Next/Previous pagination triggers refetch with correct page", async () => {
    render(<App />);

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    const nextBtn = screen.getByRole("button", { name: /Next/i });
    fireEvent.click(nextBtn);

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(2));
    expect(mockedAxios.get.mock.calls[1][1].params.page).toBe(2);

    const prevBtn = screen.getByRole("button", { name: /Previous/i });
    fireEvent.click(prevBtn);

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(3));
    expect(mockedAxios.get.mock.calls[2][1].params.page).toBe(1);
  });

  test("jump to page calls fetch with entered page, then clears input", async () => {
    render(<App />);

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText(/Go to page:/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2" } });

    const goBtn = screen.getByRole("button", { name: /^Go$/i });
    fireEvent.click(goBtn);

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(2));
    expect(mockedAxios.get.mock.calls[1][1].params.page).toBe(2);

    expect(input.value).toBe("");
  });

  test("jump to page shows alert when invalid page entered", async () => {
    render(<App />);

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText(/Go to page:/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "999" } });

    const goBtn = screen.getByRole("button", { name: /^Go$/i });
    fireEvent.click(goBtn);

    expect(window.alert).toHaveBeenCalled();
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  test("Clear All Data calls delete and resets table (confirm=true)", async () => {
    render(<App />);

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Alice")).toBeInTheDocument();

    const clearBtn = screen.getByRole("button", { name: /Clear All Data/i });
    fireEvent.click(clearBtn);

    await waitFor(() => expect(mockedAxios.delete).toHaveBeenCalledTimes(1));
    expect(window.confirm).toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    });

    expect(screen.getByText(/Page 1 of 0/i)).toBeInTheDocument();
  });

  test("Clear All Data does nothing when confirm=false", async () => {
    (window.confirm as any).mockReturnValueOnce(false);

    render(<App />);
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    const clearBtn = screen.getByRole("button", { name: /Clear All Data/i });
    fireEvent.click(clearBtn);

    expect(mockedAxios.delete).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  test("Upload button disabled until file selected", async () => {
    render(<App />);
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    const uploadBtn = screen.getByTestId("upload-btn") as HTMLButtonElement;
    expect(uploadBtn).toBeDisabled();

    const file = new File(["a,b\n1,2"], "test.csv", { type: "text/csv" });
    setFileOnInput(file);

    expect(uploadBtn).not.toBeDisabled();
  });

  test("Upload flow: creates EventSource, posts FormData, updates progress text, handles Finished message", async () => {
    render(<App />);

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    const file = new File(["a,b\n1,2"], "test.csv", { type: "text/csv" });
    const fileInput = setFileOnInput(file);

    const uploadBtn = screen.getByTestId("upload-btn");
    fireEvent.click(uploadBtn);

    await waitFor(() => {
      expect(MockEventSource.instances.length).toBe(1);
    });

    await waitFor(() => expect(mockedAxios.post).toHaveBeenCalledTimes(1));
    expect(String(mockedAxios.post.mock.calls[0][0])).toContain("/upload");

    const es = MockEventSource.instances[0];

    es.emitMessage({ current: 2, total: 2, message: "Finished" });

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalled();
      expect(es.close).toHaveBeenCalled();
    });

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(2));

    expect(fileInput.value).toBe("");
  });

  // Edge Tests

  test("API calls include current filters even if empty (sanity)", async () => {
    render(<App />);
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    const [, config] = mockedAxios.get.mock.calls[0];
    expect(config.params).toEqual(
      expect.objectContaining({
        page: 1,
        limit: 5,
        name: "",
        email: "",
        body: "",
        post_id: "",
        csv_id: "",
      })
    );
  });

  test("pagination buttons are disabled at boundaries", async () => {
    render(<App />);
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    const prevBtn = screen.getByRole("button", { name: /Previous/i }) as HTMLButtonElement;
    const nextBtn = screen.getByRole("button", { name: /Next/i }) as HTMLButtonElement;

    expect(prevBtn).toBeDisabled();
    expect(nextBtn).not.toBeDisabled();

    fireEvent.click(nextBtn);
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(2));

    expect(nextBtn).toBeDisabled();
    expect(prevBtn).not.toBeDisabled();
  });

  test("jump to page via Enter key triggers fetch", async () => {
    render(<App />);
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText(/Go to page:/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2" } });

    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(2));
    expect(mockedAxios.get.mock.calls[1][1].params.page).toBe(2);
  });

  test("jump to page with 0 or negative triggers alert and does not fetch", async () => {
    render(<App />);
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText(/Go to page:/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });

    fireEvent.click(screen.getByRole("button", { name: /^Go$/i }));

    expect(window.alert).toHaveBeenCalled();
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  test("jump to page with non-number triggers alert and does not fetch", async () => {
    render(<App />);
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText(/Go to page:/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });

    fireEvent.click(screen.getByRole("button", { name: /^Go$/i }));

    expect(window.alert).toHaveBeenCalled();
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  test("Upload: if no file is selected, clicking Upload does nothing (no EventSource, no POST)", async () => {
    render(<App />);
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    const uploadBtn = screen.getByTestId("upload-btn") as HTMLButtonElement;
    fireEvent.click(uploadBtn);

    expect(MockEventSource.instances.length).toBe(0);
    expect(mockedAxios.post).toHaveBeenCalledTimes(0);
  });

  test("Upload: SSE 'Finished' triggers setPage(1) and refetch uses page=1 even if you were on page 2", async () => {
    render(<App />);
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("next-btn") as HTMLButtonElement);
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(2));
    expect(mockedAxios.get.mock.calls[1][1].params.page).toBe(2);

    const file = new File(["a,b\n1,2"], "test.csv", { type: "text/csv" });
    setFileOnInput(file);

    fireEvent.click(screen.getByTestId("upload-btn"));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];

    es.emitMessage({ current: 1, total: 1, message: "Finished" });

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(4));
    const lastCall = mockedAxios.get.mock.calls[mockedAxios.get.mock.calls.length - 1];
    expect(lastCall[1].params.page).toBe(1);
  });

  test("renders empty state safely when backend returns no rows and total=0", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { data: [], total: 0 },
    });

    render(<App />);

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(1));

    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.getByTestId("page-text")).toHaveTextContent(/Page 1 of 0/i);
  });
});
