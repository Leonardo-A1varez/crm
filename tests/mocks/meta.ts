import type {
  MetaApiClient,
  MetaSendTextInput,
  MetaSendResult,
} from "@/server/services/meta-api.service";

export class FakeMetaApiClient implements MetaApiClient {
  public readonly calls: MetaSendTextInput[] = [];
  /** Si está seteado, `sendText` rechaza con este error tras registrar la llamada. */
  failWith: Error | null = null;
  private nextId = 1;
  private nextMidPrefix = "wamid.fake-";

  setMidPrefix(prefix: string): this {
    this.nextMidPrefix = prefix;
    return this;
  }

  async sendText(input: MetaSendTextInput): Promise<MetaSendResult> {
    // `calls` cuenta invocaciones a Meta, no envíos exitosos: una llamada que
    // falló igual salió a la red. Registrar antes de fallar es lo que deja a
    // los tests medir reenvíos por el delta de `calls.length`. Un id no se
    // consume en el fallo (el `nextId++` está en el return).
    this.calls.push(input);
    if (this.failWith) throw this.failWith;
    return { meta_message_id: `${this.nextMidPrefix}${this.nextId++}` };
  }
}
