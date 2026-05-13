import type { IntentClassification, LeadTwinUpdate } from "@/lib/validation/ai";
import type {
  IntentClassifierInput,
  IntentClassifierLLM,
} from "@/server/services/intent-classifier.service";
import type {
  TwinExtractorLLM,
  TwinExtractorLLMInput,
} from "@/server/services/twin-extractor.service";
import type { AgentLLM, AgentLLMInput, AgentLLMResult } from "@/server/services/ai-agent.service";
import type {
  IntentBatchDetectorLLM,
  IntentBatchDetectorInput,
  DetectedIntent,
} from "@/inngest/functions/detect-intents.batch";
import type {
  ConversationSummarizerLLM,
  ConversationSummarizerLLMInput,
} from "@/server/services/conversation-summarizer.service";

export class FakeIntentClassifierLLM implements IntentClassifierLLM {
  private readonly responses: IntentClassification[] = [];
  public readonly calls: IntentClassifierInput[] = [];

  enqueue(response: IntentClassification): this {
    this.responses.push(response);
    return this;
  }

  async classify(input: IntentClassifierInput): Promise<IntentClassification> {
    this.calls.push(input);
    const next = this.responses.shift();
    if (!next) {
      throw new Error("FakeIntentClassifierLLM: sin respuesta encolada");
    }
    return next;
  }
}

export class FakeTwinExtractorLLM implements TwinExtractorLLM {
  private readonly responses: LeadTwinUpdate[] = [];
  public readonly calls: TwinExtractorLLMInput[] = [];

  enqueue(response: LeadTwinUpdate): this {
    this.responses.push(response);
    return this;
  }

  async extract(input: TwinExtractorLLMInput): Promise<LeadTwinUpdate> {
    this.calls.push(input);
    const next = this.responses.shift();
    if (!next) {
      throw new Error("FakeTwinExtractorLLM: sin respuesta encolada");
    }
    return next;
  }
}

type AgentLLMHandler = (input: AgentLLMInput) => Promise<AgentLLMResult>;

export class FakeAgentLLM implements AgentLLM {
  private readonly handlers: AgentLLMHandler[] = [];
  public readonly calls: AgentLLMInput[] = [];

  enqueue(handler: AgentLLMHandler): this {
    this.handlers.push(handler);
    return this;
  }

  enqueueText(text: string): this {
    return this.enqueue(async () => ({ text, toolCalls: [] }));
  }

  async generate(input: AgentLLMInput): Promise<AgentLLMResult> {
    this.calls.push(input);
    const handler = this.handlers.shift();
    if (!handler) throw new Error("FakeAgentLLM: sin handler encolado");
    return handler(input);
  }
}

export class FakeIntentBatchDetectorLLM implements IntentBatchDetectorLLM {
  private readonly responses: DetectedIntent[][] = [];
  public readonly calls: IntentBatchDetectorInput[] = [];

  enqueue(response: DetectedIntent[]): this {
    this.responses.push(response);
    return this;
  }

  async detect(input: IntentBatchDetectorInput): Promise<DetectedIntent[]> {
    this.calls.push(input);
    const next = this.responses.shift();
    if (!next) throw new Error("FakeIntentBatchDetectorLLM: sin respuesta encolada");
    return next;
  }
}

export class FakeConversationSummarizerLLM implements ConversationSummarizerLLM {
  private readonly responses: string[] = [];
  public readonly calls: ConversationSummarizerLLMInput[] = [];

  enqueue(response: string): this {
    this.responses.push(response);
    return this;
  }

  async summarize(input: ConversationSummarizerLLMInput): Promise<string> {
    this.calls.push(input);
    const next = this.responses.shift();
    if (next === undefined) {
      throw new Error("FakeConversationSummarizerLLM: sin respuesta encolada");
    }
    return next;
  }
}
