// Deterministic name <-> fake-open_id mapping used across a simulation
// session, so "@张三" always maps to the same fake person, and Bitable person
// fields (which store bare {id}) can be enriched back to {id, name} on read
// the way real Feishu does.

const idToName = new Map<string, string>();
const nameToId = new Map<string, string>();

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9一-龥]+/g, "_") || "user";
}

export function getOrCreateFakeOpenId(name: string): string {
  const key = name.trim();
  if (nameToId.has(key)) return nameToId.get(key)!;
  const id = `ou_sim_${slugify(key)}`;
  nameToId.set(key, id);
  idToName.set(id, key);
  return id;
}

export function getNameForOpenId(openId: string): string | undefined {
  return idToName.get(openId);
}

export function reset(): void {
  idToName.clear();
  nameToId.clear();
}
