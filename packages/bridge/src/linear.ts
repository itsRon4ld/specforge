import type { Config, RequestType, StateKey } from "./config.ts";
import type { LabelInfo } from "./security.ts";

const API = "https://api.linear.app/graphql";

export type ActivityContent =
  | { type: "thought" | "response" | "elicitation" | "error"; body: string }
  | { type: "action"; action: string; parameter: string; result?: string };

export type IssueDetails = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: string;
  priority: number;
  labels: string[];
  parent: string | null;
  comments: { author: string; body: string; createdAt: string }[];
  attachments: { title: string; url: string }[];
  documents: { title: string; content: string }[];
};

export type IssueSummary = { id: string; identifier: string; title: string; url: string; state: string };

/** Thin GraphQL client that acts as the Linear OAuth app (actor=app). */
export class Linear {
  private teamId = "";
  private stateIds = {} as Record<StateKey, string>;
  private typeLabelIds = {} as Record<RequestType, string>;
  private hotfixLabelId: string | undefined;
  private token: string;
  private config: Config;

  constructor(token: string, config: Config) {
    this.token = token;
    this.config = config;
  }

  async gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ query, variables }),
    });
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (!res.ok || json.errors?.length) {
      throw new Error(`Linear API error: ${json.errors?.map((e) => e.message).join("; ") ?? res.status}`);
    }
    return json.data as T;
  }

  /** Resolves the team, workflow states and type labels named in config.yaml into ids. */
  async init(): Promise<void> {
    const data = await this.gql(
      `query ($key: String!) {
        teams(filter: { key: { eq: $key } }) {
          nodes { id states { nodes { id name } } labels { nodes { id name } } }
        }
        issueLabels(filter: { team: { null: true } }) { nodes { id name } }
      }`,
      { key: this.config.linear.team },
    );
    const team = data.teams.nodes[0];
    if (!team) throw new Error(`Linear team "${this.config.linear.team}" not found`);
    this.teamId = team.id;

    const states = new Map<string, string>(team.states.nodes.map((s: any) => [s.name.toLowerCase(), s.id]));
    for (const [key, name] of Object.entries(this.config.linear.states) as [StateKey, string][]) {
      const id = states.get(name.toLowerCase());
      if (!id) throw new Error(`Linear state "${name}" (${key}) not found in team ${this.config.linear.team}`);
      this.stateIds[key] = id;
    }
    const labels = new Map<string, string>(
      [...data.issueLabels.nodes, ...team.labels.nodes].map((l: any) => [l.name.toLowerCase(), l.id]),
    );
    const { hotfix, ...typeLabels } = this.config.linear.labels;
    for (const [type, name] of Object.entries(typeLabels) as [RequestType, string][]) {
      const id = labels.get(name.toLowerCase());
      if (!id) throw new Error(`Linear label "${name}" (${type}) not found`);
      this.typeLabelIds[type] = id;
    }
    if (hotfix) {
      this.hotfixLabelId = labels.get(hotfix.toLowerCase());
      if (!this.hotfixLabelId) throw new Error(`Linear label "${hotfix}" (hotfix) not found`);
    }
  }

  /** Names of the labels the bridge manages itself (type labels and hotfix). */
  managedLabelNames(): string[] {
    const { hotfix, ...types } = this.config.linear.labels;
    return [...Object.values(types), ...(hotfix ? [hotfix] : [])];
  }

  /**
   * Live list of the team's and workspace's labels, with descriptions. Fetched on
   * every call, so a label created in Linear is usable on the next request.
   */
  async labels(): Promise<LabelInfo[]> {
    const data = await this.gql(
      `query ($teamId: String!) {
        team(id: $teamId) { labels(first: 250) { nodes { id name description isGroup } } }
        issueLabels(first: 250, filter: { team: { null: true } }) { nodes { id name description isGroup } }
      }`,
      { teamId: this.teamId },
    );
    return [...data.team.labels.nodes, ...data.issueLabels.nodes]
      .filter((l: any) => !l.isGroup)
      .map((l: any) => ({ id: l.id, name: l.name, description: l.description ?? null }));
  }

  /** Accepts an id or an identifier such as PRD-12. */
  async issue(idOrIdentifier: string): Promise<IssueDetails> {
    const data = await this.gql(
      `query ($id: String!) {
        issue(id: $id) {
          id identifier title description url priority
          state { name }
          parent { identifier }
          labels { nodes { name } }
          comments(first: 100) { nodes { body createdAt user { name } } }
          attachments { nodes { title url } }
          documents { nodes { title content } }
        }
      }`,
      { id: idOrIdentifier },
    );
    const i = data.issue;
    return {
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      description: i.description,
      url: i.url,
      state: i.state.name,
      priority: i.priority,
      labels: i.labels.nodes.map((l: any) => l.name),
      parent: i.parent?.identifier ?? null,
      comments: i.comments.nodes.map((c: any) => ({ author: c.user?.name ?? "app", body: c.body, createdAt: c.createdAt })),
      attachments: i.attachments.nodes.map((a: any) => ({ title: a.title, url: a.url })),
      documents: (i.documents?.nodes ?? []).map((d: any) => ({ title: d.title, content: d.content })),
    };
  }

  /** Issues of the team matching a text, in any state: duplicates and already-shipped work both matter. */
  async search(text: string): Promise<IssueSummary[]> {
    const data = await this.gql(
      `query ($teamId: ID!, $text: String!) {
        issues(first: 25, orderBy: updatedAt, filter: {
          team: { id: { eq: $teamId } }
          searchableContent: { contains: $text }
        }) { nodes { id identifier title url state { name } } }
      }`,
      { teamId: this.teamId, text },
    );
    return data.issues.nodes.map((i: any) => ({ ...i, state: i.state.name }));
  }

  /**
   * Publishes the finished issue: title, description, priority, exactly one type
   * label, and the final state. Callers must enforce the Definition of Ready first.
   */
  async finalize(
    issueId: string,
    input: {
      type: RequestType;
      title: string;
      description: string;
      priority?: number;
      state: StateKey;
      hotfix?: boolean;
      /** Already-validated extra label ids (see resolveExtraLabels). */
      extraLabelIds?: string[];
    },
  ): Promise<void> {
    const removedLabelIds = Object.entries(this.typeLabelIds)
      .filter(([type]) => type !== input.type)
      .map(([, id]) => id);
    const addedLabelIds = [this.typeLabelIds[input.type], ...(input.extraLabelIds ?? [])];
    if (this.hotfixLabelId) (input.hotfix ? addedLabelIds : removedLabelIds).push(this.hotfixLabelId);
    await this.gql(
      `mutation ($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`,
      {
        id: issueId,
        input: {
          title: input.title.slice(0, 255),
          description: input.description,
          priority: input.priority,
          stateId: this.stateIds[input.state],
          addedLabelIds,
          removedLabelIds,
        },
      },
    );
  }

  async createSubIssue(
    parentId: string,
    input: { type: RequestType; title: string; description: string; extraLabelIds?: string[] },
  ) {
    const data = await this.gql(
      `mutation ($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }`,
      {
        input: {
          teamId: this.teamId,
          parentId,
          title: input.title.slice(0, 255),
          description: input.description,
          labelIds: [this.typeLabelIds[input.type], ...(input.extraLabelIds ?? [])],
          stateId: this.stateIds.backlog,
        },
      },
    );
    return data.issueCreate.issue as { id: string; identifier: string; url: string };
  }

  async setState(issueId: string, state: StateKey): Promise<void> {
    await this.gql(
      `mutation ($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`,
      { id: issueId, stateId: this.stateIds[state] },
    );
  }

  async comment(issueId: string, body: string): Promise<void> {
    await this.gql(`mutation ($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`, {
      input: { issueId, body },
    });
  }

  async document(issueId: string, title: string, content: string): Promise<{ url: string }> {
    const data = await this.gql(
      `mutation ($input: DocumentCreateInput!) { documentCreate(input: $input) { success document { url } } }`,
      { input: { issueId, title, content } },
    );
    return { url: data.documentCreate.document.url };
  }

  async activity(agentSessionId: string, content: ActivityContent): Promise<void> {
    await this.gql(`mutation ($input: AgentActivityCreateInput!) { agentActivityCreate(input: $input) { success } }`, {
      input: { agentSessionId, content },
    });
  }

  /** Downloads a file uploaded to Linear (screenshots pasted into the draft, for example). */
  async download(url: string): Promise<{ contentType: string; data: Buffer }> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new Error(`Linear download → ${res.status}`);
    return {
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      data: Buffer.from(await res.arrayBuffer()),
    };
  }

  /** Uploads a file to Linear storage and attaches it to the issue. */
  async attach(issueId: string, file: { filename: string; contentType: string; data: Buffer; title: string }) {
    const upload = await this.gql(
      `mutation ($contentType: String!, $filename: String!, $size: Int!) {
        fileUpload(contentType: $contentType, filename: $filename, size: $size) {
          success uploadFile { uploadUrl assetUrl headers { key value } }
        }
      }`,
      { contentType: file.contentType, filename: file.filename, size: file.data.length },
    );
    const { uploadUrl, assetUrl, headers } = upload.fileUpload.uploadFile;
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "public, max-age=31536000",
        ...Object.fromEntries(headers.map((h: { key: string; value: string }) => [h.key, h.value])),
      },
      body: new Uint8Array(file.data),
    });
    if (!put.ok) throw new Error(`Linear upload → ${put.status}`);

    await this.gql(`mutation ($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success } }`, {
      input: { issueId, url: assetUrl, title: file.title },
    });
    return { url: assetUrl as string };
  }
}
