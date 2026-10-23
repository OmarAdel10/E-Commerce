import type { Database } from "@scalius/database/client";
import { objectRecords } from "@scalius/database/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { OBJECT_OPERATION_RESPONSE_MAX_BYTES, objectHandleFrom, objectRecordTitle, objectTypeDeclarationSchema, type ObjectTypeView, type ObjectRecordView, type ObjectStatus } from "@scalius/shared/plugins/objects";
import { ObjectError } from "./errors";
import { getObjectType } from "./types";
import { queryObjectRecords, objectCursorAfter, getObjectRecordVersion, writeObjectRecords, deleteObjectRecord, type ObjectQueryInput } from "./records";

export type { ObjectRecordView } from "@scalius/shared/plugins/objects";
export function objectDeclaration(type: ObjectTypeView) {
  return objectTypeDeclarationSchema.parse({ name: type.name, description: type.description ?? undefined, fields: type.fields,
    display: type.display ?? undefined, indexes: type.indexes, unique: type.unique, handle: type.handleEnabled,
    storefront: type.storefront, admin: type.admin, events: type.events });
}
async function visibleType(db: Database, id: string, write = false): Promise<ObjectTypeView> {
  const type = await getObjectType(db, id);
  if (!type || type.admin === "none") throw new ObjectError("object_not_found", "Object type not found.");
  if (write && type.admin !== "edit") throw new ObjectError("object_forbidden", "This app's objects are read-only.");
  return type;
}
const iso = (seconds: number) => new Date(Number(seconds) * 1000).toISOString();
async function present(db: Database, type: ObjectTypeView, id: string): Promise<ObjectRecordView | null> {
  const version = await getObjectRecordVersion(db, type.namespace, type.type, id);
  if (!version) return null;
  const row = await db.select({ position: objectRecords.position, createdAt: objectRecords.createdAt, updatedAt: objectRecords.updatedAt })
    .from(objectRecords).where(and(eq(objectRecords.typeId, type.id), eq(objectRecords.id, id))).get();
  if (!row) return null;
  return { id, typeId: type.id, handle: version.handle, status: version.status, data: version.data,
    displayName: objectRecordTitle(type, { id, handle: version.handle, data: version.data }),
    position: row.position, revision: version.revision, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}
/** One page of a type's records: the stable list shape, `{ records, nextCursor }` (no count is read). */
export async function listObjectRecords(db: Database, id: string, options: ObjectQueryInput = {}): Promise<{ records: ObjectRecordView[]; nextCursor: string | null }> {
  const type = await visibleType(db, id);
  const page = await queryObjectRecords(db, type.namespace, type.type, objectDeclaration(type), options);
  const ids = page.records.map((row) => row.id);
  const rows = ids.length ? await db.select().from(objectRecords).where(and(eq(objectRecords.typeId, type.id),
    sql`${objectRecords.id} IN (SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(ids)}))`)).all() : [];
  const records = page.records.flatMap(({ id: recordId, data }): ObjectRecordView[] => {
    const row = rows.find((candidate) => candidate.id === recordId);
    if (!row) return [];
    return [{ id: recordId, typeId: type.id, handle: row.handle, status: row.status, data,
      displayName: objectRecordTitle(type, { id: recordId, handle: row.handle, data }),
      position: row.position, revision: row.revision, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }];
  });
  const result = { records, nextCursor: page.nextCursor };
  // Reserve room for the continuation cursor and the MCP dispatch envelope.
  const budget = OBJECT_OPERATION_RESPONSE_MAX_BYTES - 4096;
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  let size = bytes({ success: true, data: { ...result, records: [], nextCursor: null } });
  let length = 0;
  for (const record of records) {
    size += bytes(record) + (length ? 1 : 0);
    if (size > budget) break;
    length++;
  }
  if (length === records.length) return result;
  if (!length) throw new ObjectError("object_response_too_large", "This type and record exceed the object list response budget; get the record directly.");
  const last = rows.find((row) => row.id === records[length - 1]!.id)!;
  return { ...result, records: records.slice(0, length), nextCursor: await objectCursorAfter(db, objectDeclaration(type), options, last) };
}
export async function getObjectEntry(db: Database, typeId: string, id: string): Promise<ObjectRecordView | null> {
  return present(db, await visibleType(db, typeId), id);
}
/**
 * The first free handle made from a new entry's title: `title`, then
 * `title-2`, `title-3`… One bounded read of the handles that start the same
 * way (`[base, base + ".")` holds exactly `base` and `base-…`). No title, no handle.
 */
async function handleFromTitle(db: Database, type: ObjectTypeView, id: string, data: Record<string, unknown>): Promise<string | undefined> {
  const title = objectRecordTitle(type, { id, handle: null, data });
  if (title === id) return undefined;
  const base = objectHandleFrom(title);
  const taken = new Set((await db.select({ handle: objectRecords.handle }).from(objectRecords)
    .where(and(eq(objectRecords.typeId, type.id), gte(objectRecords.handle, base), lt(objectRecords.handle, `${base}.`)))
    .limit(HANDLE_SUFFIXES).all()).map((row) => row.handle));
  for (let n = 1; n <= HANDLE_SUFFIXES; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const candidate = `${base.slice(0, 100 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return undefined;
}
const HANDLE_SUFFIXES = 100;
export async function upsertObjectRecord(db: Database, typeId: string, id: string, input: {
  data: Record<string, unknown>; expectedRevision: number | null; handle?: string; status?: ObjectStatus; position?: number;
}): Promise<ObjectRecordView> {
  const type = await visibleType(db, typeId, true);
  // A new entry left without a handle gets one from its title, as the entry form says.
  const handle = input.handle?.trim() || (input.expectedRevision === null && type.handleEnabled ? await handleFromTitle(db, type, id, input.data) : input.handle);
  await writeObjectRecords(db, type.namespace, () => objectDeclaration(type), [{ op: "put", object: type.type, id, record: input.data,
    expectedRevision: input.expectedRevision, ...(handle !== undefined ? { handle } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}), ...(input.position !== undefined ? { position: input.position } : {}) }]);
  const record = await present(db, type, id);
  if (!record) throw new ObjectError("object_not_found", "Object record not found.");
  return record;
}
export async function deleteObjectEntry(db: Database, typeId: string, id: string, expectedRevision: number): Promise<void> {
  const type = await visibleType(db, typeId, true);
  await deleteObjectRecord(db, type.namespace, type.type, id, expectedRevision);
}

export async function getObjectEventRepresentation(db: Database, typeId: string, id: string): Promise<ObjectRecordView | null> {
  const type = await getObjectType(db, typeId);
  return type && type.admin !== "none" ? present(db, type, id) : null;
}
