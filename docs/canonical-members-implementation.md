# Canonical members implementation — 2026-10-04

Implemented locally; migration 35 has **not** been applied to any external database. No commit or push. Starting/current HEAD: `53990bfd7764cfff8f4016f2905c700524da52b1`.

## 1. Final schema and migration

New migration: [20250101000035_add_canonical_members.sql](F:/gymflow-ai/supabase/migrations/20250101000035_add_canonical_members.sql). Migrations 0–34 are unchanged. The migration runs in one transaction.

| Object | Result |
| --- | --- |
| `members` | Gym-level UUID identity, name, `phone_e164`, optional email, source, actor, review/audit JSON, timestamps. No branch or single conversation field. Owner SELECT RLS; registration via authorized RPC. |
| Identity uniqueness | `(gym_id, phone_e164)` unique; composite `(id, gym_id)` authority key. New registrations require an international phone. Only quarantined legacy identities can have NULL phone. |
| `memberships` | Required canonical `member_id`; existing gym/branch/package/dates/history retained. Source, actor, request UUID and original registration fingerprint added. |
| Membership provenance | `conversation_id` nullable, FK `ON DELETE SET NULL`. Deleting a conversation cannot delete periods or members. Composite member/gym FK rejects cross-tenant linkage. |
| `conversations` | Nullable `member_id`, composite gym FK and partial member index. Existing transport keys, endpoints, phones and uniqueness unchanged. |
| Registration requests | Partial unique `(gym_id, request_id)` index. A reused ID with different details is rejected. |
| Reminder lifecycle | `automation_executions.conversation_id` nullable; unique configuration/membership/event key; `delivery_bound_at` records first delivery authority. Old conversation-key uniqueness retained. |
| Reminder persistence | Partial unique message index on `metadata.automation_execution_id`; trigger binds exactly one message to the owned execution claim atomically. |
| Existing send boundary | Same `begin_whatsapp_outbound_send(uuid,uuid)` signature/outbox, with free-form window validation extended narrowly to automation messages. |

## 2. Backfill

Every existing membership period is assigned a canonical member. All periods and historical synthetic import conversations remain. Clear gym/international-phone/name-compatible records consolidate; name is only a safety check for a phone match, never an independent identity key. Missing, local-format or conflicting identities become separate legacy records with NULL canonical phone and explicit review metadata/raw phone. SQL sanitizes safe international formats; it does not guess a calling country or rewrite conversation phones.

Historical person acquisition source is conservative across compatible records: imports do not gain AI acquisition credit; conflicting/uncertain histories remain legacy. Ambiguous records are visible in Members and retain their history. Potentially matching unresolved phones block new registration/linking until reviewed; unrelated phones in the gym remain usable.

`plan-member-backfill.mjs` accepts a JSON export, uses the existing libphonenumber normalizer with the known branch country, and writes a report plus guarded review SQL. It never opens a DB connection or applies SQL. Conflicting names and unresolved phones produce report entries without a merge. Existing curated source/profile is retained; merged legacy snapshots are kept in audit metadata. Generated SQL locks conversations before the gym advisory lock, validates the snapshot, reassigns periods/conversations, and removes only redundant canonical identity rows after reassignment. It does not delete conversations or membership periods. Review and validate this SQL on staging before considering any external application.

Read-only post-migration export for that tool:

```sql
select coalesce(jsonb_agg(to_jsonb(export_row) order by export_row.gym_id, export_row.id), '[]'::jsonb)
from (
  select m.id, m.gym_id, m.name, m.phone_e164, m.source, m.created_at, m.updated_at,
    m.identity_metadata->>'raw_phone' as raw_phone,
    c.source as conversation_source, b.country_code
  from public.members m
  left join public.conversations c
    on c.id = nullif(m.identity_metadata->>'legacy_conversation_id', '')::uuid
  left join public.branches b on b.id = c.branch_id
) export_row;
```

Save the JSON array, then from `frontend` run:

```powershell
node scripts/plan-member-backfill.mjs reviewed-export.json reviewed-plan
```

Basic read-only migration checks: no NULL `memberships.member_id`; period count unchanged; no canonical duplicate gym/phone; review counts from `members.identity_metadata`; conversation transport phone snapshots unchanged. Inspect RPCs, constraints, RLS, triggers and outbox behavior in staging, not only row counts.

