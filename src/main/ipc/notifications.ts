import { handleDatabaseIpc } from './database-handler'
import { getNotificationStatus } from '../services/notification-center'

export function registerNotificationIpc(): void {
  handleDatabaseIpc('notifications/status', () => getNotificationStatus())
}
