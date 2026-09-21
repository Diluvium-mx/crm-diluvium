// Barrel export for Drizzle schema. Populated as each feature slice lands:
// - lib/auth/index.ts generates lib/db/schema/auth.ts (user/account/verification today;
//   organization/member/invitation once the organization plugin lands in PR 1.2)
// - contacts slice adds lib/db/schema/audit-log.ts next
export * from "./auth";
export * from "./contacts";
export * from "./messaging";
export * from "./snippets";
