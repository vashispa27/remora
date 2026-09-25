/**
 * Deterministic fake verifier for the DynamoDB fixture. Checks structured
 * elements/values in the observation, not free text coincidence.
 *
 * OWNER: fakes subagent.
 */
import type { PageElement, PageObservation } from "@remora/protocol";
import type {
  FinalVerificationRequest,
  MilestoneVerificationRequest,
  Verifier,
} from "../core/contracts.js";
import type { Verification } from "../schemas/domain.js";

export interface FakeVerifierOptions {
  tableName?: string;
  partitionKey?: string;
}

interface CriterionResult {
  ok: boolean;
  citations: Verification["citations"];
  reason?: string;
}

const DEFAULT_TABLE_NAME = "remora-demo";
const DEFAULT_PARTITION_KEY = "id";

/** Words ignored when falling back to keyword matching. */
const STOPWORDS = new Set([
  "table",
  "tables",
  "shown",
  "listed",
  "visible",
  "contains",
  "status",
  "field",
  "fields",
  "form",
  "with",
  "and",
  "the",
]);

function elementText(el: PageElement): string {
  return [el.name, el.text, el.value, el.label, el.description]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" ");
}

function flattenText(obs: PageObservation): string {
  return [obs.tab.url, obs.tab.title, ...obs.elements.map(elementText)].join(" ");
}

function findTextbox(obs: PageObservation, name: string): PageElement | undefined {
  return obs.elements.find(
    (el) => el.role === "textbox" && el.name === name && el.visible && el.editable,
  );
}

function findByText(obs: PageObservation, value: string): PageElement | undefined {
  return obs.elements.find((el) => el.text === value || el.value === value);
}

function keywords(criterion: string): string[] {
  return criterion
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 5 && !STOPWORDS.has(t));
}

function notOk(reason: string, citations: Verification["citations"] = []): CriterionResult {
  return { ok: false, citations, reason };
}

export class FakeVerifier implements Verifier {
  private readonly tableName: string;
  private readonly partitionKey: string;

  constructor(options: FakeVerifierOptions = {}) {
    this.tableName = options.tableName ?? DEFAULT_TABLE_NAME;
    this.partitionKey = options.partitionKey ?? DEFAULT_PARTITION_KEY;
  }

  private checkForm(obs: PageObservation): CriterionResult {
    const urlOk = obs.tab.url.includes("create-table");
    const tableName = findTextbox(obs, "Table name");
    const partitionKey = findTextbox(obs, "Partition key");

    const citations: Verification["citations"] = [];
    if (tableName) citations.push({ ref: tableName.ref, fact: 'textbox "Table name" is visible' });
    if (partitionKey) {
      citations.push({ ref: partitionKey.ref, fact: 'textbox "Partition key" is visible' });
    }

    if (urlOk && tableName && partitionKey) return { ok: true, citations };
    const missing = [
      !urlOk ? "URL does not contain create-table" : null,
      !tableName ? 'textbox "Table name" is not visible' : null,
      !partitionKey ? 'textbox "Partition key" is not visible' : null,
    ].filter((v): v is string => v !== null);
    return notOk(missing.join("; "), citations);
  }

  private checkFields(obs: PageObservation): CriterionResult {
    const tableName = findTextbox(obs, "Table name");
    const partitionKey = findTextbox(obs, "Partition key");
    const tableNameOk = tableName?.value === this.tableName;
    const partitionKeyOk = partitionKey?.value === this.partitionKey;

    const citations: Verification["citations"] = [];
    if (tableName) {
      citations.push({
        ref: tableName.ref,
        fact: `textbox "Table name" value is "${tableName.value ?? ""}"`,
      });
    }
    if (partitionKey) {
      citations.push({
        ref: partitionKey.ref,
        fact: `textbox "Partition key" value is "${partitionKey.value ?? ""}"`,
      });
    }

    if (tableNameOk && partitionKeyOk) return { ok: true, citations };
    const missing = [
      !tableNameOk
        ? `textbox "Table name" value is not "${this.tableName}"`
        : null,
      !partitionKeyOk
        ? `textbox "Partition key" value is not "${this.partitionKey}"`
        : null,
    ].filter((v): v is string => v !== null);
    return notOk(missing.join("; "), citations);
  }

