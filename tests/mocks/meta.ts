import type {
  MetaApiClient,
  MetaSendTextInput,
  MetaSendResult,
} from "@/server/services/meta-api.service";

export class FakeMetaApiClient implements MetaApiClient {
  public readonly calls: MetaSendTextInput[] = [];
  private nextId = 1;
  private nextMidPrefix = "wamid.fake-";

  setMidPrefix(prefix: string): this {
    this.nextMidPrefix = prefix;
    return this;
  }

  async sendText(input: MetaSendTextInput): Promise<MetaSendResult> {
    this.calls.push(input);
    return { meta_message_id: `${this.nextMidPrefix}${this.nextId++}` };
  }
}
