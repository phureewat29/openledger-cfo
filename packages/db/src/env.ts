import { z } from "zod/v4";

export const env = z
  .object({
    POSTGRES_URL: z
      .url()
      .default("postgres://postgres:postgres@127.0.0.1:5432/cfo"),
  })
  .parse(process.env);
