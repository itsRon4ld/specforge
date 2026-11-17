import { readFileSync } from "node:fs";
import { parse } from "yaml";

/** The five kinds of request a stakeholder message can turn into. */
export const REQUEST_TYPES = ["feature", "bug", "ux", "redesign", "question"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export type StateKey = "backlog" | "needsInfo" | "needsApproval" | "answered";

export type Role = "product";

export type Config = {
  linear: {
    team: string;
    states: Record<StateKey, string>;
    labels: Record<RequestType, string>;
    knowledgeIssue?: string;
  };
  approvals: { approvers: string[]; words: string[] };
  github: { repo: string; baseBranch: string; designBranchPrefix: string };
  agent: { model: string; guidance?: string };
  readiness: Record<RequestType, string[]>;
};

export type Env = {
  port: number;
  dataDir: string;
  linearToken: string;
  linearWebhookSecret: string;
  githubToken: string;
  roleTokens: Record<Role, string>;
};

/** Sensible Definition of Ready if config.yaml does not override it. */
export const DEFAULT_READINESS: Record<RequestType, string[]> = {
  feature: ["Problem", "Users", "Acceptance criteria", "Out of scope", "Technical notes"],
  bug: ["What happens", "Steps to reproduce", "Expected", "Actual", "Evidence"],
  ux: ["Problem", "Users", "User flow", "Screens", "Acceptance criteria"],
  redesign: ["Problem", "Design branch", "What changes", "Acceptance criteria"],
  question: ["Question", "Answer", "Sources"],
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function loadEnv(): Env {
  return {
    port: Number(process.env.PORT ?? 8080),
    dataDir: process.env.DATA_DIR ?? "./data",
    linearToken: required("LINEAR_ACCESS_TOKEN"),
    linearWebhookSecret: required("LINEAR_WEBHOOK_SECRET"),
    githubToken: required("GITHUB_TOKEN"),
    roleTokens: { product: required("PRODUCT_TOKEN") },
  };
}

export function loadConfig(path = process.env.SPECFORGE_CONFIG ?? "./config.yaml"): Config {
  const config = parse(readFileSync(path, "utf8")) as Config;
  if (!config?.linear?.team || !config?.github?.repo) {
    throw new Error(`Invalid config at ${path}: linear.team and github.repo are required`);
  }
  for (const type of REQUEST_TYPES) {
    if (!config.linear.labels?.[type]) throw new Error(`linear.labels.${type} is required`);
  }
  config.approvals ??= { approvers: [], words: [] };
  config.approvals.words = (config.approvals.words?.length ? config.approvals.words : ["approved"]).map((w) =>
    w.toLowerCase(),
  );
  config.github.baseBranch ??= "main";
  config.github.designBranchPrefix ??= "design/";
  config.readiness = { ...DEFAULT_READINESS, ...(config.readiness ?? {}) };
  return config;
}