## 3. Canonical registration

`membership.server.ts::registerMember()` normalizes using existing `normalizePhoneNumber()` and validates runtime inputs. Manual, import and conversion converge on `register_member_membership(...)`.

The RPC authenticates `auth.uid()`, verifies gym ownership, branch/package authority and active package, validates dates/email/phone, locks the authoritative conversation first when present, then serializes registrations within that gym. Different gyms use different advisory locks. A transaction returns the canonical member/period or rolls back entirely.

An identical request returns its original period, including after a package becomes inactive. Changed details under the same request ID reject. Inclusive date overlap is rejected for the same member/branch; different branches may legitimately overlap. Renewals append a period. Explicit manual reuse requires the correct existing member ID; imports reuse only compatible phone/name rows and never overwrite existing profile data. Conversation phone supplied by the browser cannot replace authoritative transport identity. Owner operations preserve control status, `ai_enabled` and epoch.

## 4. Add Member and history

The compact existing-design modal asks for name, phone, optional email, current branch, package, branch-local start and calculated expiry with validated override. It asks for no conversation or endpoint. An existing phone shows the existing profile and requires a second explicit confirmation. Success selects the member and refreshes the page.

A stable request UUID survives retries. A synchronous submit lock prevents duplicate clicks. Commit followed by connection loss replays the exact original payload, before repeating phone lookup. The modal uses focus trapping/restoration, existing Escape/close behavior, busy states and visible errors. Mobile actions retain usable touch heights and the panel scrolls inside the viewport.

The current-branch list groups by member/branch. Full historical periods across authorized gym branches load on selection with branch labels. Conversation history resolves through `conversations.member_id`, scoped to the current branch; an offline member simply has no conversation history. Failed/later selection requests cannot overwrite another member's details.

## 5. CSV/Excel import

Existing parsing, mapping and preview remain. Loaded rows receive stable UUIDs, retained across retries of that batch. Repeated phone rows are allowed when periods are legitimate; the canonical transaction rejects overlap. New imports create person + period directly and create no synthetic conversation. Batches remain bounded at 500 rows, with ten concurrent RPC requests; gym locking serializes the identity/period decision. Re-uploading a file starts new row IDs but uniqueness/overlap still prevents duplicate periods.

## 6. WhatsApp conversion and later linkage

Lead conversion uses the same registration path, with server-loaded conversation/branch/phone authority and a stable client request ID. Real conversation provenance and genuine existing AI lead attribution are preserved. Phone transport identifiers are untouched.

`conversations_link_member` handles inserts and updates from existing inbound paths, including older workers. It matches an exact safe canonical normalized phone inside the authoritative gym only, refuses historical ambiguity, sets only `member_id`, and creates no period. It preserves status, `ai_enabled`, `control_version`, messages and history. Existing links are retained. Branch controls membership/package and delivery scope, not identity. Linked members are excluded from new-lead listings/follow-ups without rewriting historical lead state.

## 7. Status and analytics

`membership-lifecycle.ts` implements Scheduled / Active / Expired using an explicit fresh branch-local date; expiry is inclusive. A current active period takes priority over a future renewal. Members refresh the date once per minute; scheduler dates use the branch timezone. Missing branch timezone produces an actionable settings error instead of silently using UTC.

Branch analytics count distinct membership `member_id`; gym metrics count canonical `members` independently of conversation activity. AI acquisitions require both person creation and period source `lead_conversion`, an authoritative provenance conversation and genuine AI lead activity. Manual/import members and later linking do not gain acquisition credit. Legacy ambiguity may make historical counts conservative until reviewed.

## 8. Reminder architecture and races

Lifecycle due state persists even without a usable channel. `claim_membership_automation()` stores a suppressed event with an explicit internal reason until a branch/gym/phone-matching active WhatsApp conversation, active endpoint and open latest-customer service window exist. Automatic-send settings remain authoritative. No templates are implemented.

The stable event row is the future template integration point: add approved-template eligibility/payload selection after lifecycle registration and before durable delivery claim. Closed-window events are not deleted or silently converted. Existing free-form queue payloads remain free-form. Human free-text window rules are unchanged.

