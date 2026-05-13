// Feature flags inyectables. Permite kill switch agente IA + auto-handoff + reactivation
// sin redeploy. Default cerrado (StaticFeatureFlags retorna false para flag desconocido)
// excepto AllEnabledFeatureFlags (compat tests existentes).
//
// Impls:
// - StaticFeatureFlags: tests + bootstrap. Map en código.
// - AllEnabledFeatureFlags: default tests existentes. Siempre true.
// - EdgeConfigFeatureFlags (Fase 7): @vercel/edge-config con hot-reload sin redeploy.

export const FLAGS = {
  AI_AGENT_ENABLED: "ai_agent.enabled",
  AUTO_HANDOFF_ENABLED: "auto_handoff.enabled",
  REACTIVATION_ENABLED: "reactivation.enabled",
} as const;

export type FlagName = (typeof FLAGS)[keyof typeof FLAGS] | string;

export type FlagDefaults = Record<string, boolean>;

export interface FeatureFlags {
  isEnabled(name: FlagName, ctx?: Record<string, unknown>): Promise<boolean>;
}

export class StaticFeatureFlags implements FeatureFlags {
  constructor(private readonly defaults: FlagDefaults) {}

  async isEnabled(name: FlagName): Promise<boolean> {
    return this.defaults[name] ?? false;
  }
}

export class AllEnabledFeatureFlags implements FeatureFlags {
  async isEnabled(_name: FlagName, _ctx?: Record<string, unknown>): Promise<boolean> {
    return true;
  }
}
