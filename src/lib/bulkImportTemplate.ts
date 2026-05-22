export const IMPORT_TEMPLATE = `{
  "version": 1,
  "tasks": [
    {
      "id": "t1",
      "name": "Phase 1 - Discovery",
      "description": "Stakeholder interviews and scope definition",
      "deliverable": "Signed scope document",
      "children": [
        {
          "id": "t1.1",
          "name": "Kickoff workshop",
          "start_date": "2026-06-01",
          "duration_days": 1
        },
        {
          "id": "t1.2",
          "name": "Stakeholder interviews",
          "start_date": "2026-06-02",
          "duration_days": 7,
          "predecessors": [{ "id": "t1.1", "type": "FS", "lag_days": 0 }]
        }
      ]
    },
    {
      "id": "t2",
      "name": "Phase 2 - Build",
      "children": [
        {
          "id": "t2.1",
          "name": "Build kickoff",
          "duration_days": 5,
          "predecessors": [{ "id": "t1.2", "type": "FS", "lag_days": 2 }]
        },
        {
          "id": "t2.2",
          "name": "Construction",
          "duration_days": 15,
          "predecessors": [{ "id": "t2.1", "type": "FS", "lag_days": 0 }]
        }
      ]
    }
  ]
}`;

export const IMPORT_AI_PROMPT = `You are converting source project material (documents, spreadsheets, notes) into a strict JSON document for bulk import into a project planner.

OUTPUT REQUIREMENTS
- Output ONLY a single valid JSON object. No prose, no markdown fences.
- Match the schema in the EXAMPLE below exactly. Field names, casing, and nesting must match.

SCHEMA
- Root object: { "version": 1, "tasks": [ Task, ... ] }
- Task:
    "id" (string, optional but required if referenced by deps; must be unique across the document)
    "name" (string, REQUIRED)
    "description" (string, optional)
    "deliverable" (string, optional)
    "start_date" (ISO "YYYY-MM-DD", optional)
    "end_date" (ISO "YYYY-MM-DD", optional)
    "duration_days" (integer working days, optional; used to compute end_date if end_date omitted)
    "progress" (integer 0-100, optional, default 0)
    "predecessors" (array of DepRef, optional)
    "successors" (array of DepRef, optional)
    "children" (array of Task, optional - nesting expresses hierarchy)
- DepRef: { "id": "<other-task-id>", "type": "FS" | "FF" | "SS" | "SF", "lag_days": <integer> }
  - "type" default "FS" (finish-to-start). "lag_days" default 0.

RULES
- Use "FS" unless the source material explicitly indicates otherwise.
- Reference predecessors/successors by the temp "id" of another task in this same document. Do NOT invent IDs that aren't defined.
- Dependencies must link LEAF tasks only (tasks without "children"). Parent/summary tasks cannot have predecessors or successors and cannot be referenced by them - their dates roll up from their children.
- Do NOT invent dependencies that are not stated or strongly implied in the source.
- Express hierarchy via nested "children" arrays. Do not flatten with a parent_id field.
- Do NOT set start_date / end_date / duration_days on parent tasks (those with "children"); leave dates only on leaves.
- If only a duration is given (no end_date), use "duration_days" and "start_date".
- Omit fields you don't have data for - don't fabricate.

EXAMPLE
`;

export function buildTemplateClipboardText(): string {
  return IMPORT_AI_PROMPT + IMPORT_TEMPLATE + '\n';
}
