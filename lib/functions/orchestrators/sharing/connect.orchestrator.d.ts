/**
 * Connect Orchestrators (D24, D29)
 *
 * get_my_connect_code: shows (or issues) the caller's code.
 * enter_connect_code: the caller typed someone's code; connects when both have.
 *
 * @module orchestrators/sharing/connect
 */
import { OrchestratorContext } from "../../types";
import { PersonView } from "../../types/sharing.types";
import { CodeEntryOutcome } from "../../domain/sharing/connect_code.service";
export interface MyConnectCodeResult {
    code: string;
    expires_at_ms: number;
    connection_count: number;
    connection_limit: number;
}
/** Returns the caller's current code, issuing a new one when needed. */
export declare function get_my_connect_code_orchestrator(ctx: OrchestratorContext<{
    refresh: boolean;
}>): Promise<MyConnectCodeResult>;
export interface EnterConnectCodeResult {
    outcome: CodeEntryOutcome | "malformed";
    /** The other person, when the code matched someone (never for blocked pairs). */
    person: PersonView | null;
}
/** Handles the caller typing someone else's code. */
export declare function enter_connect_code_orchestrator(ctx: OrchestratorContext<{
    code: string;
}>): Promise<EnterConnectCodeResult>;
//# sourceMappingURL=connect.orchestrator.d.ts.map