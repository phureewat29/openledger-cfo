import { z } from "zod/v4";

// The db package validates its own connection string; the app needs no env
// beyond NODE_ENV, so a run that skips the with-env wrapper still boots.
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

export const env = EnvSchema.parse(process.env);
