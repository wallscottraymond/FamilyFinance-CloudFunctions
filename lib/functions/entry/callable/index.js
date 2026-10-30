"use strict";
/**
 * Callable Entry Points
 *
 * Cloud Functions exposed as callable endpoints.
 *
 * @module entry/callable
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfill_transaction_assignments = exports.set_budget_tags = exports.set_transaction_tags = exports.list_tags = exports.delete_tag = exports.update_tag = exports.create_tag = exports.clear_transaction_review = exports.list_rules = exports.delete_rule = exports.update_rule = exports.create_rule = exports.sync_recurring = exports.sync_transactions = exports.refresh_plaid_data = exports.link_plaid_account = exports.create_manual_outflow = exports.complete_relink = exports.create_update_link_token = exports.create_link_token = exports.derive_period_range = exports.get_widget_token = exports.derive_period = exports.derive_recurring_view = exports.undo_recurring_merge = exports.get_recurring_capabilities = exports.preview_convert_transaction = exports.convert_transaction_to_recurring = exports.assign_split_to_inflow = exports.answer_recurring_review_item = exports.set_occurrence_settled = exports.list_suppressed_recurring = exports.manage_recurring_inflow = exports.manage_recurring_outflow = exports.assign_split_to_outflow = exports.derive_recurring_transactions = exports.derive_budget_transactions = exports.derive_budget_view = exports.derive_goals_view = exports.delete_goal = exports.update_goal = exports.create_goal = exports.delete_budget = exports.update_budget = exports.create_budget = exports.purge_user_data = exports.restore_account = exports.remove_account = exports.get_account = exports.get_accounts = void 0;
exports.get_ideas_capabilities = exports.react_to_idea = exports.delete_idea = exports.update_idea = exports.create_idea = exports.manage_feedback_inbox = exports.get_feedback_status = exports.list_my_feedback = exports.submit_feedback = exports.copy_budgets_to_group = exports.move_budget = exports.unshare_account = exports.share_account = exports.manage_group = exports.respond_to_request = exports.add_to_group = exports.create_group = exports.manage_connection = exports.get_sharing_overview = exports.enter_connect_code = exports.get_my_connect_code = exports.backfill_recurring_reconciliation = exports.audit_transaction_assignments = exports.migrate_budget_categories = void 0;
// Account operations
var get_accounts_entry_1 = require("./get_accounts.entry");
Object.defineProperty(exports, "get_accounts", { enumerable: true, get: function () { return get_accounts_entry_1.get_accounts; } });
Object.defineProperty(exports, "get_account", { enumerable: true, get: function () { return get_accounts_entry_1.get_account; } });
var remove_account_entry_1 = require("./remove_account.entry");
Object.defineProperty(exports, "remove_account", { enumerable: true, get: function () { return remove_account_entry_1.remove_account; } });
var restore_account_entry_1 = require("./restore_account.entry");
Object.defineProperty(exports, "restore_account", { enumerable: true, get: function () { return restore_account_entry_1.restore_account; } });
// User operations
var purge_user_data_entry_1 = require("./purge_user_data.entry");
Object.defineProperty(exports, "purge_user_data", { enumerable: true, get: function () { return purge_user_data_entry_1.purge_user_data; } });
// Budget CRUD operations (layered architecture v2)
var create_budget_entry_1 = require("./create_budget.entry");
Object.defineProperty(exports, "create_budget", { enumerable: true, get: function () { return create_budget_entry_1.create_budget; } });
var update_budget_entry_1 = require("./update_budget.entry");
Object.defineProperty(exports, "update_budget", { enumerable: true, get: function () { return update_budget_entry_1.update_budget; } });
var delete_budget_entry_1 = require("./delete_budget.entry");
Object.defineProperty(exports, "delete_budget", { enumerable: true, get: function () { return delete_budget_entry_1.delete_budget; } });
// Goal CRUD operations (Goals — Phase 1)
var create_goal_entry_1 = require("./create_goal.entry");
Object.defineProperty(exports, "create_goal", { enumerable: true, get: function () { return create_goal_entry_1.create_goal; } });
var update_goal_entry_1 = require("./update_goal.entry");
Object.defineProperty(exports, "update_goal", { enumerable: true, get: function () { return update_goal_entry_1.update_goal; } });
var delete_goal_entry_1 = require("./delete_goal.entry");
Object.defineProperty(exports, "delete_goal", { enumerable: true, get: function () { return delete_goal_entry_1.delete_goal; } });
var derive_goals_view_entry_1 = require("./derive_goals_view.entry");
Object.defineProperty(exports, "derive_goals_view", { enumerable: true, get: function () { return derive_goals_view_entry_1.derive_goals_view; } });
// Derive-On-Read Period Architecture (Phase 1): budget view derivation
var derive_budget_view_entry_1 = require("./derive_budget_view.entry");
Object.defineProperty(exports, "derive_budget_view", { enumerable: true, get: function () { return derive_budget_view_entry_1.derive_budget_view; } });
// Budget-detail transactions (on-read owner + derived status; ignored/transfers section)
var derive_budget_transactions_entry_1 = require("./derive_budget_transactions.entry");
Object.defineProperty(exports, "derive_budget_transactions", { enumerable: true, get: function () { return derive_budget_transactions_entry_1.derive_budget_transactions; } });
// Recurring inflow/outflow detail transactions (this-period + historical)
var derive_recurring_transactions_entry_1 = require("./derive_recurring_transactions.entry");
Object.defineProperty(exports, "derive_recurring_transactions", { enumerable: true, get: function () { return derive_recurring_transactions_entry_1.derive_recurring_transactions; } });
// Manual split→bill assignment (durable pin + reconcile)
var assign_split_to_outflow_entry_1 = require("./assign_split_to_outflow.entry");
Object.defineProperty(exports, "assign_split_to_outflow", { enumerable: true, get: function () { return assign_split_to_outflow_entry_1.assign_split_to_outflow; } });
// Remove-Recover-Recurring: remove / pause / restore / delete a recurring bill / income
var manage_recurring_outflow_entry_1 = require("./manage_recurring_outflow.entry");
Object.defineProperty(exports, "manage_recurring_outflow", { enumerable: true, get: function () { return manage_recurring_outflow_entry_1.manage_recurring_outflow; } });
var manage_recurring_inflow_entry_1 = require("./manage_recurring_inflow.entry");
Object.defineProperty(exports, "manage_recurring_inflow", { enumerable: true, get: function () { return manage_recurring_inflow_entry_1.manage_recurring_inflow; } });
// Recovery screen: list currently removed/paused recurring items
var list_suppressed_recurring_entry_1 = require("./list_suppressed_recurring.entry");
Object.defineProperty(exports, "list_suppressed_recurring", { enumerable: true, get: function () { return list_suppressed_recurring_entry_1.list_suppressed_recurring; } });
// "Mark as paid / received": settle ONE bill / income occurrence by hand (cash, unlinked account)
var set_occurrence_settled_entry_1 = require("./set_occurrence_settled.entry");
Object.defineProperty(exports, "set_occurrence_settled", { enumerable: true, get: function () { return set_occurrence_settled_entry_1.set_occurrence_settled; } });
var answer_recurring_review_item_entry_1 = require("./answer_recurring_review_item.entry");
Object.defineProperty(exports, "answer_recurring_review_item", { enumerable: true, get: function () { return answer_recurring_review_item_entry_1.answer_recurring_review_item; } });
var assign_split_to_inflow_entry_1 = require("./assign_split_to_inflow.entry");
Object.defineProperty(exports, "assign_split_to_inflow", { enumerable: true, get: function () { return assign_split_to_inflow_entry_1.assign_split_to_inflow; } });
var convert_transaction_to_recurring_entry_1 = require("./convert_transaction_to_recurring.entry");
Object.defineProperty(exports, "convert_transaction_to_recurring", { enumerable: true, get: function () { return convert_transaction_to_recurring_entry_1.convert_transaction_to_recurring; } });
var preview_convert_transaction_entry_1 = require("./preview_convert_transaction.entry");
Object.defineProperty(exports, "preview_convert_transaction", { enumerable: true, get: function () { return preview_convert_transaction_entry_1.preview_convert_transaction; } });
var get_recurring_capabilities_entry_1 = require("./get_recurring_capabilities.entry");
Object.defineProperty(exports, "get_recurring_capabilities", { enumerable: true, get: function () { return get_recurring_capabilities_entry_1.get_recurring_capabilities; } });
var undo_recurring_merge_entry_1 = require("./undo_recurring_merge.entry");
Object.defineProperty(exports, "undo_recurring_merge", { enumerable: true, get: function () { return undo_recurring_merge_entry_1.undo_recurring_merge; } });
// Derive-On-Read Period Architecture (Phase 3): bill/income view derivation
var derive_recurring_view_entry_1 = require("./derive_recurring_view.entry");
Object.defineProperty(exports, "derive_recurring_view", { enumerable: true, get: function () { return derive_recurring_view_entry_1.derive_recurring_view; } });
// Derive-On-Read Period Architecture: BATCHED whole-period derivation (one call)
var derive_period_entry_1 = require("./derive_period.entry");
Object.defineProperty(exports, "derive_period", { enumerable: true, get: function () { return derive_period_entry_1.derive_period; } });
var get_widget_token_entry_1 = require("./get_widget_token.entry");
Object.defineProperty(exports, "get_widget_token", { enumerable: true, get: function () { return get_widget_token_entry_1.get_widget_token; } });
// Home preload: many windows (+ goals) of one cadence in ONE call, reading data once
var derive_period_range_entry_1 = require("./derive_period_range.entry");
Object.defineProperty(exports, "derive_period_range", { enumerable: true, get: function () { return derive_period_range_entry_1.derive_period_range; } });
// Plaid operations
var create_link_token_entry_1 = require("./create_link_token.entry");
Object.defineProperty(exports, "create_link_token", { enumerable: true, get: function () { return create_link_token_entry_1.create_link_token; } });
var create_update_link_token_entry_1 = require("./create_update_link_token.entry");
Object.defineProperty(exports, "create_update_link_token", { enumerable: true, get: function () { return create_update_link_token_entry_1.create_update_link_token; } });
var complete_relink_entry_1 = require("./complete_relink.entry");
Object.defineProperty(exports, "complete_relink", { enumerable: true, get: function () { return complete_relink_entry_1.complete_relink; } });
var create_manual_outflow_entry_1 = require("./create_manual_outflow.entry");
Object.defineProperty(exports, "create_manual_outflow", { enumerable: true, get: function () { return create_manual_outflow_entry_1.create_manual_outflow; } });
var link_plaid_account_entry_1 = require("./link_plaid_account.entry");
Object.defineProperty(exports, "link_plaid_account", { enumerable: true, get: function () { return link_plaid_account_entry_1.link_plaid_account; } });
var refresh_plaid_data_entry_1 = require("./refresh_plaid_data.entry");
Object.defineProperty(exports, "refresh_plaid_data", { enumerable: true, get: function () { return refresh_plaid_data_entry_1.refresh_plaid_data; } });
var sync_transactions_entry_1 = require("./sync_transactions.entry");
Object.defineProperty(exports, "sync_transactions", { enumerable: true, get: function () { return sync_transactions_entry_1.sync_transactions; } });
var sync_recurring_entry_1 = require("./sync_recurring.entry");
Object.defineProperty(exports, "sync_recurring", { enumerable: true, get: function () { return sync_recurring_entry_1.sync_recurring; } });
// Transaction Rules Engine ("Rule Book") CRUD
var create_rule_entry_1 = require("./create_rule.entry");
Object.defineProperty(exports, "create_rule", { enumerable: true, get: function () { return create_rule_entry_1.create_rule; } });
var update_rule_entry_1 = require("./update_rule.entry");
Object.defineProperty(exports, "update_rule", { enumerable: true, get: function () { return update_rule_entry_1.update_rule; } });
var delete_rule_entry_1 = require("./delete_rule.entry");
Object.defineProperty(exports, "delete_rule", { enumerable: true, get: function () { return delete_rule_entry_1.delete_rule; } });
var list_rules_entry_1 = require("./list_rules.entry");
Object.defineProperty(exports, "list_rules", { enumerable: true, get: function () { return list_rules_entry_1.list_rules; } });
var clear_transaction_review_entry_1 = require("./clear_transaction_review.entry");
Object.defineProperty(exports, "clear_transaction_review", { enumerable: true, get: function () { return clear_transaction_review_entry_1.clear_transaction_review; } });
// Tag catalog CRUD
var create_tag_entry_1 = require("./create_tag.entry");
Object.defineProperty(exports, "create_tag", { enumerable: true, get: function () { return create_tag_entry_1.create_tag; } });
var update_tag_entry_1 = require("./update_tag.entry");
Object.defineProperty(exports, "update_tag", { enumerable: true, get: function () { return update_tag_entry_1.update_tag; } });
var delete_tag_entry_1 = require("./delete_tag.entry");
Object.defineProperty(exports, "delete_tag", { enumerable: true, get: function () { return delete_tag_entry_1.delete_tag; } });
var list_tags_entry_1 = require("./list_tags.entry");
Object.defineProperty(exports, "list_tags", { enumerable: true, get: function () { return list_tags_entry_1.list_tags; } });
var set_transaction_tags_entry_1 = require("./set_transaction_tags.entry");
Object.defineProperty(exports, "set_transaction_tags", { enumerable: true, get: function () { return set_transaction_tags_entry_1.set_transaction_tags; } });
var set_budget_tags_entry_1 = require("./set_budget_tags.entry");
Object.defineProperty(exports, "set_budget_tags", { enumerable: true, get: function () { return set_budget_tags_entry_1.set_budget_tags; } });
// Transaction Assignment Engine: one-shot post-cutover backfill
var backfill_transaction_assignments_entry_1 = require("./backfill_transaction_assignments.entry");
Object.defineProperty(exports, "backfill_transaction_assignments", { enumerable: true, get: function () { return backfill_transaction_assignments_entry_1.backfill_transaction_assignments; } });
var migrate_budget_categories_entry_1 = require("./migrate_budget_categories.entry");
Object.defineProperty(exports, "migrate_budget_categories", { enumerable: true, get: function () { return migrate_budget_categories_entry_1.migrate_budget_categories; } });
var audit_transaction_assignments_entry_1 = require("./audit_transaction_assignments.entry");
Object.defineProperty(exports, "audit_transaction_assignments", { enumerable: true, get: function () { return audit_transaction_assignments_entry_1.audit_transaction_assignments; } });
var backfill_recurring_reconciliation_entry_1 = require("./backfill_recurring_reconciliation.entry");
Object.defineProperty(exports, "backfill_recurring_reconciliation", { enumerable: true, get: function () { return backfill_recurring_reconciliation_entry_1.backfill_recurring_reconciliation; } });
// Account-Rooted-Sharing (Phase 1): connect, groups, requests
var get_my_connect_code_entry_1 = require("./get_my_connect_code.entry");
Object.defineProperty(exports, "get_my_connect_code", { enumerable: true, get: function () { return get_my_connect_code_entry_1.get_my_connect_code; } });
var enter_connect_code_entry_1 = require("./enter_connect_code.entry");
Object.defineProperty(exports, "enter_connect_code", { enumerable: true, get: function () { return enter_connect_code_entry_1.enter_connect_code; } });
var get_sharing_overview_entry_1 = require("./get_sharing_overview.entry");
Object.defineProperty(exports, "get_sharing_overview", { enumerable: true, get: function () { return get_sharing_overview_entry_1.get_sharing_overview; } });
var manage_connection_entry_1 = require("./manage_connection.entry");
Object.defineProperty(exports, "manage_connection", { enumerable: true, get: function () { return manage_connection_entry_1.manage_connection; } });
var create_group_entry_1 = require("./create_group.entry");
Object.defineProperty(exports, "create_group", { enumerable: true, get: function () { return create_group_entry_1.create_group; } });
var add_to_group_entry_1 = require("./add_to_group.entry");
Object.defineProperty(exports, "add_to_group", { enumerable: true, get: function () { return add_to_group_entry_1.add_to_group; } });
var respond_to_request_entry_1 = require("./respond_to_request.entry");
Object.defineProperty(exports, "respond_to_request", { enumerable: true, get: function () { return respond_to_request_entry_1.respond_to_request; } });
var manage_group_entry_1 = require("./manage_group.entry");
Object.defineProperty(exports, "manage_group", { enumerable: true, get: function () { return manage_group_entry_1.manage_group; } });
var share_account_entry_1 = require("./share_account.entry");
Object.defineProperty(exports, "share_account", { enumerable: true, get: function () { return share_account_entry_1.share_account; } });
var unshare_account_entry_1 = require("./unshare_account.entry");
Object.defineProperty(exports, "unshare_account", { enumerable: true, get: function () { return unshare_account_entry_1.unshare_account; } });
var move_budget_entry_1 = require("./move_budget.entry");
Object.defineProperty(exports, "move_budget", { enumerable: true, get: function () { return move_budget_entry_1.move_budget; } });
var copy_budgets_to_group_entry_1 = require("./copy_budgets_to_group.entry");
Object.defineProperty(exports, "copy_budgets_to_group", { enumerable: true, get: function () { return copy_budgets_to_group_entry_1.copy_budgets_to_group; } });
// Feedback-And-Questions: send a note, the Sent tab, and the owner-only inbox
var submit_feedback_entry_1 = require("./submit_feedback.entry");
Object.defineProperty(exports, "submit_feedback", { enumerable: true, get: function () { return submit_feedback_entry_1.submit_feedback; } });
var list_my_feedback_entry_1 = require("./list_my_feedback.entry");
Object.defineProperty(exports, "list_my_feedback", { enumerable: true, get: function () { return list_my_feedback_entry_1.list_my_feedback; } });
var get_feedback_status_entry_1 = require("./get_feedback_status.entry");
Object.defineProperty(exports, "get_feedback_status", { enumerable: true, get: function () { return get_feedback_status_entry_1.get_feedback_status; } });
var manage_feedback_inbox_entry_1 = require("./manage_feedback_inbox.entry");
Object.defineProperty(exports, "manage_feedback_inbox", { enumerable: true, get: function () { return manage_feedback_inbox_entry_1.manage_feedback_inbox; } });
// Ideas (Planning-Module v1): the list, likes + comments, and the capability check
var create_idea_entry_1 = require("./create_idea.entry");
Object.defineProperty(exports, "create_idea", { enumerable: true, get: function () { return create_idea_entry_1.create_idea; } });
var update_idea_entry_1 = require("./update_idea.entry");
Object.defineProperty(exports, "update_idea", { enumerable: true, get: function () { return update_idea_entry_1.update_idea; } });
var delete_idea_entry_1 = require("./delete_idea.entry");
Object.defineProperty(exports, "delete_idea", { enumerable: true, get: function () { return delete_idea_entry_1.delete_idea; } });
var react_to_idea_entry_1 = require("./react_to_idea.entry");
Object.defineProperty(exports, "react_to_idea", { enumerable: true, get: function () { return react_to_idea_entry_1.react_to_idea; } });
var get_ideas_capabilities_entry_1 = require("./get_ideas_capabilities.entry");
Object.defineProperty(exports, "get_ideas_capabilities", { enumerable: true, get: function () { return get_ideas_capabilities_entry_1.get_ideas_capabilities; } });
//# sourceMappingURL=index.js.map