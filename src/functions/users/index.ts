// Export individual user functions from their separate files
export { getUserProfile } from "./getUserProfile";
export { updateUserProfile } from "./updateUserProfile";
export { deleteUser } from "./deleteUser";
export { updateNotificationPreferences } from "./updateNotificationPreferences";
export { getUserStatistics } from "./getUserStatistics";

// Export auth trigger functions
export { onUserCreate } from "./onUserCreate";
export { onUserDelete } from "./onUserDelete";