Checked the current [official WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/) (updated September 23, 2026): the service window resets with each user message; outside it, messaging requires approved templates. Manual phone entry creates no messaging permission or artificial inbound activity. Template approval/recipient consent must be part of the future eligibility implementation, not inferred from member registration.

First delivery binding captures conversation and control epoch. Retry never refreshes old authority after human → active or conversation deletion. Claim tokens and leases fence message persistence; execution/message linkage and outbox enqueue occur in the same insert transaction. Exactly one text payload is persisted per new membership reminder. Existing AI/outbox persistence, takeover cancellation, business-action fencing and final send locking are retained. Already-sending/uncertain deliveries are not falsely cancelled.

Branch routing or member/phone linkage drift also blocks reminder retry, persistence and the final send boundary. Historical executions can still be maintained/cancelled after routing drift; their original branch provenance is retained.

The old claim RPC delegates membership work with its expected conversation ID, so an old worker cannot accidentally send to a different newly selected conversation. New unbound/suppressed rows can be re-evaluated; old bound/stale rows cannot regain authority. New membership automation writes from old workers lack event authority and fail closed, rather than creating unbound duplicate messages. Existing persisted delivery recovery still uses the normal outbox. Lead automation behavior remains separate; explicit automation `ai_enabled` semantics from migration 34 are preserved, but human/closed conversations are ineligible.

## 9. Rolling deployment

**Migration first, verify, application deploy.** No production migration was run during this task.

1. Snapshot/measure existing period counts, conversation phones and ambiguous historical data. Rehearse migration 35 against a staging copy and run real PostgreSQL concurrency checks.
2. Coordinate a brief pause of owner member imports/conversions during the schema/application transition. Ordinary WhatsApp inbound/AI and existing durable delivery can continue. This is not a requirement to drain every background invocation.
3. Apply migration 35 once through the normal migration process. Verify schema/ACLs, counts, review records, epoch invariance, FK deletion and RPC signatures. Review ambiguous backfill results.
4. Deploy the application. Reload old Members/Leads tabs, verify authenticated manual/import/conversion flows and scoped analytics, then resume those owner writes.
5. Run staging Meta delivery smoke tests with an authorized test customer/open window and takeover races. Observe suppression and delivery errors before production enablement.

Compatibility is deliberately explicit:

- Old conversion/import RPC signatures and composite return type are retained via wrappers. Existing old raw membership writers receive canonical identity through the consistency trigger. Old inbound workers receive safe linkage via the conversation trigger. Existing outbox/claim/send RPC signatures remain.
- The old import RPC now creates offline members, not synthetic conversations. **Old Members readers group by conversation and cannot correctly display new NULL-provenance rows.** Hence coordinate the owner-write/UI transition; this is not a fully transparent old-reader rollout.
- Old newly generated membership automation messages fail closed until the updated worker supplies event authority. Normal existing persisted-message recovery remains, and the final send boundary blocks expired-window free-form automation deliveries. Both are intentional safer semantics, not silently claimed unchanged behavior.
- New application before migration 35 encounters missing relation/column/RPC errors. Do not deploy it first. Rollback to old UI after new offline rows exist requires the same member-write pause and a compatible reader; do not drop canonical history to roll back.
- Correctness does not depend on perfect old-worker draining. Database uniqueness, locks, epochs and fail-closed persistence enforce boundaries for old/recovery paths. Real concurrent behavior still needs the validation below.

## 10. Validation actually executed