  private checkTable(obs: PageObservation): CriterionResult {
    const urlOk = obs.tab.url.includes("created");
    const textHasName = flattenText(obs).includes(this.tableName);
    const link = findByText(obs, this.tableName);
    const active = findByText(obs, "Active");

    const citations: Verification["citations"] = [];
    if (link) citations.push({ ref: link.ref, fact: `element text is "${this.tableName}"` });
    if (active) citations.push({ ref: active.ref, fact: 'element text is "Active"' });

    if (urlOk && textHasName && active) return { ok: true, citations };
    const missing = [
      !urlOk ? "URL does not contain created" : null,
      !textHasName ? `observation text does not include "${this.tableName}"` : null,
      !active ? 'no element text/value equals "Active"' : null,
    ].filter((v): v is string => v !== null);
    return notOk(missing.join("; "), citations);
  }

  private checkKeyword(obs: PageObservation, criterion: string): CriterionResult {
    const tokens = keywords(criterion);
    const flat = flattenText(obs).toLowerCase();
    const matched = tokens.filter((t) => flat.includes(t));
    const ok = tokens.length > 0 && matched.length === tokens.length;

    const citations: Verification["citations"] = [];
    const match = obs.elements.find((el) => {
      const text = elementText(el).toLowerCase();
      return matched.some((t) => text.includes(t));
    });
    if (match) citations.push({ ref: match.ref, fact: `element text is "${elementText(match)}"` });

    if (ok) return { ok: true, citations };
    const missing = tokens.filter((t) => !flat.includes(t));
    return notOk(`missing keyword(s): ${missing.join(", ")}`, citations);
  }

  private evaluate(obs: PageObservation, criterion: string): CriterionResult {
    const lower = criterion.toLowerCase();
    if (lower.includes("create table form is visible")) return this.checkForm(obs);
    if (lower.includes("table name field contains")) {
      const tableName = findTextbox(obs, "Table name");
      const ok = tableName?.value === this.tableName;
      if (ok) {
        return {
          ok: true,
          citations: [
            {
              ref: tableName!.ref,
              fact: `textbox "Table name" value is "${tableName!.value ?? ""}"`,
            },
          ],
        };
      }
      return notOk(`textbox "Table name" value is not "${this.tableName}"`, tableName
        ? [{ ref: tableName.ref, fact: `textbox "Table name" value is "${tableName.value ?? ""}"` }]
        : []);
    }
    if (lower.includes("partition key field contains")) {
      const partitionKey = findTextbox(obs, "Partition key");
      const ok = partitionKey?.value === this.partitionKey;
      if (ok) {
        return {
          ok: true,
          citations: [
            {
              ref: partitionKey!.ref,
              fact: `textbox "Partition key" value is "${partitionKey!.value ?? ""}"`,
            },
          ],
        };
      }
      return notOk(
        `textbox "Partition key" value is not "${this.partitionKey}"`,
        partitionKey
          ? [
              {
                ref: partitionKey.ref,
                fact: `textbox "Partition key" value is "${partitionKey.value ?? ""}"`,
              },
            ]
          : [],
      );
    }
    if (lower.includes("table list shows") || lower.includes("listed with status active")) {
      return this.checkTable(obs);
    }
    return this.checkKeyword(obs, criterion);
  }

  private evaluateAll(obs: PageObservation, criteria: string[]): Verification {
    const citations: Verification["citations"] = [];
    const failures: string[] = [];

    for (const criterion of criteria) {
      const result = this.evaluate(obs, criterion);
      citations.push(...result.citations);
      if (!result.ok) failures.push(`${criterion} (${result.reason ?? "not satisfied"})`);
    }

    if (failures.length === 0) {
      return { judgment: "SATISFIED", citations, feedback: null, summary: null };
    }
    return {
      judgment: "NOT_SATISFIED",
      citations,
      feedback: failures.join("; "),
      summary: null,
    };
  }

  async verifyMilestone(req: MilestoneVerificationRequest): Promise<Verification> {
    return this.evaluateAll(req.observation, req.milestone.completion);
  }

  async verifyFinal(req: FinalVerificationRequest): Promise<Verification> {
    const latest = req.observations[req.observations.length - 1];
    if (!latest) {
      return {
        judgment: "NOT_SATISFIED",
        citations: [],
        feedback: "no observation available for final verification",
        summary: null,
      };
    }
    return this.evaluateAll(latest, req.plan.finalCriteria);
  }
}
