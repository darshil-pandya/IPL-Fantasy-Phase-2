import type { FranchiseStanding } from "../types";

export function ownerSlug(owner: string): string {
  return owner
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export function franchiseBySlug(
  franchises: FranchiseStanding[],
  slug: string,
): FranchiseStanding | undefined {
  return franchises.find((f) => ownerSlug(f.owner) === slug);
}
