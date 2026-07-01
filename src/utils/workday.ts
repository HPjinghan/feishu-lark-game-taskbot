import { TYPE_PREREQUISITES } from "../config";

// All scheduling math anchors on noon (12:00) Asia/Shanghai, matching the
// convention in utils/parse.ts's parseDueDateToMs — see the comment there for
// why noon (not midnight) is used to dodge timezone-display bugs.
export const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function shanghaiWeekday(ms: number): number {
  // 0 = Sunday ... 6 = Saturday, per the calendar date in Asia/Shanghai.
  return new Date(ms + SHANGHAI_OFFSET_MS).getUTCDay();
}

export function isWeekend(ms: number): boolean {
  const day = shanghaiWeekday(ms);
  return day === 0 || day === 6;
}

/** Rolls a timestamp forward to the next working day (returns it unchanged if already a workday). */
export function nextWorkday(ms: number): number {
  let cur = ms;
  while (isWeekend(cur)) cur += DAY_MS;
  return cur;
}

/**
 * Returns the date that is `n` working days after `ms`, skipping weekends.
 * n=0 means "the same day" (rolled forward to a workday first if needed) —
 * i.e. a 1-day task starting at `ms` has due date === addWorkdays(ms, 0).
 */
export function addWorkdays(ms: number, n: number): number {
  let cur = nextWorkday(ms);
  for (let i = 0; i < n; i++) {
    cur = nextWorkday(cur + DAY_MS);
  }
  return cur;
}

/**
 * Given the due dates of someone's other currently-active tasks, returns
 * their next truly free working day — one day after their latest commitment
 * ends (rolled to a workday), or today if they have nothing pending. Used so
 * a bare "N天" duration on a new task doesn't silently assume someone is free
 * starting tomorrow when they're actually still busy with existing work.
 */
export function resolveOwnerNextFreeDay(existingDueDates: number[], now: number = Date.now()): number {
  if (existingDueDates.length === 0) return nextWorkday(now);
  const latestDue = Math.max(...existingDueDates);
  return nextWorkday(Math.max(now, latestDue + DAY_MS));
}

export interface SchedulableTask {
  id: string;
  owner: string; // person or role name — tasks sharing an owner run sequentially, never in parallel
  durationDays: number; // working days, >= 1
  dependsOn: string[]; // ids of tasks that must finish first
}

export interface ScheduledTask extends SchedulableTask {
  startDate: number;
  dueDate: number;
}

/**
 * Schedules a dependency graph of tasks starting no earlier than `startFrom`.
 * Respects two constraints simultaneously:
 *   - a task can't start until every task it depends on has finished (+1 workday buffer)
 *   - a task can't start until its owner is free (owners work one task at a time)
 * Throws if the dependency graph has a cycle.
 */
export function scheduleTasks(tasks: SchedulableTask[], startFrom: number): ScheduledTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const scheduled = new Map<string, ScheduledTask>();
  const ownerNextAvailable = new Map<string, number>();

  const dependents = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const t of tasks) {
    inDegree.set(t.id, t.dependsOn.length);
    for (const dep of t.dependsOn) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(t.id);
    }
  }

  // Kahn's algorithm for a valid dependency order.
  const queue: string[] = tasks.filter((t) => t.dependsOn.length === 0).map((t) => t.id);
  const order: string[] = [];
  const remainingInDegree = new Map(inDegree);
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const dependentId of dependents.get(id) || []) {
      const next = (remainingInDegree.get(dependentId) || 0) - 1;
      remainingInDegree.set(dependentId, next);
      if (next === 0) queue.push(dependentId);
    }
  }
  if (order.length !== tasks.length) {
    throw new Error("Dependency cycle detected among scheduled tasks");
  }

  for (const id of order) {
    const task = byId.get(id)!;
    let earliestStart = nextWorkday(startFrom);

    for (const depId of task.dependsOn) {
      const dep = scheduled.get(depId);
      if (!dep) continue;
      const afterDep = nextWorkday(dep.dueDate + DAY_MS);
      if (afterDep > earliestStart) earliestStart = afterDep;
    }

    const ownerFree = ownerNextAvailable.get(task.owner);
    if (ownerFree !== undefined && ownerFree > earliestStart) earliestStart = ownerFree;

    const start = nextWorkday(earliestStart);
    const due = addWorkdays(start, Math.max(1, task.durationDays) - 1);

    scheduled.set(id, { ...task, startDate: start, dueDate: due });
    ownerNextAvailable.set(task.owner, nextWorkday(due + DAY_MS));
  }

  return order.map((id) => scheduled.get(id)!);
}

/**
 * Given a task type and the set of types actually present in this batch,
 * returns which of its configured prerequisite types apply — skipping any
 * prerequisite type that isn't part of the current feature breakdown.
 */
export function resolvePrerequisiteTypes(taskType: string, presentTypes: Set<string>): string[] {
  const prereqs = TYPE_PREREQUISITES[taskType] || [];
  return prereqs.filter((p) => presentTypes.has(p));
}
