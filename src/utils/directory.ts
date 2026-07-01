import type { Env, BoundUser } from "../types";
import { kvGet, kvPut } from "../kv";

const DIRECTORY_KEY = "directory:known_users";

// The bot builds this directory organically — every time it sees a real
// @mention in ANY message (not just scheduling commands), it remembers that
// name -> open_id pairing. This means fuzzy name lookup gets more reliable
// the more the team uses the bot normally, with zero extra setup step.

async function loadDirectory(env: Env): Promise<BoundUser[]> {
  const raw = await kvGet(env, DIRECTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveDirectory(env: Env, users: BoundUser[]): Promise<void> {
  await kvPut(env, DIRECTORY_KEY, JSON.stringify(users));
}

/** Records users as "seen" so future fuzzy name lookups can resolve them without a fresh @mention. */
export async function recordUsersSeen(env: Env, users: BoundUser[]): Promise<void> {
  const withIds = users.filter((u) => u.openId);
  if (withIds.length === 0) return;

  const directory = await loadDirectory(env);
  const byId = new Map(directory.map((u) => [u.openId, u]));
  let changed = false;

  for (const user of withIds) {
    const existing = byId.get(user.openId);
    if (!existing || existing.name !== user.name) {
      byId.set(user.openId, user);
      changed = true;
    }
  }

  if (changed) await saveDirectory(env, [...byId.values()]);
}

export type NameLookupResult =
  | { status: "found"; user: BoundUser }
  | { status: "ambiguous"; matches: BoundUser[] }
  | { status: "not_found" };

/**
 * Fuzzy-resolves a typed name (no @mention) against the directory of users
 * the bot has previously seen. Exact (case-insensitive) match wins outright;
 * otherwise falls back to substring matching in either direction. Returns
 * "ambiguous" rather than guessing when more than one person could match —
 * per the "only ask when uncertain" principle, that's the one case the
 * caller should surface to the user instead of silently picking one.
 */
export async function findUserByName(env: Env, query: string): Promise<NameLookupResult> {
  const q = query.trim().toLowerCase();
  if (!q) return { status: "not_found" };

  const directory = await loadDirectory(env);

  const exact = directory.filter((u) => u.name.toLowerCase() === q);
  if (exact.length === 1) return { status: "found", user: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", matches: exact };

  const partial = directory.filter(
    (u) => u.name.toLowerCase().includes(q) || q.includes(u.name.toLowerCase()),
  );
  if (partial.length === 1) return { status: "found", user: partial[0] };
  if (partial.length > 1) return { status: "ambiguous", matches: partial };

  return { status: "not_found" };
}

/**
 * Resolves a comma/顿号-separated list of names (e.g. "张三、李四") into
 * users, supporting the "a task can have multiple owners" case. Names that
 * fail to resolve (not found or ambiguous) are reported separately so the
 * caller can ask about just those, instead of failing the whole batch.
 */
export async function findUsersByNames(
  env: Env,
  namesText: string,
): Promise<{ found: BoundUser[]; unresolved: { name: string; result: NameLookupResult }[] }> {
  const names = namesText
    .split(/[,，、\/]+/)
    .map((n) => n.trim())
    .filter(Boolean);

  const found: BoundUser[] = [];
  const unresolved: { name: string; result: NameLookupResult }[] = [];

  for (const name of names) {
    const result = await findUserByName(env, name);
    if (result.status === "found") {
      found.push(result.user);
    } else {
      unresolved.push({ name, result });
    }
  }

  return { found, unresolved };
}
