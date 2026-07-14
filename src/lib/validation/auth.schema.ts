import { z } from "zod";

// 8-72: mínimo razonable + tope bcrypt de Supabase Auth.
export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(72),
});
export type LoginInput = z.infer<typeof LoginSchema>;
