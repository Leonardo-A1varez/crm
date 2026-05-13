import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "crm" });

export type CrmInngestClient = typeof inngest;