| Check | Result / limits |
| --- | --- |
| `npx tsc --noEmit` | Passed. |
| `npm run lint` | Passed, zero errors; eight pre-existing warnings retained. |
| `npm run build` | Passed, Next 16.3.4 / Turbopack production compilation, types and routes. |
| `node scripts/verify-members.mjs` | Passed migration/backfill, registration/replay/conflicts, normalized phone, explicit reuse, renewals, two branches, tenant/package scope, import without fake conversations, conversion/linking, ambiguity, deletion, local dates/status, suppressed lifecycle, message binding/window/epochs. Actual service and analytics executed through SQL-backed adapter. Actual form handler tested after commit + connection interruption. Single-connection PGlite. |
| `node scripts/verify-member-migration-chain.mjs` | Passed all actual migration SQL 0–35, legacy synthetic backfill, retained historical periods, old import/conversion signatures, retries, unchanged phones, routing drift and conversation deletion. Supabase-owned auth/storage infrastructure mocked; single connection. |
| `node scripts/verify-conversation-control.mjs` | Passed existing control/owner/outbox service suite using isolated PGlite + mocked Meta. Includes Return-to-AI preserving `ai_enabled`, stale epochs/business actions, conservative sends, simulator and owner idempotency. |
| `npm run verify:whatsapp-regressions` | Passed existing WhatsApp inbox/branch/media/outbox checks. |
| `verify:sms-identity`, `verify:sms-inbound`, `verify:sms-reliability`, `verify:sms-outbound` | All passed. SMS transport architecture unchanged. |
| `verify:performance-regressions`, `verify:turn-state`, conversation analytics regression | Passed. |
| JSON backfill planner | Ran with isolated local-format/canonical identity fixture; expected normalization/consolidation report passed. No database connection/application. Generated repair SQL still requires operator staging review. |
| Real PostgreSQL harness | Syntax checked; **NOT executed**. No local PostgreSQL server/staging target available. Docker daemon was not running; no production connection attempted. |
| `npm run verify:automations` | **NOT executed**: this existing script reads application credentials and mutates/calls the live Supabase automation runner. Use an explicitly authorized staging configuration; isolated membership lifecycle tests were used here. |
| Browser QA | Actual Members components with isolated mock actions: 1440×900, 1280×800, 768×1024, 390×845 CSS viewport checks; no page/form horizontal overflow. Creation selection, calculated dates, explicit reuse confirmation and keyboard trap verified. Saved desktop/mobile images. This is not a Supabase-authenticated E2E test. |
| `git diff --check` | Passed. Existing CRLF/git-config access notices were not suppressed through code changes. |

No runtime dependency was added and `package.json`/lockfile remain unchanged. PGlite/esbuild were installed only in ignored temporary verification dependencies. Direct Node TS test runs retain Node's existing module-type warning; no package-wide module setting was changed to suppress it. 21st catalog search was unavailable without sign-in; existing Kroway components/tokens were reused. Its review noted only contained fixed/min-width import-table warnings.

## 11. Pending validation and existing issue

Before release, run `verify-members-postgres.mjs` against an **empty disposable local PostgreSQL** database. It refuses application env, remote hosts, existing schemas, and DB names outside `kroway_member_test_*`; opt in with `MEMBER_TEST_ALLOW_DISPOSABLE_DATABASE=1` and `MEMBER_TEST_DATABASE_URL`. Four connections observe real `pg_stat_activity` lock waits for: same registration UUID, overlapping periods, stale AI after takeover/return, persistence vs takeover, queued send vs takeover, send boundary winning conservatively, takeover/return concurrency and controlled booking vs takeover. PGlite is not evidence that these real concurrency cases passed. Also validate RLS/PostgREST joins and role ACLs in actual Supabase, multi-channel/endpoint selection on staging data, full authenticated UI and real Meta acceptance/failure with authorized test recipients.

**Pre-existing onboarding issue discovered in the actual migration chain:** migration 16's default-branch trigger inserts `timezone = NULL`, while `branches_timezone_valid` calls migration 15's helper that rejects NULL. New gym insertion fails that check. This unrelated issue was not changed; tests seed historical gyms before migration 16 and exercise existing gyms. Do not treat successful member tests as evidence that fresh-gym onboarding works. Resolve/release that separately if onboarding new gyms.

Practical phone matching is not immutable-person identity; phone reassignment/correction and ambiguous historical records require review. No phone-edit subsystem, family accounts, CRM, staff system, SMS changes or template sending were added. Migration locking/backfill duration on production-sized data remains to be measured in staging. Due suppression is internal; no new reminder dashboard was added.

## 12. Exact feature files

The 34 already-dirty dashboard density files were preserved. Four files overlap those edits: Members/Leads pages and workspaces. All other existing density changes are outside this implementation.

