"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onUserDelete = exports.onUserCreate = exports.getUserStatistics = exports.updateNotificationPreferences = exports.deleteUser = exports.updateUserProfile = exports.getUserProfile = void 0;
// Export individual user functions from their separate files
var getUserProfile_1 = require("./getUserProfile");
Object.defineProperty(exports, "getUserProfile", { enumerable: true, get: function () { return getUserProfile_1.getUserProfile; } });
var updateUserProfile_1 = require("./updateUserProfile");
Object.defineProperty(exports, "updateUserProfile", { enumerable: true, get: function () { return updateUserProfile_1.updateUserProfile; } });
var deleteUser_1 = require("./deleteUser");
Object.defineProperty(exports, "deleteUser", { enumerable: true, get: function () { return deleteUser_1.deleteUser; } });
var updateNotificationPreferences_1 = require("./updateNotificationPreferences");
Object.defineProperty(exports, "updateNotificationPreferences", { enumerable: true, get: function () { return updateNotificationPreferences_1.updateNotificationPreferences; } });
var getUserStatistics_1 = require("./getUserStatistics");
Object.defineProperty(exports, "getUserStatistics", { enumerable: true, get: function () { return getUserStatistics_1.getUserStatistics; } });
// Export auth trigger functions
var onUserCreate_1 = require("./onUserCreate");
Object.defineProperty(exports, "onUserCreate", { enumerable: true, get: function () { return onUserCreate_1.onUserCreate; } });
var onUserDelete_1 = require("./onUserDelete");
Object.defineProperty(exports, "onUserDelete", { enumerable: true, get: function () { return onUserDelete_1.onUserDelete; } });
//# sourceMappingURL=index.js.map