// Barrel export for Drizzle schema. Populated as each feature slice lands:
// - lib/auth/index.ts generates lib/db/schema/auth.ts (user/account/verification today;
//   organization/member/invitation once the organization plugin lands in PR 1.2)
// - contacts slice adds lib/db/schema/contacts.ts and lib/db/schema/audit-log.ts
export * from "./auth";