| File (workspace-relative) | Purpose |
| --- | --- |
| `frontend/src/app/(app)/members/page.tsx` | Authorized registration/import/history actions, fresh branch-local date, full period input. |
| `frontend/src/app/(app)/leads/page.tsx` | Conversion request ID; exclude already-linked members. |
| `frontend/src/features/operations/add-member-dialog.tsx` (new) | Compact manual creation/reuse/connection-retry UX. |
| `frontend/src/features/operations/members-workspace.tsx` | Canonical list/current selection, status and complete period/history display. |
| `frontend/src/features/operations/member-import-dialog.tsx` | Stable row IDs, repeated-phone periods and safe retry UX. |
| `frontend/src/features/operations/leads-workspace.tsx` | Stable conversion request UUID. |
| `frontend/src/lib/member-import.ts` | Injected clock for deterministic branch-local dates. |
| `frontend/src/lib/membership-lifecycle.ts` (new) | Current-period selection, lifecycle status and calendar-month expiry. |
| `frontend/src/services/membership.server.ts` | One canonical registration path, authorized reads/import/conversion and normalized identity. |
| `frontend/src/services/automation.server.ts` | Membership-event claim/count/history independent of conversation identity. |
| `frontend/src/services/automation-runner.server.ts` | Lifecycle evaluation, delivery binding, branch dates and event/token metadata. |
| `frontend/src/services/conversation-reply.server.ts` | Optional reminder authority metadata passed to existing persistence. |
| `frontend/src/services/analytics.server.ts` | Canonical member counts and separate conservative acquisition attribution. |
| `frontend/src/types/member.ts` (new) | Canonical identity/registration input. |
| `frontend/src/types/membership.ts` | Canonical member/branch/history/provenance fields. |
| `frontend/src/types/conversation.ts` | Nullable canonical member link. |
| `frontend/src/types/automation.ts` | Nullable transport conversation for lifecycle events. |
| `supabase/migrations/20250101000035_add_canonical_members.sql` (new) | Additive schema, backfill, registration, linkage, claims and final-send safety. |
| `frontend/scripts/verify-members.mjs` (new) | Focused SQL/domain/services/form regressions. |
| `frontend/scripts/verify-members-postgres.mjs` (new) | Guarded four-connection real PostgreSQL validation harness. |
| `frontend/scripts/verify-member-migration-chain.mjs` (new) | Actual migration-chain/backward caller validation. |
| `frontend/scripts/plan-member-backfill.mjs` (new) | JSON-only historical normalization/conflict planning utility. |
| `frontend/scripts/fixtures/member-database.mjs` (new) | Isolated test bootstrap using actual migrations. |
| `frontend/scripts/fixtures/member-schema.sql` (new) | Minimal pre-35 fixture around existing control fixture. |
| `frontend/scripts/fixtures/member-service-harness.mjs` (new) | Actual service/analytics SQL adapter and actual interrupted form-handler harness. |
| `docs/canonical-members-implementation.md` (new) | Implementation/deployment/validation handoff. |

Saved isolated visual artifacts (ignored, not production files): [desktop](F:/gymflow-ai/frontend/.codex-artifacts/member-qa/add-member-desktop.png), [laptop](F:/gymflow-ai/frontend/.codex-artifacts/member-qa/add-member-1280x800.png), [mobile](F:/gymflow-ai/frontend/.codex-artifacts/member-qa/add-member-mobile.png). Preview server stopped, temporary source files removed, browser viewport restored and own tab closed.

## 13. Git diff and patch size

Feature code/test/tool scope is 25 files, plus this report = 26 feature files. No new runtime dependency. Existing pre-task density changes were +157 / -89 in 34 files; they remain separately attributable.

| Feature group | Added lines | Removed lines |
| --- | ---: | ---: |
| Production TypeScript (17 files; existing/new) | 906 | 173 |
| Migration SQL (1 new file) | 518 | 0 |
| Tests + JSON planning utility (4 new files) | 969 | 0 |
| Fixtures/harnesses (3 new files) | 523 | 0 |
| Feature subtotal excluding this report | 2,916 | 173 |

The full worktree includes those preserved unrelated edits: 44 tracked modifications (+698 / -262), 11 new implementation/test files and this new report. Normal `git diff --stat` omits untracked files; the feature totals above include them. HEAD is unchanged. No migration was applied externally, no commit and no push.
