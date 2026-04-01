import { pendingTasks, getNextTask, needsPlanning } from "../backlog";
import type { BacklogTask, RepoBacklog } from "../types";

function makeTask(overrides: Partial<BacklogTask> = {}): BacklogTask {
  return {
    id: "test-1",
    repo: "owner/repo",
    title: "Test task",
    description: "Test description",
    changes: [],
    aggressiveness: 2,
    status: "pending",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeBacklog(tasks: BacklogTask[]): RepoBacklog {
  return { repo: "owner/repo", last_planned: "", tasks };
}

describe("pendingTasks", () => {
  it("returns only pending tasks", () => {
    const backlog = makeBacklog([
      makeTask({ id: "1", status: "pending" }),
      makeTask({ id: "2", status: "completed" }),
      makeTask({ id: "3", status: "pending" }),
      makeTask({ id: "4", status: "failed" }),
    ]);
    const result = pendingTasks(backlog);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.id)).toEqual(["1", "3"]);
  });

  it("sorts by aggressiveness ascending", () => {
    const backlog = makeBacklog([
      makeTask({ id: "1", aggressiveness: 4 }),
      makeTask({ id: "2", aggressiveness: 1 }),
      makeTask({ id: "3", aggressiveness: 3 }),
    ]);
    const result = pendingTasks(backlog);
    expect(result.map((t) => t.aggressiveness)).toEqual([1, 3, 4]);
  });

  it("returns empty array when no pending tasks", () => {
    const backlog = makeBacklog([
      makeTask({ status: "completed" }),
      makeTask({ status: "failed" }),
    ]);
    expect(pendingTasks(backlog)).toHaveLength(0);
  });
});

describe("getNextTask", () => {
  it("returns the lowest aggressiveness pending task", () => {
    const backlog = makeBacklog([
      makeTask({ id: "1", aggressiveness: 3 }),
      makeTask({ id: "2", aggressiveness: 1 }),
      makeTask({ id: "3", aggressiveness: 2 }),
    ]);
    expect(getNextTask(backlog)?.id).toBe("2");
  });

  it("returns undefined when no pending tasks", () => {
    const backlog = makeBacklog([makeTask({ status: "completed" })]);
    expect(getNextTask(backlog)).toBeUndefined();
  });
});

describe("needsPlanning", () => {
  it("returns true when no tasks exist", () => {
    expect(needsPlanning(makeBacklog([]))).toBe(true);
  });

  it("returns true when no pending tasks", () => {
    const backlog = makeBacklog([makeTask({ status: "completed" })]);
    expect(needsPlanning(backlog)).toBe(true);
  });

  it("returns false when pending tasks exist", () => {
    const backlog = makeBacklog([makeTask({ status: "pending" })]);
    expect(needsPlanning(backlog)).toBe(false);
  });
});
