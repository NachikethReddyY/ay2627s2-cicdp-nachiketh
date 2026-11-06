import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { notFound, pathCards, PathListItem, Slug } from "./shared.ts";

const MAX_PATHS = 24;
const MAX_FEATURED = 12;

const Collection = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  paths: z.array(PathListItem),
});
const AdminCollection = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  featured: z.boolean(),
  position: z.number(),
  pathSlugs: z.array(z.string()),
});

// Featured collections in order. Only public paths appear, and a collection with none left is skipped.
const list = protectedProcedure.output(z.array(Collection)).query(async ({ ctx }) => {
  const { rows: cols } = await db.execute<{ id: string; slug: string; title: string; description: string }>(sql`
    SELECT id, slug, title, description FROM collections WHERE featured
    ORDER BY position, created_at, id LIMIT ${MAX_FEATURED}`);
  if (cols.length === 0) return [];
  const { rows: links } = await db.execute<{ collection_id: string; slug: string }>(sql`
    SELECT cp.collection_id, p.slug FROM collection_paths cp
    JOIN collections c ON c.id = cp.collection_id AND c.featured
    JOIN paths p ON p.id = cp.path_id AND p.visibility = 'public'
    ORDER BY cp.position`);
  const cards = new Map(
    (await pathCards(ctx.learnerId, sql`p.id IN (SELECT cp.path_id FROM collection_paths cp JOIN collections c ON c.id = cp.collection_id AND c.featured) AND p.visibility = 'public'`, sql`p.slug`, MAX_PATHS * MAX_FEATURED)).map((c) => [c.slug, c]),
  );
  return cols
    .map((c) => ({
      slug: c.slug,
      title: c.title,
      description: c.description,
      paths: links.filter((l) => l.collection_id === c.id).flatMap((l) => cards.get(l.slug) ?? []),
    }))
    .filter((c) => c.paths.length > 0);
});

const adminList = adminProcedure.output(z.array(AdminCollection)).query(async () => {
  const { rows } = await db.execute<z.infer<typeof AdminCollection>>(sql`
    SELECT c.slug, c.title, c.description, c.featured, c.position,
      (SELECT COALESCE(json_agg(p.slug ORDER BY cp.position), '[]') FROM collection_paths cp
        JOIN paths p ON p.id = cp.path_id WHERE cp.collection_id = c.id) AS "pathSlugs"
    FROM collections c ORDER BY c.position, c.created_at, c.id`);
  return rows;
});

const create = adminProcedure
  .input(z.object({ slug: Slug.shape.slug, title: z.string().trim().min(1).max(80), description: z.string().trim().max(300).default("") }))
  .output(z.void())
  .mutation(async ({ input }) => {
    const { rows } = await db.execute(sql`
      INSERT INTO collections (id, slug, title, description, position)
      VALUES (gen_random_uuid()::text, ${input.slug}, ${input.title}, ${input.description},
        (SELECT COALESCE(max(position) + 1, 0) FROM collections))
      ON CONFLICT (slug) DO NOTHING RETURNING 1`);
    if (rows.length === 0) throw new TRPCError({ code: "CONFLICT", message: "A collection with that slug exists" });
  });

const setFeatured = adminProcedure
  .input(Slug.extend({ featured: z.boolean() }))
  .output(z.void())
  .mutation(async ({ input }) => {
    const { rows } = await db.execute(sql`UPDATE collections SET featured = ${input.featured} WHERE slug = ${input.slug} RETURNING 1`);
    if (rows.length === 0) throw notFound("Collection not found");
  });

// Replaces the collection's paths with this ordered list. Only public paths can be featured.
const setPaths = adminProcedure
  .input(Slug.extend({ pathSlugs: z.array(Slug.shape.slug).max(MAX_PATHS) }))
  .output(z.void())
  .mutation(async ({ input }) => {
    const slugs = [...new Set(input.pathSlugs)];
    await db.transaction(async (tx) => {
      const { rows: [col] } = await tx.execute<{ id: string }>(sql`SELECT id FROM collections WHERE slug = ${input.slug} FOR UPDATE`);
      if (!col) throw notFound("Collection not found");
      const { rows: found } = slugs.length
        ? await tx.execute<{ id: string; slug: string }>(sql`SELECT id, slug FROM paths WHERE visibility = 'public' AND slug IN (${sql.join(slugs.map((s) => sql`${s}`), sql`, `)})`)
        : { rows: [] };
      if (found.length !== slugs.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Every path must exist and be public" });
      const byslug = new Map(found.map((r) => [r.slug, r.id]));
      await tx.execute(sql`DELETE FROM collection_paths WHERE collection_id = ${col.id}`);
      for (const [i, s] of slugs.entries()) {
        await tx.execute(sql`INSERT INTO collection_paths (collection_id, path_id, position) VALUES (${col.id}, ${byslug.get(s)!}, ${i})`);
      }
    });
  });

export const collectionsRouter = router({ list, adminList, create, setFeatured, setPaths });
