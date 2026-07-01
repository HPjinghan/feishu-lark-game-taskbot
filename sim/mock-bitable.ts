import { getNameForOpenId } from "./registry";

export interface FakeRecord {
  record_id: string;
  fields: Record<string, any>;
}

let records: FakeRecord[] = [];
let nextTaskId = 1;

export function resetBitable(): void {
  records = [];
  nextTaskId = 1;
}

function enrichPersonFields(fields: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...fields };
  for (const key of ["人员", "验收人"]) {
    if (Array.isArray(out[key])) {
      out[key] = out[key].map((p: any) => ({ id: p.id, name: getNameForOpenId(p.id) || p.id }));
    }
  }
  return out;
}

export function createRecord(fields: Record<string, any>): FakeRecord {
  const record_id = `rec_${records.length + 1}`;
  const taskId = String(nextTaskId++);
  const record: FakeRecord = { record_id, fields: enrichPersonFields({ ...fields, TaskID: taskId }) };
  records.push(record);
  return record;
}

export function updateRecord(recordId: string, fields: Record<string, any>): FakeRecord | null {
  const record = records.find((r) => r.record_id === recordId);
  if (!record) return null;
  Object.assign(record.fields, enrichPersonFields(fields));
  return record;
}

export function getRecord(recordId: string): FakeRecord | null {
  return records.find((r) => r.record_id === recordId) || null;
}

export function searchRecords(filterFn: (r: FakeRecord) => boolean): FakeRecord[] {
  return records.filter(filterFn);
}

export function toApiRecord(record: FakeRecord): FakeRecord {
  return { record_id: record.record_id, fields: record.fields };
}

function normalizeForCompare(value: any): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Mirrors the subset of Bitable's filter conditions this bot actually issues: "is" and "contains". */
export function matchesCondition(record: FakeRecord, condition: { field_name: string; operator: string; value: string[] }): boolean {
  const fieldValue = record.fields[condition.field_name];
  const targets = condition.value;

  if (condition.operator === "is") {
    return targets.includes(normalizeForCompare(fieldValue));
  }

  if (condition.operator === "contains") {
    if (Array.isArray(fieldValue)) {
      const ids = fieldValue.map((p: any) => p?.id).filter(Boolean);
      return targets.some((v) => ids.includes(v));
    }
    const str = normalizeForCompare(fieldValue);
    return targets.some((v) => str.includes(v));
  }

  return false;
}
